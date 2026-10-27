#!/usr/bin/env tsx
/**
 * One-time: re-read syllabi that were filed below 'high' (owner, 2026-10-27).
 * Syllabus-box uploads used to go through the file classifier, which put eight
 * of them in 'background': only a short digest was searchable, and GC 4400's
 * graded-project table never reached its profile. New uploads are now always
 * 'high' (app/api/courses/[code]/materials/route.ts).
 *
 * For every active (not retired) syllabus whose tier is not 'high' and whose
 * text is stored, sets tier 'high' and indexing_status 'queued'. The app's
 * ingest worker drains 'queued' rows on server boot, re-reading from the stored
 * text (the raw file is not needed). Restart the app after --apply.
 *
 * Usage (DATABASE_URL from .env.local; never printed):
 *   node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs \
 *     scripts/capture/reread-syllabi.ts --expect-db gc_curriculum [--apply]   # default: dry run
 *
 * Exit codes: 0 ok, 1 wrong DB, 2 usage, 4 apply failed.
 */
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseMaterials } from '@/lib/db/schema';
import { loadAppEnv, isMainModule, formatDbError, assertExpectedDb } from '@/scripts/catalog/catalog-source';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Tx | typeof db;

export interface RereadRow { id: string; courseCode: string; fileName: string; tier: string | null }

export async function planReread(ex: Executor): Promise<RereadRow[]> {
  return ex.select({ id: courseMaterials.id, courseCode: courseMaterials.courseCode, fileName: courseMaterials.fileName, tier: courseMaterials.tier })
    .from(courseMaterials)
    .where(and(
      eq(courseMaterials.isSyllabus, true),
      isNull(courseMaterials.retiredAt),
      // An explicit lower tier; a null tier is already read at full depth (and
      // SQL's <> skips nulls).
      ne(courseMaterials.tier, 'high'),
      sql`length(btrim(coalesce(${courseMaterials.extractedText}, ''))) > 0`,
    ))
    .orderBy(courseMaterials.courseCode, courseMaterials.fileName);
}

export async function applyReread(ex: Executor, plan: RereadRow[]): Promise<void> {
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

  const plan = await planReread(db);
  for (const p of plan) console.log(`re-read  ${p.courseCode}  ${p.fileName}  (${p.tier} -> high)`);
  if (!argv.includes('--apply')) {
    console.log(`DRY RUN: would queue ${plan.length} syllabi at high tier (nothing written).`);
    return 0;
  }
  try {
    await db.transaction(tx => applyReread(tx, plan));
  } catch (err) { console.error(formatDbError(err)); return 4; }
  console.log(`queued ${plan.length} syllabi at high tier. Restart the app so the ingest worker reads them.`);
  return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadAppEnv();
  void main(process.argv.slice(2)).then(code => process.exit(code));
}
