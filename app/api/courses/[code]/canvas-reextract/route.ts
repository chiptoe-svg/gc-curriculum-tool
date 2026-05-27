import { NextResponse } from 'next/server';
import { eq, and, like } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseMaterials } from '@/lib/db/schema';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { updateMaterialMetadata } from '@/lib/db/course-materials-queries';
import { finalizeExtraction } from '@/lib/capture/finalize-extraction';
import { createVectorStore } from '@/lib/capture/vector-store';
import { fetchCanvasFileMeta } from '@/lib/canvas/fetchCanvasCourse';
import { extractText, SUPPORTED_MIME_TYPES, type ExtractedMimeType } from '@/lib/courses/extract-text';
import { LEGACY_OFFICE_MIME_TYPES } from '@/lib/courses/material-extractor';

/**
 * Re-extract existing Canvas File attachments for a course IN PLACE,
 * using the current PDF_PARSER configuration.
 *
 * Faculty workflow this replaces: download a PDF from Canvas, upload
 * it directly to the materials panel, hope it goes through Docling.
 * With this route, faculty just paste their token and the existing
 * Canvas-imported rows refresh through whatever extractor the runtime
 * has configured.
 *
 * Same logic as scripts/reextract-canvas-files.ts, exposed as an API.
 * Updates existing rows by fileName match; does NOT insert new rows
 * (use the original canvas-import for that, or call this followed by
 * a separate import).
 */

export const maxDuration = 120;

