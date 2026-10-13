/**
 * P1 Task 4 — O*NET 31.0 reference-store loader CLI.
 *
 * Reads the O*NET 31.0 CSV export from --dir (git-ignored, never committed —
 * see global-constraints.md), reads the "rated" O*NET-SOC codes straight
 * from career_target_occupations (Task 3's ingest), loads occupations +
 * element ratings + task statements + task ratings for exactly those codes
 * into the 0058 onet_* tables, and upserts the onet_release attribution row.
 * See lib/onet/load.ts (the pure parser) and
 * docs/superpowers/plans/2026-10-12-competency-catalog-p1.md Ruling 5.
 *
 * Usage (from the repo root, with DATABASE_URL set explicitly — never read
 * from .env.local by hand; get a scratch URL via
 * scripts/migrations/p1-scratch-db.sh url):
 *   node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs \
 *     scripts/onet/load-onet.ts \
 *     --dir scratch/onet/31.0 --release 31.0 --expect-db gc_curriculum_p1_scratch [--dry-run]
 *
 * Safety discipline:
 *   - --expect-db is REQUIRED; assertExpectedDb runs before any other read
 *     (the rated-code query, the CSV reads, everything) and refuses on a
 *     mismatch against current_database().
 *   - --dry-run reads everything and prints row counts; writes nothing.
 *   - Default (no --dry-run) loads: one transaction deletes every existing
 *     onet_occupations row for this release (cascading to its element
 *     ratings / task statements / task ratings via the 0058 FKs) and
 *     reinserts the freshly-read data for the current rated-code set — so
 *     a re-run with an unchanged mix is a no-op content-wise, and a re-run
 *     after a mix change (Ruling 5) picks up added/dropped codes cleanly.
 *   - Never prints DATABASE_URL or any other credential.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  careerTargetOccupations,
  onetRelease,
  onetOccupations,
  onetElementRatings,
  onetTaskStatements,
  onetTaskRatings,
} from '@/lib/db/schema';
import {
  domainForFile,
  filterToCodes,
  parseOccupationDataCsv,
  parseElementRatingsCsv,
  parseTaskStatementsCsv,
  parseTaskRatingsCsv,
  ELEMENT_FILENAMES,
  ONET_PUBLISHED,
  ONET_LICENSE,
  ONET_ATTRIBUTION,
  ONET_SOURCE_URL,
  type RawOccupation,
  type RawElementRating,
  type RawTaskStatement,
  type RawTaskRating,
} from '@/lib/onet/load';
import { loadAppEnv, isMainModule } from '@/scripts/catalog/catalog-source';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Tx | typeof db;

// ─── CLI args ───────────────────────────────────────────────────────────────

export interface LoadArgs {
  dir: string;
  release: string;
  expectDb: string;
  dryRun: boolean;
}

function argValueFrom(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Throws if --dir, --release or --expect-db is missing. */
export function parseArgs(argv: string[]): LoadArgs {
  const dir = argValueFrom(argv, '--dir');
  const release = argValueFrom(argv, '--release');
  const expectDb = argValueFrom(argv, '--expect-db');
  if (!dir || !release || !expectDb) {
    throw new Error('usage: --dir <path to O*NET csvs> --release <e.g. 31.0> --expect-db <name> [--dry-run]');
  }
  return { dir, release, expectDb, dryRun: argv.includes('--dry-run') };
}

/**
 * The ONLY database-identity check this script makes. Must run (and must
 * reject on a mismatch) before any other read — the rated-code query, the
 * CSV reads, everything.
 */
export async function assertExpectedDb(expectDb: string, executor: Executor = db): Promise<void> {
  const result = await executor.execute(sql`SELECT current_database() AS name`);
  const actual = (result.rows[0] as { name: string }).name;
  if (actual !== expectDb) {
    throw new Error(`refusing: connected to database '${actual}', expected '${expectDb}' (--expect-db) — no read performed`);
  }
}

// ─── Rated-code lookup (Ruling 5: "rated" = career_target_occupations.onet_status = 'rated') ──

