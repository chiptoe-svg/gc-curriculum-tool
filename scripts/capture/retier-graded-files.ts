#!/usr/bin/env tsx
/**
 * One-time: re-sort background-tier files with the graded-material sorter
 * (owner, 2026-10-27). The file sorter could only choose middle or background,
 * so uploaded rubrics, assignment briefs and samples of student work were read
 * only as a one-paragraph digest (GC 3700, GC 3630, MKT 3310 and others). It
 * can now choose 'high' (lib/capture/material-tier.ts).
 *
 * Asks the sorter about every active, non-syllabus, background-tier material
 * with stored text (filename, type, size and the first 500 characters). Those
 * it now calls 'high' get tier 'high' and indexing_status 'queued'; the app's
 * ingest worker re-reads them from the stored text on the next boot. The dry
 * run also calls the sorter (gpt-5.4-mini; well under a dollar for every row).
 *
 * Usage (DATABASE_URL from .env.local; never printed):
 *   node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs \
 *     scripts/capture/retier-graded-files.ts --expect-db gc_curriculum [--apply]   # default: dry run
 *
 * Exit codes: 0 ok, 1 wrong DB, 2 usage, 4 apply failed.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseMaterials } from '@/lib/db/schema';
import { classifyFile, type Tier } from '@/lib/capture/material-tier';
import { loadAppEnv, isMainModule, formatDbError, assertExpectedDb } from '@/scripts/catalog/catalog-source';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Tx | typeof db;
type Classify = (sig: { fileName: string; mimeType: string; sizeBytes: number; pageCount?: number; peekText?: string }) => Promise<Tier>;

export interface RetierRow { id: string; courseCode: string; fileName: string }

export async function planRetier(ex: Executor, classify: Classify = classifyFile): Promise<RetierRow[]> {
  const rows = await ex.select({
    id: courseMaterials.id, courseCode: courseMaterials.courseCode, fileName: courseMaterials.fileName,
    mimeType: courseMaterials.mimeType, sizeBytes: courseMaterials.sizeBytes, pageCount: courseMaterials.pageCount,
    peek: sql<string>`left(${courseMaterials.extractedText}, 500)`,
  })
    .from(courseMaterials)
    .where(and(
      eq(courseMaterials.tier, 'background'),
      eq(courseMaterials.isSyllabus, false),
      eq(courseMaterials.ignored, false),
      isNull(courseMaterials.retiredAt),
      sql`length(btrim(coalesce(${courseMaterials.extractedText}, ''))) > 0`,
    ))
    .orderBy(courseMaterials.courseCode, courseMaterials.fileName);
  const plan: RetierRow[] = [];
  for (const r of rows) {
    const tier = await classify({ fileName: r.fileName, mimeType: r.mimeType, sizeBytes: r.sizeBytes, pageCount: r.pageCount ?? undefined, peekText: r.peek });
    if (tier === 'high') plan.push({ id: r.id, courseCode: r.courseCode, fileName: r.fileName });
  }
  return plan;
}

export async function applyRetier(ex: Executor, plan: RetierRow[]): Promise<void> {
  if (plan.length === 0) return;
  await ex.update(courseMaterials)
    .set({ tier: 'high', indexingStatus: 'queued' })
    .where(inArray(courseMaterials.id, plan.map(p => p.id)));
}

export async function main(argv: string[]): Promise<number> {
  const i = argv.indexOf('--expect-db');
  const expectDb = i >= 0 ? argv[i + 1] : undefined;
  if (!expectDb) { console.error('usage: --expect-db <name> [--apply]'); return 2; }
  try { await assertExpectedDb(expectDb); } catch (err) { console.error(formatDbError(err)); return 1; }

  const plan = await planRetier(db);
  for (const p of plan) console.log(`re-read  ${p.courseCode}  ${p.fileName}  (background -> high)`);
  if (!argv.includes('--apply')) {
    console.log(`DRY RUN: would queue ${plan.length} files at high tier (nothing written).`);
    return 0;
  }
  try {
    await db.transaction(tx => applyRetier(tx, plan));
  } catch (err) { console.error(formatDbError(err)); return 4; }
  console.log(`queued ${plan.length} files at high tier. Restart the app so the ingest worker reads them.`);
  return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadAppEnv();
  void main(process.argv.slice(2)).then(code => process.exit(code));
}