const CANVAS_FILE_ID_RE = /\/files\/(\d+)(?:\/|\?|"|$)/g;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const EXT_TO_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

function resolveMimeType(reported: string, displayName: string): string {
  if (reported && reported !== 'application/octet-stream') return reported;
  const ext = (displayName.split('.').pop() ?? '').toLowerCase();
  return EXT_TO_MIME[ext] ?? reported;
}

interface Ctx { params: Promise<{ code: string }> }

export async function POST(req: Request, { params }: Ctx) {
  // Top-level try/catch so unhandled exceptions surface as JSON, not the
  // default Next.js HTML error page (which the client can't parse).
  try {
    return await run(req, params);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[canvas-reextract] unhandled exception:', msg);
    return NextResponse.json(
      { error: `Unexpected server error during Canvas re-extract: ${msg}` },
      { status: 500 },
    );
  }
}

async function run(req: Request, params: Ctx['params']): Promise<Response> {
  const { code } = await params;
  const body = await req.json().catch(() => ({}));
  const slug = typeof body.slug === 'string' ? body.slug : '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const canvasToken = typeof body.canvasToken === 'string' ? body.canvasToken.trim() : '';
  if (!canvasToken) return NextResponse.json({ error: 'canvasToken is required' }, { status: 400 });

  const course = await getCourseByCode(code);
  if (!course) return NextResponse.json({ error: `Course not found: ${code}` }, { status: 404 });

  // Pull the course's existing Canvas-source rows. We need:
  //   - "Canvas:*" rows (Syllabus, Assignments, etc.) for their extractedText
  //     which contains the /files/<ID> references that tell us what to refresh.
  //   - "Canvas File:*" rows as the update targets (matched by fileName).
  const sourceRows = await db
    .select({
      fileName: courseMaterials.fileName,
      extractedText: courseMaterials.extractedText,
      blobUrl: courseMaterials.blobUrl,
    })
    .from(courseMaterials)
    .where(
      and(
        eq(courseMaterials.courseCode, code),
        like(courseMaterials.fileName, 'Canvas:%'),
      ),
    );
  if (sourceRows.length === 0) {
    return NextResponse.json(
      { error: `No 'Canvas:*' rows for ${code}. Run a Canvas import first before re-extracting.` },
      { status: 400 },
    );
  }
  const blobUrl = sourceRows[0]?.blobUrl ?? '';
  let canvasBaseUrl: string;
  try {
    const parsed = new URL(blobUrl);
    canvasBaseUrl = `${parsed.protocol}//${parsed.host}`;
  } catch {
    return NextResponse.json({ error: `Invalid Canvas URL in DB: ${blobUrl}` }, { status: 500 });
  }

  const fileIds = new Set<string>();
  for (const r of sourceRows) {
    for (const m of (r.extractedText ?? '').matchAll(CANVAS_FILE_ID_RE)) {
      if (m[1]) fileIds.add(m[1]);
    }
  }

  const existingFileRows = await db
    .select({
      id: courseMaterials.id,
      fileName: courseMaterials.fileName,
    })
    .from(courseMaterials)
    .where(
      and(
        eq(courseMaterials.courseCode, code),
        like(courseMaterials.fileName, 'Canvas File:%'),
      ),
    );

  const vectorStore = createVectorStore();

  interface Result {
    fileName: string;
    status: 'updated' | 'skipped';
    reason?: string;
  }
  const results: Result[] = [];

  for (const fileId of fileIds) {
    const meta = await fetchCanvasFileMeta(canvasBaseUrl, fileId, canvasToken);
    if (!meta) {
      results.push({ fileName: `(file id ${fileId})`, status: 'skipped', reason: 'metadata not accessible' });
      continue;
    }
    const targetRow = existingFileRows.find(r => r.fileName === `Canvas File: ${meta.displayName}`);
    if (!targetRow) {
      results.push({ fileName: meta.displayName, status: 'skipped', reason: 'no matching DB row' });
      continue;
    }
    const resolvedMime = resolveMimeType(meta.mimeType, meta.displayName);
    if (LEGACY_OFFICE_MIME_TYPES.has(resolvedMime)) {
      results.push({ fileName: meta.displayName, status: 'skipped', reason: `legacy Office format ${resolvedMime} (re-save as modern)` });
      continue;
    }
    if (!(SUPPORTED_MIME_TYPES as readonly string[]).includes(resolvedMime)) {
      results.push({ fileName: meta.displayName, status: 'skipped', reason: `unsupported type ${resolvedMime}` });
      continue;
    }
    if (meta.sizeBytes > MAX_FILE_BYTES) {
      results.push({ fileName: meta.displayName, status: 'skipped', reason: `too large (${meta.sizeBytes} > ${MAX_FILE_BYTES})` });
      continue;
    }
    try {
      const dl = await fetch(meta.url, { redirect: 'follow' });
      if (!dl.ok) {
        results.push({ fileName: meta.displayName, status: 'skipped', reason: `download ${dl.status}` });
        continue;
      }
      const buffer = Buffer.from(await dl.arrayBuffer());
      const extracted = await extractText({
        fileBytes: buffer,
        mimeType: resolvedMime as ExtractedMimeType,
        fileName: meta.displayName,
      });
      if (extracted.status !== 'ok' || !extracted.text) {
        results.push({ fileName: meta.displayName, status: 'skipped', reason: `extraction ${extracted.status}` });
        continue;
      }
      await updateMaterialMetadata({
        id: targetRow.id,
        mimeType: resolvedMime,
        sizeBytes: buffer.length,
      });
      await finalizeExtraction({
        id: targetRow.id,
        courseCode: code,
        fileName: targetRow.fileName,
        extractionStatus: 'ok',
        extractionMethod: extracted.method ?? 'text',
        extractedText: extracted.text,
        ...(extracted.pageCount !== undefined && extracted.pageCount !== null && { pageCount: extracted.pageCount }),
        vectorStore,
      });
      results.push({ fileName: meta.displayName, status: 'updated' });
    } catch (e) {
      results.push({ fileName: meta.displayName, status: 'skipped', reason: e instanceof Error ? e.message : 'fetch error' });
    }
  }

  const updated = results.filter(r => r.status === 'updated').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  return NextResponse.json({ updated, skipped, results });
}
