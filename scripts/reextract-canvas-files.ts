/**
 * Re-extract Canvas File attachments for a course IN PLACE, using the
 * current PDF_PARSER configuration (Docling locally; unpdf in serverless).
 *
 * Why not just "re-import"? The canvas-import route always INSERTS new
 * rows — re-running it duplicates everything (syllabus, assignments,
 * every PDF). This script preserves row identity and only refreshes the
 * extractedText / mimeType / pageCount fields on existing Canvas File rows.
 *
 * Strategy:
 *   1. Pull all `Canvas:*` rows for the course (Syllabus, Assignments,
 *      Pages, Discussions, Quizzes, Module List) and scan their stored
 *      extractedText for `/files/<ID>` references. This recovers the
 *      Canvas file IDs that were referenced at the original import time
 *      without re-fetching the whole course from Canvas.
 *   2. For each file ID, fetch fresh metadata + download URL from Canvas
 *      (needs your token).
 *   3. Match Canvas's display_name to the existing `Canvas File: X`
 *      rows by filename suffix.
 *   4. Download the file, re-extract via current pipeline, UPDATE the
 *      existing row in place.
 *
 * Usage:
 *   CANVAS_TOKEN=… pnpm exec tsx --env-file=.env.local \
 *     scripts/reextract-canvas-files.ts <course-code>
 *   CANVAS_TOKEN=… pnpm exec tsx --env-file=.env.local \
 *     scripts/reextract-canvas-files.ts <course-code> --apply
 *
 * Default is dry-run (lists what would be re-extracted). Pass --apply
 * to write the new text back to the DB.
 *
 * Requires:
 *   - .env.local with DATABASE_URL pointed at the right Postgres
 *   - CANVAS_TOKEN env var
 *   - If PDF_PARSER=docling, docling-serve must be running locally
 */

import { db } from '@/lib/db/client';
import { courseMaterials } from '@/lib/db/schema';
import { eq, and, like } from 'drizzle-orm';
import { fetchCanvasFileMeta } from '@/lib/canvas/fetchCanvasCourse';
import { extractText, SUPPORTED_MIME_TYPES, type ExtractedMimeType } from '@/lib/courses/extract-text';
import { LEGACY_OFFICE_MIME_TYPES } from '@/lib/courses/material-extractor';
import { parseCanvasUrl } from '@/lib/canvas/parseCanvasUrl';

// Map filename extension → modern MIME type for cases where Canvas reports
// an empty or missing content-type. Mirrors the EXT_TO_MIME table in the
// backfill script.
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

