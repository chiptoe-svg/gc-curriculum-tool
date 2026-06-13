import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { hashIp } from '@/lib/ip-hash';
import { getCourseByCode, updateCourseCanvasImport } from '@/lib/db/courses-queries';
import { setPairedCanvasProvenance } from '@/lib/db/course-codes-queries';
import { insertMaterial, findMaterialByFileName, updateMaterialMetadata } from '@/lib/db/course-materials-queries';
import { finalizeExtraction } from '@/lib/capture/finalize-extraction';
import { createVectorStore } from '@/lib/capture/vector-store';
import { parseCanvasUrl } from '@/lib/canvas/parseCanvasUrl';
import { fetchCanvasCourse, fetchCanvasFileMeta } from '@/lib/canvas/fetchCanvasCourse';
import { htmlToText } from '@/lib/canvas/htmlToText';
import { extractText, SUPPORTED_MIME_TYPES, type ExtractedMimeType } from '@/lib/courses/extract-text';
import { isLegacyOfficeMime } from '@/lib/courses/legacy-converter';

// Extension-to-MIME map used as a fallback when Canvas reports an empty or
// generic content-type. Mirrors the one in scripts/backfill-canvas-file-mime-types.ts.
const EXT_TO_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

export const maxDuration = 120;

// Canvas file URLs embedded in materials follow this shape regardless of which
// course they belong to: /files/{ID}/{download|preview|edit|...}?...
// We pull the ID anywhere the API or HTML surfaces this pattern.
const CANVAS_FILE_ID_RE = /\/files\/(\d+)(?:\/|\?|"|$)/g;
const MAX_FILES_PER_IMPORT = 20;
const MAX_FILE_BYTES = 5 * 1024 * 1024;  // 5 MB cap per file

interface Ctx { params: Promise<{ code: string }> }

export async function POST(req: Request, { params }: Ctx) {
  // Wrap everything in a top-level try/catch so any unhandled exception
  // is returned as a JSON error rather than Next.js's HTML 500 page —
  // the client parses the response as JSON and breaks on HTML.
  try {
    return await runImport(req, params);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    console.error('[canvas-import] unhandled exception:', msg, stack);
    return NextResponse.json(
      { error: `Unexpected server error during Canvas import: ${msg}` },
      { status: 500 },
    );
  }
}

async function runImport(req: Request, params: Ctx['params']): Promise<Response> {
  const { code } = await params;
  const body = await req.json().catch(() => ({}));
  const slug = typeof body.slug === 'string' ? body.slug : '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const canvasUrl = typeof body.canvasUrl === 'string' ? body.canvasUrl.trim() : '';
  const canvasToken = typeof body.canvasToken === 'string' ? body.canvasToken.trim() : '';
  const sourceCode = typeof body.sourceCode === 'string' && body.sourceCode.trim() ? body.sourceCode.trim() : null;
  // Default ON: most courses have a graveyard of draft assignments / pages
  // that the auditor reads as real coverage. Faculty can opt back in to
  // including unpublished items per import.
  const skipUnpublished = typeof body.skipUnpublished === 'boolean' ? body.skipUnpublished : true;
  if (!canvasUrl) return NextResponse.json({ error: 'canvasUrl is required' }, { status: 400 });
  if (!canvasToken) return NextResponse.json({ error: 'canvasToken is required' }, { status: 400 });

  const courseId = parseCanvasUrl(canvasUrl);
  if (!courseId) return NextResponse.json({ error: 'Could not parse a Canvas course ID from the URL. Expected format: https://clemson.instructure.com/courses/12345' }, { status: 400 });

  const course = await getCourseByCode(code);
  if (!course) return NextResponse.json({ error: `Course not found: ${code}` }, { status: 404 });

  let canvasBaseUrl: string;
  try {
    const parsed = new URL(canvasUrl);
    canvasBaseUrl = `${parsed.protocol}//${parsed.host}`;
  } catch {
    return NextResponse.json({ error: 'Invalid Canvas URL' }, { status: 400 });
  }

  let data: Awaited<ReturnType<typeof fetchCanvasCourse>>;
  try {
    data = await fetchCanvasCourse(canvasBaseUrl, courseId, canvasToken);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('401')) return NextResponse.json({ error: 'Canvas API token is invalid or expired. Generate a new token in Canvas → Profile → Settings → Approved Integrations.' }, { status: 422 });
    if (msg.includes('404')) return NextResponse.json({ error: 'Canvas course not found. Check the URL and make sure you have access to that course.' }, { status: 422 });
    return NextResponse.json({ error: `Canvas import failed: ${msg}` }, { status: 502 });
  }

  // Apply the skip-unpublished filter before formatting. Counted as a single
  // metric (`unpublishedSkipped`) we surface back to the client.
  let unpublishedSkipped = 0;
  if (skipUnpublished) {
    const beforeA = data.assignments.length;
    const beforeP = data.pages.length;
    const beforeD = data.discussions.length;
    const beforeQ = data.quizzes.length;
    const beforeM = data.modules.length;
    const beforeMI = data.modules.reduce((n, m) => n + m.items.length, 0);

    data.assignments = data.assignments.filter(a => a.published);
    data.pages = data.pages.filter(p => p.published);
    data.discussions = data.discussions.filter(d => d.published);
    data.quizzes = data.quizzes.filter(q => q.published);
    // For modules, drop unpublished modules entirely; for published modules,
    // drop any unpublished items inside them.
    data.modules = data.modules
      .filter(m => m.published)
      .map(m => ({ ...m, items: m.items.filter(i => i.published) }));

    unpublishedSkipped =
      (beforeA - data.assignments.length) +
      (beforeP - data.pages.length) +
      (beforeD - data.discussions.length) +
      (beforeQ - data.quizzes.length) +
      (beforeM - data.modules.length) +
      (beforeMI - data.modules.reduce((n, m) => n + m.items.length, 0));
  }

  const ipHash = hashIp(req);
  // Every item we insert carries its actual source MIME type. HTML-sourced
  // content (Syllabus, Assignments, Pages, Discussions, Quizzes, Module
  // List) stays text/html — that's literally where the text came from.
  // Canvas File attachments record their real type (application/pdf,
  // application/vnd.openxmlformats-officedocument.wordprocessingml.document,
  // etc.) so we can filter, badge, and re-extract them later. Prior to
  // 2026-05-25 every row was hard-coded text/html which made PDF
  // attachments invisible to mimeType filters.
  const toInsert: Array<{ fileName: string; text: string; mimeType: string }> = [];

  const syllabusText = htmlToText(data.course.syllabusHtml);
  // Suppress Canvas: Syllabus when the curated Sheets catalog already has LOs.
  // The Sheets row is the structured source of truth; the Canvas Syllabus page
  // tends to be a rambling, often-stale duplicate. Faculty can re-include by
  // un-ignoring the row in the Materials panel if Sheets is missing structure.
  const sheetsHasCatalog = (course.learningObjectives ?? []).length > 0;
  if (syllabusText && !sheetsHasCatalog) {
    toInsert.push({ fileName: 'Canvas: Syllabus', text: syllabusText, mimeType: 'text/html' });
  } else if (syllabusText && sheetsHasCatalog) {
    console.log(`[canvas-import] ${code}: suppressed Canvas: Syllabus (Sheets has ${course.learningObjectives!.length} LOs)`);
  }

  if (data.assignments.length > 0) {
    const parts = data.assignments.map(a => {
      const desc = htmlToText(a.descriptionHtml);
      const pts = a.pointsPossible != null ? ` (${a.pointsPossible} pts)` : '';
      const status = a.published ? '' : ' [unpublished]';
      const header = `## ${a.name}${pts}${status}`;
      // Rubric criteria are what faculty actually grade against. Including
      // them inline gives the auditor the "what we grade for" picture that
      // the assignment description alone often doesn't carry.
      let rubricBlock = '';
      if (a.rubric.length > 0) {
        const lines: string[] = [];
        const rubricHeader = a.rubricTitle ? `Rubric — ${a.rubricTitle}:` : 'Rubric:';
        lines.push('', rubricHeader);
        for (const c of a.rubric) {
          const ptsLabel = c.points != null ? ` (${c.points} pts)` : '';
          const detail = c.longDescription && c.longDescription !== c.description
            ? ` — ${c.longDescription}`
            : '';
          lines.push(`- ${c.description}${ptsLabel}${detail}`);
          if (c.ratings.length > 0) {
            const ratingLine = c.ratings
              .map(r => `${r.points != null ? `${r.points} pts: ` : ''}${r.description}`)
              .join(' / ');
            lines.push(`  ratings: ${ratingLine}`);
          }
        }
        rubricBlock = lines.join('\n');
      }
      return [header, desc, rubricBlock].filter(Boolean).join('\n');
    });
    const assignmentsText = parts.join('\n\n');
    if (assignmentsText.trim()) toInsert.push({ fileName: 'Canvas: Assignments', text: assignmentsText, mimeType: 'text/html' });
  }

  if (data.modules.length > 0) {
    const parts = data.modules.map(m => {
      const items = m.items.map(i => {
        // Surface the URL for ExternalUrl items so downstream consumers
        // (audit, Google Docs scan) can follow the link.
        const linkSuffix = i.externalUrl ? ` → ${i.externalUrl}` : '';
        const itemStatus = i.published ? '' : ' [unpublished]';
        return `  - ${i.title} (${i.type})${itemStatus}${linkSuffix}`;
      }).join('\n');
      const modStatus = m.published ? '' : ' [unpublished]';
      return `## ${m.name}${modStatus}\n${items}`;
    });
    const modulesText = parts.join('\n\n');
    if (modulesText.trim()) toInsert.push({ fileName: 'Canvas: Module List', text: modulesText, mimeType: 'text/html' });
  }

  if (data.pages.length > 0) {
    // Canvas Pages are wiki-style content embedded in the course. Many
    // courses house substantive lecture material here that's otherwise
    // invisible to the auditor. Render each page's body as plain text
    // beneath its title, separated by section breaks.
    const parts = data.pages
      .map(p => {
        const body = htmlToText(p.bodyHtml);
        if (!body.trim()) return '';
        const status = p.published ? '' : ' [unpublished]';
        return `## ${p.title}${status}\n${body}`;
      })
      .filter(Boolean);
    const pagesText = parts.join('\n\n---\n\n');
    if (pagesText.trim()) toInsert.push({ fileName: 'Canvas: Pages', text: pagesText, mimeType: 'text/html' });
  }

  if (data.discussions.length > 0) {
    const parts = data.discussions
      .map(d => {
        const body = htmlToText(d.messageHtml);
        if (!body.trim() && !d.isAssignment) return '';
        const tags = [
          d.isAssignment ? 'graded' : null,
          !d.published ? 'unpublished' : null,
        ].filter(Boolean).join(', ');
        const suffix = tags ? ` [${tags}]` : '';
        return `## ${d.title}${suffix}\n${body || '(prompt text empty)'}`;
      })
      .filter(Boolean);
    const discussionsText = parts.join('\n\n---\n\n');
    if (discussionsText.trim()) toInsert.push({ fileName: 'Canvas: Discussions', text: discussionsText, mimeType: 'text/html' });
  }

  if (data.quizzes.length > 0) {
    const parts = data.quizzes.map(q => {
      const pts = q.pointsPossible != null ? ` (${q.pointsPossible} pts)` : '';
      const desc = htmlToText(q.descriptionHtml);
      const tags = [`${q.source} quiz`, q.published ? null : 'unpublished']
        .filter(Boolean).join(', ');
      const lines: string[] = [`## ${q.title}${pts} [${tags}]`];
      if (desc.trim()) lines.push(desc);
      if (q.questions.length > 0) {
        lines.push('', 'Questions:');
        q.questions.forEach((question, i) => {
          const qPts = question.pointsPossible != null ? ` (${question.pointsPossible} pts)` : '';
          const qText = htmlToText(question.textHtml).trim() || question.name;
          lines.push(`Q${i + 1} [${question.questionType}]${qPts}: ${qText}`);
          if (question.answers.length > 0) {
            question.answers.forEach((a, j) => {
              const label = String.fromCharCode(97 + j);  // a, b, c, ...
              const mark = a.correct ? ' ✓' : '';
              lines.push(`  ${label}. ${a.text}${mark}`);
            });
          }
        });
      } else if (q.questionCount && q.questionCount > 0) {
        lines.push(`(${q.questionCount} questions — text not exposed via API)`);
      }
      return lines.join('\n');
    });
    const quizzesText = parts.join('\n\n---\n\n');
    if (quizzesText.trim()) toInsert.push({ fileName: 'Canvas: Quizzes', text: quizzesText, mimeType: 'text/html' });
  }

  // Reference-driven Canvas File attachments: scan everything we've extracted
  // so far for Canvas file URLs, fetch each unique file, extract PDF/DOCX text,
  // and add as a new material. Images / videos / audio / binary types are
  // recorded as 'failed' so the auditor knows they exist but couldn't be read.
  const allExtractedText = toInsert.map(t => t.text).join('\n\n');
  const referencedFileIds = new Set<string>();
  for (const m of allExtractedText.matchAll(CANVAS_FILE_ID_RE)) {
    if (m[1]) referencedFileIds.add(m[1]);
  }
  const fileResults: Array<{ id: string; status: 'ok' | 'skipped' | 'failed'; fileName?: string; reason?: string }> = [];
  const fileIdList = Array.from(referencedFileIds).slice(0, MAX_FILES_PER_IMPORT);
  for (const fileId of fileIdList) {
    const meta = await fetchCanvasFileMeta(canvasBaseUrl, fileId, canvasToken);
    if (!meta) {
      fileResults.push({ id: fileId, status: 'failed', reason: 'metadata not accessible' });
      continue;
    }
    // Resolve the file's MIME — prefer Canvas's reported type, fall back to
    // extension-derived. Then accept anything our extractor or the
    // LibreOffice legacy converter handles.
    const reportedMime = meta.mimeType?.toLowerCase() || '';
    const ext = (meta.displayName.split('.').pop() ?? '').toLowerCase();
    const resolvedMime =
      (reportedMime && reportedMime !== 'application/octet-stream' ? reportedMime : null)
      ?? EXT_TO_MIME[ext]
      ?? reportedMime;

    const isSupported = (SUPPORTED_MIME_TYPES as readonly string[]).includes(resolvedMime);
    const isLegacy = isLegacyOfficeMime(resolvedMime);
    if (!isSupported && !isLegacy) {
      fileResults.push({ id: fileId, status: 'skipped', fileName: meta.displayName, reason: `unsupported type: ${resolvedMime || ext}` });
      continue;
    }
    if (meta.sizeBytes > MAX_FILE_BYTES) {
      fileResults.push({ id: fileId, status: 'skipped', fileName: meta.displayName, reason: `file too large (${meta.sizeBytes} > ${MAX_FILE_BYTES})` });
      continue;
    }
    try {
      const dl = await fetch(meta.url, { redirect: 'follow' });
      if (!dl.ok) {
        fileResults.push({ id: fileId, status: 'failed', fileName: meta.displayName, reason: `download ${dl.status}` });
        continue;
      }
      const buffer = Buffer.from(await dl.arrayBuffer());
      // extractText handles legacy → modern conversion internally via
      // LibreOffice. We pass the real MIME (legacy or modern) and let it
      // dispatch.
      const result = await extractText({
        fileBytes: buffer,
        mimeType: resolvedMime as ExtractedMimeType,
        fileName: meta.displayName,
      });
      if (result.status !== 'ok' || !result.text) {
        fileResults.push({ id: fileId, status: 'failed', fileName: meta.displayName, reason: `extraction ${result.status}` });
        continue;
      }
      toInsert.push({ fileName: `Canvas File: ${meta.displayName}`, text: result.text, mimeType: resolvedMime });
      fileResults.push({ id: fileId, status: 'ok', fileName: meta.displayName });
    } catch (e) {
      fileResults.push({ id: fileId, status: 'failed', fileName: meta.displayName, reason: e instanceof Error ? e.message : 'fetch error' });
    }
  }

  // Upsert by (courseCode, fileName). Re-imports refresh existing rows in
  // place — no duplicates. Canvas content has stable per-course names
  // (Canvas: Syllabus, Canvas File: X.pdf), so fileName is the natural key.
  // Returned `imported` includes both inserted and updated rows; callers
  // can tell them apart via `inserted`/`updated` counts.
  const vectorStore = createVectorStore();
  const imported: Array<{ id: string; fileName: string }> = [];
  let insertedCount = 0;
  let updatedCount = 0;
  for (const { fileName, text, mimeType } of toInsert) {
    const existing = await findMaterialByFileName(code, fileName, sourceCode);
    if (existing) {
      await updateMaterialMetadata({
        id: existing.id,
        blobUrl: canvasUrl,
        mimeType,
        sizeBytes: text.length,
      });
      await finalizeExtraction({
        id: existing.id,
        courseCode: code,
        fileName,
        extractionStatus: 'ok',
        extractionMethod: 'text',
        extractedText: text,
        vectorStore,
      });
      imported.push({ id: existing.id, fileName });
      updatedCount++;
    } else {
      const mat = await insertMaterial({
        courseCode: code,
        fileName,
        blobUrl: canvasUrl,
        mimeType,
        sizeBytes: text.length,
        ipHash,
        sourceCode,
      });
      await finalizeExtraction({
        id: mat.id,
        courseCode: code,
        fileName,
        extractionStatus: 'ok',
        extractionMethod: 'text',
        extractedText: text,
        vectorStore,
      });
      imported.push({ id: mat.id, fileName });
      insertedCount++;
    }
  }

  // Stamp the Canvas course name + import timestamp so the Step-1 Canvas box
  // header can show provenance (name·imported M/D/YY) without a live API call.
  // When sourceCode names a different (paired) code, write provenance to that
  // paired row; otherwise stamp the primary course as before.
  if (sourceCode && sourceCode !== code) {
    await setPairedCanvasProvenance(sourceCode, data.course.name, new Date());
  } else {
    await updateCourseCanvasImport(code, data.course.name, new Date());
  }

  const details = {
    syllabusFound: !!syllabusText,
    assignments: data.assignments.map(a => a.name),
    modules: data.modules.map(m => m.name),
    pages: data.pages.map(p => p.title),
    discussions: data.discussions.map(d => d.title),
    quizzes: data.quizzes.map(q => q.title),
    files: fileResults
      .filter(f => f.status === 'ok' && f.fileName)
      .map(f => f.fileName as string),
    filesSkipped: fileResults.filter(f => f.status !== 'ok').length,
    unpublishedSkipped,
  };

  return NextResponse.json({
    imported: imported.length,
    inserted: insertedCount,
    updated: updatedCount,
    materials: imported,
    details,
  });
}
