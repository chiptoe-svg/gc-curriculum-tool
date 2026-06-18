/**
 * List-mode Canvas import — runs ONLY when COURSECAPTURE_TRIAGE=1.
 *
 * Mirrors runImport's auth / fetch / assemble flow exactly, but instead of
 * extracting text (Docling) and enqueuing for indexing, it:
 *   - Downloads file bytes + stores via putLocal (no extraction).
 *   - Probes size signals (pageCount / slideCount) cheaply.
 *   - Upserts every item (HTML-derived and file) with indexing_status='pending'.
 *   - NEVER calls enqueue.
 *   - Responds with a manifest for the UI to display.
 */

import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { hashIp } from '@/lib/ip-hash';
import { getCourseByCode, updateCourseCanvasImport } from '@/lib/db/courses-queries';
import { setPairedCanvasProvenance } from '@/lib/db/course-codes-queries';
import {
  insertMaterial,
  findMaterialByFileName,
  updateMaterialMetadata,
  updateExtractionResult,
  updateMaterialTier,
} from '@/lib/db/course-materials-queries';
import { classifyManifestItem } from '@/lib/capture/material-tier';
import { parseCanvasUrl } from '@/lib/canvas/parseCanvasUrl';
import { fetchCanvasCourse, fetchCanvasFileMeta } from '@/lib/canvas/fetchCanvasCourse';
import { assembleCanvasMaterials } from '@/lib/canvas/assemble-canvas-materials';
import { probeSize } from '@/lib/capture/size-probe';
import { putLocal, courseSlug, safeFilename } from '@/lib/storage/local-storage';
import { SUPPORTED_MIME_TYPES } from '@/lib/courses/extract-text';
import { isLegacyOfficeMime } from '@/lib/courses/legacy-converter';
import { EXT_TO_MIME } from '@/lib/canvas/ext-to-mime';