export async function readRatedOnetCodes(executor: Executor = db): Promise<Set<string>> {
  const rows = await executor
    .select({ onetSocCode: careerTargetOccupations.onetSocCode })
    .from(careerTargetOccupations)
    .where(eq(careerTargetOccupations.onetStatus, 'rated'));
  const codes = new Set<string>();
  for (const r of rows) {
    if (r.onetSocCode) codes.add(r.onetSocCode);
  }
  return codes;
}

// ─── CSV read + filter ──────────────────────────────────────────────────────

export interface LoadedData {
  occupations: RawOccupation[];
  elementRatings: RawElementRating[];
  taskStatements: RawTaskStatement[];
  taskRatings: RawTaskRating[];
  skippedElementScaleCount: number;
  skippedTaskRatingScaleCount: number;
}

/** Reads every O*NET CSV under dir and filters every row to `codes`. */
export function readAndFilter(dir: string, codes: ReadonlySet<string>): LoadedData {
  const occAll = parseOccupationDataCsv(readFileSync(path.join(dir, 'occupation_data.csv'), 'utf8'), 'occupation_data.csv').rows;
  const occupations = filterToCodes(occAll, codes);

  const elementRatings: RawElementRating[] = [];
  let skippedElementScaleCount = 0;
  for (const filename of ELEMENT_FILENAMES) {
    const domain = domainForFile(filename);
    const content = readFileSync(path.join(dir, filename), 'utf8');
    const { rows, skippedScaleCount } = parseElementRatingsCsv(content, filename, domain);
    elementRatings.push(...filterToCodes(rows, codes));
    skippedElementScaleCount += skippedScaleCount;
  }

  const statementsAll = parseTaskStatementsCsv(readFileSync(path.join(dir, 'task_statements.csv'), 'utf8'), 'task_statements.csv').rows;
  const taskStatements = filterToCodes(statementsAll, codes);

  const { rows: ratingsAll, skippedScaleCount: skippedTaskRatingScaleCount } =
    parseTaskRatingsCsv(readFileSync(path.join(dir, 'task_ratings.csv'), 'utf8'), 'task_ratings.csv');
  const taskRatings = filterToCodes(ratingsAll, codes);

  return { occupations, elementRatings, taskStatements, taskRatings, skippedElementScaleCount, skippedTaskRatingScaleCount };
}

// ─── Write (Ruling 5: idempotent per release, re-runnable after a mix change) ──

// drizzle-orm@0.45.2's SQL builder recurses per row when merging a single
// multi-row insert's bound params; a release's full element-ratings
// (~31k rows) or task-ratings (~18k rows) batch blows the call stack in one
// insert() call. Chunking keeps each insert() small regardless of total
// row count — still inside the one writeOnetStore transaction, so a
// mid-chunk failure rolls back everything written so far.
const INSERT_CHUNK_SIZE = 500;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Upserts onet_release, then replaces every onet_occupations row for
 * `release` (and, via ON DELETE CASCADE, its element ratings / task
 * statements / task ratings) with the freshly-read `data`. One transaction
 * (the caller passes a `tx` from db.transaction, or `db` directly) — a
 * re-run with the same CSVs and the same rated-code set reproduces
 * byte-identical row content; a re-run after the mix changes picks up
 * added/dropped codes cleanly, since the whole release's occupation set is
 * replaced rather than patched per-code.
 */