const CANVAS_FILE_ID_RE = /\/files\/(\d+)(?:\/|\?|"|$)/g;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

async function main() {
  const courseCode = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!courseCode) {
    console.error('Usage: reextract-canvas-files.ts <course-code> [--apply]');
    process.exit(1);
  }
  const token = process.env.CANVAS_TOKEN;
  if (!token) {
    console.error('CANVAS_TOKEN env var required.');
    process.exit(1);
  }

  console.log(`Re-extracting Canvas files for course ${courseCode}`);
  console.log(apply ? 'APPLYING changes to DB\n' : 'DRY RUN (pass --apply to write)\n');

  // Step 1: all course rows for the course (excluding Canvas File ones — we
  // need those LATER as the update targets; right now we just want the
  // referencing text).
  const sourceRows = await db
    .select({
      fileName: courseMaterials.fileName,
      extractedText: courseMaterials.extractedText,
      blobUrl: courseMaterials.blobUrl,
    })
    .from(courseMaterials)
    .where(
      and(
        eq(courseMaterials.courseCode, courseCode),
        like(courseMaterials.fileName, 'Canvas:%'),
      ),
    );
  if (sourceRows.length === 0) {
    console.error(`No 'Canvas:*' rows found for ${courseCode}. Was Canvas ever imported here?`);
    process.exit(1);
  }
  const canvasUrl = sourceRows[0]?.blobUrl;
  if (!canvasUrl) {
    console.error('No blobUrl found on the source rows.');
    process.exit(1);
  }
  let canvasBaseUrl: string;
  try {
    const parsed = new URL(canvasUrl);
    canvasBaseUrl = `${parsed.protocol}//${parsed.host}`;
  } catch {
    console.error(`Invalid Canvas URL in DB: ${canvasUrl}`);
    process.exit(1);
  }

  // Scan source rows for file IDs.
  const fileIds = new Set<string>();
  for (const r of sourceRows) {
    for (const m of (r.extractedText ?? '').matchAll(CANVAS_FILE_ID_RE)) {
      if (m[1]) fileIds.add(m[1]);
    }
  }
  console.log(`Scanned ${sourceRows.length} source rows, found ${fileIds.size} unique file IDs.\n`);

  // Step 2-4: for each file ID, fetch meta, match to existing row, re-extract.
  const existingFileRows = await db
    .select({
      id: courseMaterials.id,
      fileName: courseMaterials.fileName,
      mimeType: courseMaterials.mimeType,
    })
    .from(courseMaterials)
    .where(
      and(
        eq(courseMaterials.courseCode, courseCode),
        like(courseMaterials.fileName, 'Canvas File:%'),
      ),
    );
  console.log(`Existing 'Canvas File:*' rows in DB: ${existingFileRows.length}\n`);

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  for (const fileId of fileIds) {
    processed++;
    const meta = await fetchCanvasFileMeta(canvasBaseUrl, fileId, token);
    if (!meta) {
      console.log(`  [skip] file id ${fileId} — metadata not accessible`);
      skipped++;
      continue;
    }
    const targetRow = existingFileRows.find(r => r.fileName === `Canvas File: ${meta.displayName}`);
    if (!targetRow) {
      console.log(`  [skip] ${meta.displayName} — no matching DB row (was added after original import?)`);
      skipped++;
      continue;
    }
    const resolvedMime = resolveMimeType(meta.mimeType, meta.displayName);
    if (LEGACY_OFFICE_MIME_TYPES.has(resolvedMime)) {
      console.log(`  [skip] ${meta.displayName} — legacy Office format (${resolvedMime}); re-save as modern format`);
      skipped++;
      continue;
    }
    if (!(SUPPORTED_MIME_TYPES as readonly string[]).includes(resolvedMime)) {
      console.log(`  [skip] ${meta.displayName} — unsupported type ${resolvedMime}`);
      skipped++;
      continue;
    }
    if (meta.sizeBytes > MAX_FILE_BYTES) {
      console.log(`  [skip] ${meta.displayName} — too large (${meta.sizeBytes} > ${MAX_FILE_BYTES})`);
      skipped++;
      continue;
    }

    console.log(`  ${meta.displayName} (${meta.sizeBytes.toLocaleString()} bytes, ${resolvedMime})`);

    if (!apply) continue;

    const dl = await fetch(meta.url, { redirect: 'follow' });
    if (!dl.ok) {
      console.log(`    download failed: ${dl.status}`);
      skipped++;
      continue;
    }
    const buffer = Buffer.from(await dl.arrayBuffer());
    const result = await extractText({ fileBytes: buffer, mimeType: resolvedMime as ExtractedMimeType, fileName: meta.displayName });
    if (result.status !== 'ok' || !result.text) {
      console.log(`    extraction failed (${result.status})`);
      skipped++;
      continue;
    }
    await db.update(courseMaterials)
      .set({
        extractedText: result.text,
        extractionStatus: 'ok',
        extractionMethod: result.method ?? 'text',
        pageCount: result.pageCount ?? null,
        mimeType: resolvedMime,
        sizeBytes: buffer.length,
      })
      .where(eq(courseMaterials.id, targetRow.id));
    console.log(`    ✓ updated, ${result.text.length} chars, ${result.pageCount ?? '?'} pages, via ${result.method ?? '?'}`);
    updated++;
  }

  // parseCanvasUrl is imported but not used directly here — kept for future
  // robustness (e.g., when blobUrl points at a page other than the course root).
  void parseCanvasUrl;

  console.log(`\nProcessed: ${processed}  Updated: ${updated}  Skipped: ${skipped}`);
  if (!apply && processed > 0) console.log('Re-run with --apply to commit.');
  process.exit(0);
}

main().catch(e => {
  console.error('FATAL:', e instanceof Error ? e.message : e);
  if (e instanceof Error && e.stack) console.error(e.stack);
  process.exit(1);
});
