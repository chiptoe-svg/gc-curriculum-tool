/**
 * P1 Task 3 — alumni occupation-mix ingest CLI.
 *
 * Reads gc_alumni's career_demand.json export (read-only — gc_alumni is a
 * separate repo, never edited here), classifies each SOC against the
 * O*NET codes rated in a given 31.0 knowledge.csv (--onet-dir), and writes
 * career_target_occupations rows for `source = 'alumni_rule'` — see
 * lib/careers/alumni-mix.ts (the pure transform) and
 * docs/superpowers/plans/2026-10-12-competency-catalog-p1.md Rulings 1-4.
 *
 * Usage (from the repo root, with DATABASE_URL set explicitly — never read
 * from .env.local by hand; get a scratch URL via
 * scripts/migrations/p1-scratch-db.sh url):
 *   node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs \
 *     scripts/careers/ingest-alumni-mix.ts \
 *     --file /path/to/career_demand.json \
 *     --onet-dir scratch/onet/31.0 \
 *     --expect-db gc_curriculum_p1_scratch            # default: dry run, writes nothing
 *   ... --apply --expect-db gc_curriculum_p1_scratch   # replaces the alumni_rule rows
 *
 * Safety discipline:
 *   - --expect-db is REQUIRED; assertExpectedDb runs before any other read
 *     (the file read, the knowledge.csv scan, everything) and refuses on a
 *     mismatch against current_database().
 *   - --dry-run is the default (no --apply flag needed): it reads the
 *     export and the O*NET codes, builds the mix, and prints the
 *     per-(target, horizon) row counts and unrated/no-fit shares — it
 *     writes nothing.
 *   - --apply replaces every `source = 'alumni_rule'` row in ONE
 *     transaction (Ruling 4); `source = 'faculty'` rows are never touched.
 *     Re-running with the same export (same source_version) changes
 *     nothing, since the computed rows are deterministic from the export.
 *   - Never prints DATABASE_URL or any other credential.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { careerTargetOccupations } from '@/lib/db/schema';
import { buildOccupationMix, type OccupationMixRow, type Horizon } from '@/lib/careers/alumni-mix';
import { loadAppEnv, isMainModule } from '@/scripts/catalog/catalog-source';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Tx | typeof db;

// ─── CLI args ───────────────────────────────────────────────────────────────

export interface IngestArgs {
  file: string;
  onetDir: string;
  expectDb: string;
  apply: boolean;
}

function argValueFrom(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Throws if --file, --onet-dir or --expect-db is missing. */
export function parseArgs(argv: string[]): IngestArgs {
  const file = argValueFrom(argv, '--file');
  const onetDir = argValueFrom(argv, '--onet-dir');
  const expectDb = argValueFrom(argv, '--expect-db');
  if (!file || !onetDir || !expectDb) {
    throw new Error('usage: --file <career_demand.json> --onet-dir <dir containing knowledge.csv> --expect-db <name> [--apply]');
  }
  return { file, onetDir, expectDb, apply: argv.includes('--apply') };
}

/**
 * The ONLY database-identity check this script makes. Must run (and must
 * reject on a mismatch) before any other read — the export file, the
 * knowledge.csv scan, everything.
 */
export async function assertExpectedDb(expectDb: string, executor: Executor = db): Promise<void> {
  const result = await executor.execute(sql`SELECT current_database() AS name`);
  const actual = (result.rows[0] as { name: string }).name;
  if (actual !== expectDb) {
    throw new Error(`refusing: connected to database '${actual}', expected '${expectDb}' (--expect-db) — no read performed`);
  }
}

// ─── I/O: export file + O*NET rated-code set ───────────────────────────────

export function loadExportJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * Every O*NET-SOC code with at least one row in <onetDir>/knowledge.csv —
 * the controller ruling for "rated". The O*NET-SOC Code is always the
 * CSV's first column and is never quote-wrapped (it has no comma in it),
 * even though later columns (e.g. Title) can be — confirmed against the
 * real 31.0 file, so a plain "up to the first comma" split is safe and
 * avoids pulling in a CSV-parsing dependency for a single-column read of a
 * file this large (knowledge.csv alone is ~8MB).
 */
export function loadRatedOnetCodes(onetDir: string): Set<string> {
  const csvPath = path.join(onetDir, 'knowledge.csv');
  const content = readFileSync(csvPath, 'utf8');
  const codes = new Set<string>();
  const lines = content.split('\n');
  for (let i = 1; i < lines.length; i++) { // skip header
    const line = lines[i];
    if (!line) continue;
    const comma = line.indexOf(',');
    if (comma <= 0) continue;
    codes.add(line.slice(0, comma));
  }
  return codes;
}

// ─── Write (Ruling 4: replace semantics) ───────────────────────────────────

/**
 * Replaces every `source = 'alumni_rule'` row in career_target_occupations
 * with `rows`, in one transaction (the caller passes a `tx` from
 * db.transaction, or `db` directly). `source = 'faculty'` rows are never
 * touched. Deterministic input (same export) re-run produces the same
 * final row content — only `id`/`created_at` change across a delete+insert,
 * never the data the ingest is responsible for.
 */