export async function writeOnetStore(executor: Executor, release: string, data: LoadedData): Promise<void> {
  await executor
    .insert(onetRelease)
    .values({ release, published: ONET_PUBLISHED, license: ONET_LICENSE, attribution: ONET_ATTRIBUTION, sourceUrl: ONET_SOURCE_URL })
    .onConflictDoUpdate({
      target: onetRelease.release,
      set: { published: ONET_PUBLISHED, license: ONET_LICENSE, attribution: ONET_ATTRIBUTION, sourceUrl: ONET_SOURCE_URL },
    });

  await executor.delete(onetOccupations).where(eq(onetOccupations.release, release));

  if (data.occupations.length === 0) return;

  for (const batch of chunk(data.occupations, INSERT_CHUNK_SIZE)) {
    await executor.insert(onetOccupations).values(
      batch.map(o => ({ release, onetSocCode: o.onetSocCode, title: o.title, description: o.description })),
    );
  }

  for (const batch of chunk(data.elementRatings, INSERT_CHUNK_SIZE)) {
    await executor.insert(onetElementRatings).values(
      batch.map(r => ({
        release, onetSocCode: r.onetSocCode, domain: r.domain, elementId: r.elementId, elementName: r.elementName,
        scaleId: r.scaleId, dataValue: r.dataValue, n: r.n, standardError: r.standardError,
        recommendSuppress: r.recommendSuppress, notRelevant: r.notRelevant, dateText: r.dateText, domainSource: r.domainSource,
      })),
    );
  }

  for (const batch of chunk(data.taskStatements, INSERT_CHUNK_SIZE)) {
    await executor.insert(onetTaskStatements).values(
      batch.map(t => ({ release, onetSocCode: t.onetSocCode, taskId: t.taskId, task: t.task, taskType: t.taskType })),
    );
  }

  for (const batch of chunk(data.taskRatings, INSERT_CHUNK_SIZE)) {
    await executor.insert(onetTaskRatings).values(
      batch.map(r => ({
        release, onetSocCode: r.onetSocCode, taskId: r.taskId, scaleId: r.scaleId, category: r.category,
        dataValue: r.dataValue, n: r.n, standardError: r.standardError, recommendSuppress: r.recommendSuppress,
        dateText: r.dateText, domainSource: r.domainSource,
      })),
    );
  }
}

// ─── Report ─────────────────────────────────────────────────────────────────

export function printReport(args: LoadArgs, codes: ReadonlySet<string>, data: LoadedData): void {
  console.log(`mode: ${args.dryRun ? 'DRY RUN' : 'LOAD'}  expect-db: ${args.expectDb}  dir: ${args.dir}  release: ${args.release}`);
  console.log(`rated O*NET codes (from career_target_occupations): ${codes.size}`);
  console.log(`occupations: ${data.occupations.length}`);
  console.log(`element ratings: ${data.elementRatings.length}  (skipped ${data.skippedElementScaleCount} rows on a non-IM/LV scale)`);
  console.log(`task statements: ${data.taskStatements.length}`);
  console.log(`task ratings: ${data.taskRatings.length}  (skipped ${data.skippedTaskRatingScaleCount} rows on a non-IM/RT/FT scale)`);
  console.log(args.dryRun ? '\nDRY RUN — nothing written.' : `\nLOAD — onet_occupations (release ${args.release}) replaced; children cascade.`);
}

// ─── Entry point ────────────────────────────────────────────────────────────

export interface LoadDeps {
  executor?: Executor;
  readRatedOnetCodes?: typeof readRatedOnetCodes;
  readAndFilter?: typeof readAndFilter;
  writeOnetStore?: typeof writeOnetStore;
}

/**
 * Returns an exit code rather than calling process.exit itself, so tests can
 * call this directly. Order: parse args -> assertExpectedDb (the ONLY
 * db-identity check, before any other read) -> read rated codes -> read +
 * filter CSVs -> report -> (unless --dry-run) write in one transaction.
 */
export async function main(argv: string[], deps: LoadDeps = {}): Promise<number> {
  let args: LoadArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }

  const executor = deps.executor ?? db;
  try {
    await assertExpectedDb(args.expectDb, executor);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const readCodes = deps.readRatedOnetCodes ?? readRatedOnetCodes;
  const readFilter = deps.readAndFilter ?? readAndFilter;

  let codes: Set<string>;
  let data: LoadedData;
  try {
    codes = await readCodes(executor);
    data = readFilter(args.dir, codes);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 3;
  }

  printReport(args, codes, data);

  if (args.dryRun) {
    return 0;
  }

  const write = deps.writeOnetStore ?? writeOnetStore;
  if (executor === db) {
    await db.transaction(async (tx) => {
      await write(tx, args.release, data);
    });
  } else {
    // Already inside a transaction the caller controls (tests).
    await write(executor, args.release, data);
  }

  return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadAppEnv();
  void main(process.argv.slice(2)).then(code => process.exit(code));
}
