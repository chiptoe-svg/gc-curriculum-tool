/**
 * Backfill correct MIME types on Canvas-imported file attachments.
 *
 * Before 2026-05-25 every row inserted by app/api/courses/[code]/canvas-import
 * was hard-coded `mimeType='text/html'`, even for PDF/DOCX/etc. attachments.
 * This script walks `courseMaterials`, finds rows whose fileName starts with
 * "Canvas File:" and current mimeType is 'text/html', and updates the
 * mimeType to one inferred from the filename extension.
 *
 * Safe to re-run — it skips rows that already have the correct type, and
 * it never touches non-file Canvas rows (Syllabus, Assignments, Pages,
 * Discussions, Quizzes, Module List — all correctly text/html).
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env.local scripts/backfill-canvas-file-mime-types.ts
 *   pnpm exec tsx --env-file=.env.local scripts/backfill-canvas-file-mime-types.ts --apply
 *
 * Default is a dry-run that prints the proposed changes. Pass --apply to
 * actually write to the DB.
 */

import { db } from '@/lib/db/client';
import { courseMaterials } from '@/lib/db/schema';
import { eq, and, like } from 'drizzle-orm';

const EXT_TO_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
  txt: 'text/plain',
  html: 'text/html',
  htm: 'text/html',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

function inferMimeFromFileName(fileName: string): string | null {
  // Strip the "Canvas File: " prefix and look at extension.
  const stripped = fileName.replace(/^Canvas File:\s*/, '');
  const ext = stripped.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_MIME[ext] ?? null;
}

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? 'APPLYING changes to DB\n' : 'DRY RUN (pass --apply to write)\n');

  const rows = await db
    .select({
      id: courseMaterials.id,
      courseCode: courseMaterials.courseCode,
      fileName: courseMaterials.fileName,
      mimeType: courseMaterials.mimeType,
    })
    .from(courseMaterials)
    .where(
      and(
        like(courseMaterials.fileName, 'Canvas File:%'),
        eq(courseMaterials.mimeType, 'text/html'),
      ),
    );

  console.log(`Found ${rows.length} Canvas File rows currently stored as text/html.\n`);
  if (rows.length === 0) {
    console.log('Nothing to do.');
    process.exit(0);
  }

  const updates: Array<{ id: string; newMime: string }> = [];
  const skipped: Array<{ fileName: string; reason: string }> = [];

  for (const r of rows) {
    const inferred = inferMimeFromFileName(r.fileName);
    if (!inferred) {
      skipped.push({ fileName: r.fileName, reason: 'unknown extension' });
      continue;
    }
    if (inferred === r.mimeType) continue;  // already correct (shouldn't happen given filter)
    updates.push({ id: r.id, newMime: inferred });
    console.log(`  ${r.courseCode.padEnd(10)} ${r.fileName.padEnd(60)}  text/html  →  ${inferred}`);
  }

  if (skipped.length > 0) {
    console.log(`\nSkipped (${skipped.length}):`);
    for (const s of skipped) console.log(`  ${s.fileName.padEnd(60)}  (${s.reason})`);
  }

  console.log(`\n${updates.length} row(s) would be updated.`);
  if (!apply) {
    console.log('Re-run with --apply to commit.');
    process.exit(0);
  }

  for (const u of updates) {
    await db.update(courseMaterials)
      .set({ mimeType: u.newMime })
      .where(eq(courseMaterials.id, u.id));
  }
  console.log(`\nDone. ${updates.length} row(s) updated.`);
  process.exit(0);
}

main().catch(e => {
  console.error('FATAL:', e instanceof Error ? e.message : e);
  if (e instanceof Error && e.stack) console.error(e.stack);
  process.exit(1);
});