const CANVAS_FILE_ID_RE = /\/files\/(\d+)(?:\/|\?|"|$)/g;
const MAX_FILES_PER_IMPORT = 20;
const MAX_FILE_BYTES = 5 * 1024 * 1024;  // 5 MB cap per file

/** Maps a Canvas: fileName prefix to the manifest kind field. */
function kindFromFileName(fileName: string): ManifestRow['kind'] {
  if (fileName === 'Canvas: Syllabus') return 'syllabus';
  if (fileName === 'Canvas: Assignments') return 'assignments';
  if (fileName === 'Canvas: Pages') return 'pages';
  if (fileName === 'Canvas: Discussions') return 'discussions';
  if (fileName === 'Canvas: Quizzes') return 'quizzes';
  if (fileName === 'Canvas: Module List') return 'modules';
  return 'file';
}

export interface SkippedFile {
  fileName: string;
  mimeType: string;
  reason: string;
}

export interface ManifestRow {
  id: string;
  fileName: string;
  kind: 'syllabus' | 'assignments' | 'pages' | 'discussions' | 'quizzes' | 'modules' | 'file';
  mimeType: string;
  sizeBytes: number;
  pageCount?: number;
  slideCount?: number;
  indexingStatus: string;
  tier: string;
}

export async function runListImport(
  req: Request,
  params: Promise<{ code: string }>,
): Promise<Response> {
  const { code } = await params;
  const body = await req.json().catch(() => ({}));
  const slug = typeof body.slug === 'string' ? body.slug : '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const canvasUrl = typeof body.canvasUrl === 'string' ? body.canvasUrl.trim() : '';
  const canvasToken = typeof body.canvasToken === 'string' ? body.canvasToken.trim() : '';
  const sourceCode = typeof body.sourceCode === 'string' && body.sourceCode.trim() ? body.sourceCode.trim() : null;
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
    if (msg.includes('401')) return NextResponse.json({ error: 'Canvas API token is invalid or expired.' }, { status: 422 });
    if (msg.includes('404')) return NextResponse.json({ error: 'Canvas course not found.' }, { status: 422 });
    return NextResponse.json({ error: `Canvas import failed: ${msg}` }, { status: 502 });
  }

  // Apply skip-unpublished filter (identical to runImport)
  if (skipUnpublished) {
    data.assignments = data.assignments.filter(a => a.published);
    data.pages = data.pages.filter(p => p.published);
    data.discussions = data.discussions.filter(d => d.published);
    data.quizzes = data.quizzes.filter(q => q.published);
    data.modules = data.modules
      .filter(m => m.published)
      .map(m => ({ ...m, items: m.items.filter(i => i.published) }));
  }

  const ipHash = hashIp(req);
  const sheetsHasCatalog = (course.learningObjectives ?? []).length > 0;
  const assembledItems = assembleCanvasMaterials(data, { sheetsHasCatalog });

  // ── File-reference scan (same regex + cap as runImport) ───────────────────
  const allExtractedText = assembledItems.map(t => t.text).join('\n\n');
  // Also include the raw syllabus HTML so we catch file IDs in href attributes
  const allHtml = data.course.syllabusHtml + '\n\n' +
    data.assignments.map(a => a.descriptionHtml).join('\n\n');
  const combinedScan = allExtractedText + '\n\n' + allHtml;

  const referencedFileIds = new Set<string>();
  for (const m of combinedScan.matchAll(CANVAS_FILE_ID_RE)) {
    if (m[1]) referencedFileIds.add(m[1]);
  }

  // ── Upsert HTML-derived items ──────────────────────────────────────────────
  const manifestRows: ManifestRow[] = [];

  for (const { fileName, text, mimeType } of assembledItems) {
    const existing = await findMaterialByFileName(code, fileName, sourceCode);
    let matId: string;
    if (existing) {
      await updateMaterialMetadata({
        id: existing.id,
        blobUrl: canvasUrl,
        mimeType,
        sizeBytes: text.length,
      });
      await updateExtractionResult({
        id: existing.id,
        extractionStatus: 'pending',
        extractionMethod: 'text',
        extractedText: text,
      });
      matId = existing.id;
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
      await updateExtractionResult({
        id: mat.id,
        extractionStatus: 'pending',
        extractionMethod: 'text',
        extractedText: text,
      });
      matId = mat.id;
    }
    const htmlKind = kindFromFileName(fileName);
    let htmlTier = 'background';
    try {
      htmlTier = await classifyManifestItem({ kind: htmlKind });
    } catch { /* bias background on any error */ }
    await updateMaterialTier(matId, htmlTier).catch(() => { /* never fail the import */ });
    manifestRows.push({
      id: matId,
      fileName,
      kind: htmlKind,
      mimeType,
      sizeBytes: text.length,
      indexingStatus: 'pending',
      tier: htmlTier,
    });
  }

  // ── Download + store file attachments (no extraction, no enqueue) ─────────
  const skippedFiles: SkippedFile[] = [];
  const fileIdList = Array.from(referencedFileIds).slice(0, MAX_FILES_PER_IMPORT);
  for (const fileId of fileIdList) {
    const meta = await fetchCanvasFileMeta(canvasBaseUrl, fileId, canvasToken);
    if (!meta) continue;

    const reportedMime = meta.mimeType?.toLowerCase() || '';
    const ext = (meta.displayName.split('.').pop() ?? '').toLowerCase();
    const resolvedMime =
      (reportedMime && reportedMime !== 'application/octet-stream' ? reportedMime : null)
      ?? EXT_TO_MIME[ext]
      ?? reportedMime;

    // Skip files whose MIME type is neither supported nor legacy-office —
    // they can't be text-extracted at any tier, so downloading and storing
    // them wastes local storage and clutters the manifest.
    const isSupported = (SUPPORTED_MIME_TYPES as readonly string[]).includes(resolvedMime);
    const isLegacy = isLegacyOfficeMime(resolvedMime);
    if (!isSupported && !isLegacy) {
      skippedFiles.push({
        fileName: meta.displayName,
        mimeType: resolvedMime,
        reason: `unsupported type: ${resolvedMime || ext}`,
      });
      continue;
    }

    if (meta.sizeBytes > MAX_FILE_BYTES) {
      skippedFiles.push({
        fileName: meta.displayName,
        mimeType: resolvedMime,
        reason: `file too large (${meta.sizeBytes} > ${MAX_FILE_BYTES})`,
      });
      continue;
    }

    let buffer: Buffer;
    try {
      const dl = await fetch(meta.url, { redirect: 'follow' });
      if (!dl.ok) {
        skippedFiles.push({ fileName: meta.displayName, mimeType: resolvedMime, reason: `download failed (${dl.status})` });
        continue;
      }
      buffer = Buffer.from(await dl.arrayBuffer());
    } catch (e) {
      skippedFiles.push({ fileName: meta.displayName, mimeType: resolvedMime, reason: `download error: ${e instanceof Error ? e.message : 'fetch failed'}` });
      continue;
    }

    // Store the bytes via putLocal (no text extraction).
    const key = `${courseSlug(code)}/${Date.now()}-${safeFilename(meta.displayName)}`;
    let storedUrl: string;
    try {
      const result = await putLocal({ key, bytes: buffer });
      storedUrl = result.url;
    } catch (e) {
      skippedFiles.push({ fileName: meta.displayName, mimeType: resolvedMime, reason: `storage error: ${e instanceof Error ? e.message : 'putLocal failed'}` });
      continue;
    }

    // Cheap size signals only — no OCR, no Docling.
    const probe = await probeSize(buffer, resolvedMime);

    const fileName = `Canvas File: ${meta.displayName}`;
    const existing = await findMaterialByFileName(code, fileName, sourceCode);
    let matId: string;
    if (existing) {
      await updateMaterialMetadata({
        id: existing.id,
        blobUrl: storedUrl,
        mimeType: resolvedMime,
        sizeBytes: probe.sizeBytes,
      });
      matId = existing.id;
    } else {
      const mat = await insertMaterial({
        courseCode: code,
        fileName,
        blobUrl: storedUrl,
        mimeType: resolvedMime,
        sizeBytes: probe.sizeBytes,
        ipHash,
        sourceCode,
      });
      matId = mat.id;
    }

    let fileTier = 'background';
    try {
      fileTier = await classifyManifestItem({
        kind: 'file',
        fileName,
        mimeType: resolvedMime,
        sizeBytes: probe.sizeBytes,
        pageCount: probe.pageCount,
        slideCount: probe.slideCount,
      });
    } catch { /* bias background on any error */ }
    await updateMaterialTier(matId, fileTier).catch(() => { /* never fail the import */ });
    const row: ManifestRow = {
      id: matId,
      fileName,
      kind: 'file',
      mimeType: resolvedMime,
      sizeBytes: probe.sizeBytes,
      indexingStatus: 'pending',
      tier: fileTier,
    };
    if (probe.pageCount !== undefined) row.pageCount = probe.pageCount;
    if (probe.slideCount !== undefined) row.slideCount = probe.slideCount;
    manifestRows.push(row);
  }

  // ── Stamp Canvas provenance (identical to runImport) ──────────────────────
  if (sourceCode && sourceCode !== code) {
    await setPairedCanvasProvenance(sourceCode, data.course.name, new Date());
  } else {
    await updateCourseCanvasImport(code, data.course.name, new Date());
  }

  // ── Build manifest ─────────────────────────────────────────────────────────
  const decksPresent = manifestRows.some(r =>
    r.slideCount != null ||
    (r.mimeType === 'application/pdf' && (r.pageCount ?? 0) >= 3 && /slide|lecture|deck/i.test(r.fileName))
  );

  return NextResponse.json({
    manifest: {
      rows: manifestRows,
      skipped: skippedFiles,
      decksPresent,
    },
  });
}