export async function writeOccupationMix(executor: Executor, rows: OccupationMixRow[]): Promise<void> {
  await executor.delete(careerTargetOccupations).where(eq(careerTargetOccupations.source, 'alumni_rule'));
  if (rows.length === 0) return;
  await executor.insert(careerTargetOccupations).values(
    rows.map(r => ({
      careerTargetId: r.careerTargetId,
      horizon: r.horizon,
      socCode: r.socCode,
      onetSocCode: r.onetSocCode,
      onetStatus: r.onetStatus,
      count: r.count,
      share: r.share,
      source: 'alumni_rule' as const,
      sourceVersion: r.sourceVersion,
      asOf: r.asOf,
    })),
  );
}

// ─── Report ─────────────────────────────────────────────────────────────────

export interface TargetHorizonSummary {
  careerTargetId: string;
  horizon: Horizon;
  rowCount: number;
  ratedShare: number;
  unratedShare: number;
  noFitShare: number;
}

/** One row per (careerTargetId, horizon), sorted for a deterministic report. */
export function summarize(rows: OccupationMixRow[]): TargetHorizonSummary[] {
  const key = (r: OccupationMixRow) => `${r.careerTargetId}\u0000${r.horizon}`;
  const groups = new Map<string, OccupationMixRow[]>();
  for (const r of rows) {
    const k = key(r);
    const g = groups.get(k);
    if (g) g.push(r); else groups.set(k, [r]);
  }
  const out: TargetHorizonSummary[] = [];
  for (const group of groups.values()) {
    const { careerTargetId, horizon } = group[0]!;
    const sumWhere = (status: OccupationMixRow['onetStatus']) =>
      group.filter(r => r.onetStatus === status).reduce((s, r) => s + r.share, 0);
    out.push({
      careerTargetId,
      horizon,
      rowCount: group.length,
      ratedShare: sumWhere('rated'),
      unratedShare: sumWhere('unrated'),
      noFitShare: sumWhere('no_fit'),
    });
  }
  out.sort((a, b) => (a.careerTargetId + a.horizon).localeCompare(b.careerTargetId + b.horizon));
  return out;
}

export function printReport(args: IngestArgs, rows: OccupationMixRow[], warnings: string[]): void {
  console.log(`mode: ${args.apply ? 'APPLY' : 'DRY RUN'}  expect-db: ${args.expectDb}  file: ${args.file}  onet-dir: ${args.onetDir}`);
  console.log(`total rows: ${rows.length}`);
  console.log('\ncareer_target_id | horizon | rows | rated share | unrated share | no_fit share');
  for (const s of summarize(rows)) {
    console.log(`${s.careerTargetId} | ${s.horizon} | ${s.rowCount} | ${s.ratedShare.toFixed(4)} | ${s.unratedShare.toFixed(4)} | ${s.noFitShare.toFixed(4)}`);
  }
  if (warnings.length > 0) {
    console.log(`\n${warnings.length} warning(s):`);
    for (const w of warnings) console.log(`  - ${w}`);
  }
  console.log(args.apply ? '\nAPPLY — alumni_rule rows replaced; faculty rows untouched.' : '\nDRY RUN — nothing written.');
}

// ─── Entry point ────────────────────────────────────────────────────────────

export interface IngestDeps {
  executor?: Executor;
  loadExportJson?: typeof loadExportJson;
  loadRatedOnetCodes?: typeof loadRatedOnetCodes;
  buildOccupationMix?: typeof buildOccupationMix;
  writeOccupationMix?: typeof writeOccupationMix;
}

/**
 * Returns an exit code rather than calling process.exit itself, so tests can
 * call this directly. Order: parse args -> assertExpectedDb (the ONLY
 * db-identity check, before any other read) -> read export + O*NET codes ->
 * build the mix -> report -> (if --apply) write in one transaction.
 */
export async function main(argv: string[], deps: IngestDeps = {}): Promise<number> {
  let args: IngestArgs;
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

  const loadExport = deps.loadExportJson ?? loadExportJson;
  const loadRated = deps.loadRatedOnetCodes ?? loadRatedOnetCodes;
  const build = deps.buildOccupationMix ?? buildOccupationMix;

  let rows: OccupationMixRow[];
  let warnings: string[];
  try {
    const exportJson = loadExport(args.file);
    const ratedOnetCodes = loadRated(args.onetDir);
    const built = build(exportJson, ratedOnetCodes);
    rows = built.rows;
    warnings = built.warnings;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 3;
  }

  printReport(args, rows, warnings);

  if (!args.apply) {
    return 0;
  }

  const write = deps.writeOccupationMix ?? writeOccupationMix;
  if (executor === db) {
    await db.transaction(async (tx) => {
      await write(tx, rows);
    });
  } else {
    // Already inside a transaction the caller controls (tests).
    await write(executor, rows);
  }

  return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadAppEnv();
  void main(process.argv.slice(2)).then(code => process.exit(code));
}
