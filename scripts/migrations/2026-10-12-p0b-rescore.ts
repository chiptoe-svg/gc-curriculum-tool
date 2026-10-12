/**
 * P0b Task 7 — owner-gated re-score of the two merge survivors.
 *
 * Migration 0057 merged three competencies away (gc-production-literacy,
 * domain-grounding -> domain-knowledge; timeline-management ->
 * project-management) and carried each affected snapshot's BEST pre-merge
 * cell onto the survivor as a stopgap. This script replaces that carried
 * cell with a REAL re-score, using the new per-competency scorer
 * (scoreSnapshotCompetencies, P0b Task 5) against the merged descriptors —
 * for EVERY non-retired snapshot of a program-visible course (not only the
 * latest per course/instructor, and not restricted to builds_to_career —
 * I-1 hostile-review fix) that had a cell on any member of either merge
 * group (read from the merged-away ids' still-present history rows in
 * snapshot_competency_coverage, union the premerge survivor table
 * p0b_premerge_survivor_coverage captured by 0057 before the carry
 * overwrote the survivor's own row).
 *
 * This same script is reused, unchanged, for the LIVE re-score (Task 11,
 * owner-gated, STOP: ask owner first) — just pointed at gc_curriculum via
 * --expect-db. Nothing here is scratch-specific; the --expect-db guard is
 * the only database-identity check this script performs.
 *
 * Usage (from the repo root, with DATABASE_URL set explicitly — never read
 * from .env.local by hand):
 *   node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs \
 *     scripts/migrations/2026-10-12-p0b-rescore.ts \
 *     --dry-run --expect-db gc_curriculum_p0b_scratch            # default mode, writes nothing
 *   ... --apply --expect-db gc_curriculum_p0b_scratch             # makes paid AI calls, writes cells
 *   ... --apply --expect-db gc_curriculum_p0b_scratch --skip-wiki # also skip wiki stubs + regen (use for scratch runs)
 *
 * Safety discipline:
 *   - --expect-db is REQUIRED; the first thing this script does after
 *     parsing args is compare it against current_database() — a mismatch
 *     refuses before any other read (scope query, catalog read, anything).
 *   - --dry-run (the default) makes NO AI calls and writes NOTHING — it
 *     only reports the in-scope snapshot count (= the estimated call count,
 *     one call per snapshot, two competencies each).
 *   - --apply checks checkDailyCap() before every scoring call and stops
 *     cleanly (reporting partial progress) if the cap trips.
 *   - Wiki writes (both the merged-away "merged into" stub writes — Task 6:
 *     writeMergedStub — and every wiki regeneration) happen ONLY when
 *     --expect-db is exactly 'gc_curriculum' (the live database; see
 *     shouldWriteWiki/LIVE_DB_NAME). The wiki repo is a real git repo that
 *     pushes, so ANY other --expect-db skips wiki writes automatically (a
 *     line is printed saying so) regardless of --skip-wiki. --skip-wiki
 *     remains the explicit opt-out for the live run (Task 11).
 *   - Every wiki regeneration is AWAITED, sequentially (git writes to the
 *     wiki repo serialize anyway), BEFORE this script exits — fixed from an
 *     earlier version that fired `regenerateWikiInBackground` and let
 *     `process.exit` kill every regeneration still in flight (I-2,
 *     hostile review 2026-10-12: reproduced as 0 of 11 completing). A
 *     per-snapshot wiki failure is caught, reported, and does NOT undo that
 *     snapshot's DB cell writes or stop later snapshots from being scored —
 *     but main() still exits non-zero if any wiki write (regeneration or
 *     merged-stub) failed, with a line naming which one and telling the
 *     caller to re-run.
 *   - Never creates or closes a faculty_flags row — the 0057 flags stay
 *     open for faculty; this script doesn't touch faculty_flags at all.
 *   - Never prints DATABASE_URL or any other credential.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { subCompetencies, snapshotCompetencyCoverage, p0bPremergeSurvivorCoverage, courseCaptureSnapshots } from '@/lib/db/schema';
import { PROGRAM_VISIBLE_SQL } from '@/lib/courses/program-visibility';
import type { Tx } from '@/lib/db/competency-catalog-queries';
import { getSnapshotById } from '@/lib/db/capture-snapshots-queries';
import { scoreSnapshotCompetencies } from '@/lib/ai/analyze/program-score-coverage';
import { upsertCoverageCell } from '@/lib/db/program-coverage-queries';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import { writeMergedStub, regenerateWikiForSnapshot } from '@/lib/ai/wiki/update';
import { loadAppEnv, isMainModule } from '@/scripts/catalog/catalog-source';

// ─── The merge plan (mirrors drizzle/0057_competency_catalog_p0b.sql's merge_plan) ──
export const MERGE_PLAN: Record<string, string> = {
  'gc-production-literacy': 'domain-knowledge',
  'domain-grounding': 'domain-knowledge',
  'timeline-management': 'project-management',
};
export const MERGED_AWAY_IDS = Object.keys(MERGE_PLAN);
export const SURVIVOR_IDS = [...new Set(Object.values(MERGE_PLAN))];

/** The only database name wiki writes are ever allowed against. */
export const LIVE_DB_NAME = 'gc_curriculum';

/**
 * Wiki writes (the merged-away stub writes and every wiki regen) happen
 * only when --expect-db names the live database exactly, and --skip-wiki
 * was not passed. Any non-live --expect-db skips wiki writes automatically
 * — --skip-wiki is not required (and has no effect) off the live database.
 */
export function shouldWriteWiki(args: RescoreArgs): boolean {
  return args.expectDb === LIVE_DB_NAME && !args.skipWiki;
}

type Executor = Tx | typeof db;

// ─── CLI args ─────────────────────────────────────────────────────────────

export interface RescoreArgs {
  apply: boolean;
  expectDb: string;
  skipWiki: boolean;
}

function argValueFrom(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Throws if --expect-db is missing — that's the only required argument. */
export function parseArgs(argv: string[]): RescoreArgs {
  const expectDb = argValueFrom(argv, '--expect-db');
  if (!expectDb) {
    throw new Error(
      'usage: --expect-db <name> is required, plus --dry-run (default) | --apply, and optional --skip-wiki',
    );
  }
  return { apply: argv.includes('--apply'), expectDb, skipWiki: argv.includes('--skip-wiki') };
}

/**
 * The ONLY database-identity check this script makes. Must run (and must
 * reject on a mismatch) before any other read — scope query, catalog read,
 * anything.
 */
export async function assertExpectedDb(expectDb: string, executor: Executor = db): Promise<void> {
  const result = await executor.execute(sql`SELECT current_database() AS name`);
  const actual = (result.rows[0] as { name: string }).name;
  if (actual !== expectDb) {
    throw new Error(`refusing: connected to database '${actual}', expected '${expectDb}' (--expect-db) — no read performed`);
  }
}

// ─── Scope ──────────────────────────────────────────────────────────────────

export interface InScopeSnapshot {
  snapshotId: string;
  courseCode: string;
}

/**
 * EVERY non-retired snapshot of a PROGRAM-VISIBLE course (PROGRAM_VISIBLE_SQL
 * — `scope = 'gc' AND status = 'offered'`) that has a cell on any member of
 * either merge group — not only the latest snapshot per (course,
 * instructor), and not restricted to `builds_to_career`.
 *
 * Fix (I-1, hostile review 2026-10-12): the owner's Task 8b decision widened
 * career rollups AND scoring scope from `builds_to_career = true` to every
 * program-visible course (see listStaleSnapshots's own PROGRAM_VISIBLE_SQL
 * use) — this script predated that decision and still filtered on
 * `builds_to_career`, so 8 off-path program-visible snapshots were silently
 * skipped forever (carried/pre-merge cells that would never be re-scored,
 * and merge-disagreement flags whose "Re-scored against the merged
 * descriptor" note would never become true). Scoring EVERY non-retired
 * snapshot (not just the latest per course/instructor) also fixes M-8: a
 * course's flag-representative snapshot is not always its instructor's
 * latest capture, and the latest capture can have no group cell at all (so
 * it was never in scope either way) while an older snapshot does.
 *
 * "Has a cell on any group member" is read from TWO sources, never from the
 * survivor's current (already-carried) snapshot_competency_coverage row:
 *   - the merged-away ids' rows in snapshot_competency_coverage, which 0057
 *     never touched (still keyed by the old id), and
 *   - p0b_premerge_survivor_coverage, the survivor's own pre-merge cell,
 *     captured by 0057 before the carry overwrote it.
 */
export async function findInScopeSnapshots(executor: Executor = db): Promise<InScopeSnapshot[]> {
  const visibleResult = await executor.execute(sql`
    SELECT s.id, s.course_code
    FROM ${courseCaptureSnapshots} s
    JOIN courses c ON c.code = s.course_code
    WHERE s.retired_at IS NULL AND ${PROGRAM_VISIBLE_SQL}
  `);
  const visibleSnaps = visibleResult.rows as Array<{ id: string; course_code: string }>;

  const mergedAwayHits = await executor
    .select({ snapshotId: snapshotCompetencyCoverage.snapshotId })
    .from(snapshotCompetencyCoverage)
    .where(inArray(snapshotCompetencyCoverage.competencyId, MERGED_AWAY_IDS));
  const premergeHits = await executor
    .select({ snapshotId: p0bPremergeSurvivorCoverage.snapshotId })
    .from(p0bPremergeSurvivorCoverage);

  const hitIds = new Set<string>();
  for (const r of mergedAwayHits) hitIds.add(r.snapshotId);
  for (const r of premergeHits) if (r.snapshotId) hitIds.add(r.snapshotId);

  return visibleSnaps
    .filter(s => hitIds.has(s.id))
    .map(s => ({ snapshotId: s.id, courseCode: s.course_code }));
}

// ─── Catalog reads ──────────────────────────────────────────────────────────

export interface SurvivorCompetency {
  id: string;
  name: string;
  knowDescriptor: string;
  understandDescriptor: string;
  doDescriptor: string;
}

export async function getSurvivorCompetencies(executor: Executor = db): Promise<SurvivorCompetency[]> {
  return executor
    .select({
      id: subCompetencies.id,
      name: subCompetencies.name,
      knowDescriptor: subCompetencies.knowDescriptor,
      understandDescriptor: subCompetencies.understandDescriptor,
      doDescriptor: subCompetencies.doDescriptor,
    })
    .from(subCompetencies)
    .where(inArray(subCompetencies.id, SURVIVOR_IDS));
}

/** The merged-away competencies' real (retired) names — for the wiki stub titles (Task 6 controller ruling). */
export async function getMergedAwayNames(executor: Executor = db): Promise<Record<string, string>> {
  const rows = await executor
    .select({ id: subCompetencies.id, name: subCompetencies.name })
    .from(subCompetencies)
    .where(inArray(subCompetencies.id, MERGED_AWAY_IDS));
  const out: Record<string, string> = {};
  for (const r of rows) out[r.id] = r.name;
  return out;
}

export interface CarriedCell {
  kDepth: number | null;
  uDepth: number | null;
  dDepth: number;
}

/** The survivor cells as they stand BEFORE this script's own upsert — the "old (carried)" side of the report. */
export async function getCarriedCells(executor: Executor, snapshotId: string): Promise<Record<string, CarriedCell>> {
  const rows = await executor
    .select({
      competencyId: snapshotCompetencyCoverage.competencyId,
      kDepth: snapshotCompetencyCoverage.kDepth,
      uDepth: snapshotCompetencyCoverage.uDepth,
      dDepth: snapshotCompetencyCoverage.dDepth,
    })
    .from(snapshotCompetencyCoverage)
    .where(and(
      eq(snapshotCompetencyCoverage.snapshotId, snapshotId),
      inArray(snapshotCompetencyCoverage.competencyId, SURVIVOR_IDS),
    ));
  const out: Record<string, CarriedCell> = {};
  for (const r of rows) out[r.competencyId] = { kDepth: r.kDepth, uDepth: r.uDepth, dDepth: r.dDepth };
  return out;
}

// ─── Re-score ───────────────────────────────────────────────────────────────

export interface RescoreDeps {
  executor?: Executor;
  findInScopeSnapshots?: typeof findInScopeSnapshots;
  getSurvivorCompetencies?: typeof getSurvivorCompetencies;
  getMergedAwayNames?: typeof getMergedAwayNames;
  getCarriedCells?: typeof getCarriedCells;
  getSnapshotById?: typeof getSnapshotById;
  scoreSnapshotCompetencies?: typeof scoreSnapshotCompetencies;
  upsertCoverageCell?: typeof upsertCoverageCell;
  checkDailyCap?: typeof checkDailyCap;
  recordSpend?: typeof recordSpend;
  writeMergedStub?: typeof writeMergedStub;
  regenerateWikiForSnapshot?: typeof regenerateWikiForSnapshot;
}

export interface RescoreRow {
  snapshotId: string;
  courseCode: string;
  competencyId: string;
  old: CarriedCell | null;
  new: CarriedCell;
}

/** One wiki regeneration's outcome — I-2: reported, never silently dropped. */
export interface WikiRegenOutcome {
  snapshotId: string;
  courseCode: string;
  ok: boolean;
  error?: string;
}

/** One merged-away stub write's outcome — same discipline as WikiRegenOutcome. */
export interface StubWriteOutcome {
  oldId: string;
  survivorId: string;
  ok: boolean;
  error?: string;
}

export interface RescoreOutcome {
  scope: InScopeSnapshot[];
  rows: RescoreRow[];
  totalCostUsdCents: number;
  cappedEarly: boolean;
  snapshotsProcessed: number;
  wikiWritesEnabled: boolean;
  wikiResults: WikiRegenOutcome[];
  stubResults: StubWriteOutcome[];
}

export async function runRescore(args: RescoreArgs, deps: RescoreDeps = {}): Promise<RescoreOutcome> {
  const executor = deps.executor ?? db;
  const findScope = deps.findInScopeSnapshots ?? findInScopeSnapshots;
  const scope = await findScope(executor);
  const writeWiki = shouldWriteWiki(args);

  if (!args.apply) {
    // Dry run: report the scope only. No AI call, no DB write, no wiki write.
    return { scope, rows: [], totalCostUsdCents: 0, cappedEarly: false, snapshotsProcessed: 0, wikiWritesEnabled: writeWiki, wikiResults: [], stubResults: [] };
  }

  if (!writeWiki && !args.skipWiki) {
    console.log(`wiki writes skipped automatically: --expect-db '${args.expectDb}' is not the live database ('${LIVE_DB_NAME}')`);
  }

  const getCompetencies = deps.getSurvivorCompetencies ?? getSurvivorCompetencies;
  const competencies = await getCompetencies(executor);
  const checkCap = deps.checkDailyCap ?? checkDailyCap;
  const recordSp = deps.recordSpend ?? recordSpend;
  const getSnap = deps.getSnapshotById ?? getSnapshotById;
  const score = deps.scoreSnapshotCompetencies ?? scoreSnapshotCompetencies;
  const upsert = deps.upsertCoverageCell ?? upsertCoverageCell;
  const getCarried = deps.getCarriedCells ?? getCarriedCells;
  const regenWiki = deps.regenerateWikiForSnapshot ?? regenerateWikiForSnapshot;

  const rows: RescoreRow[] = [];
  const wikiResults: WikiRegenOutcome[] = [];
  let totalCostUsdCents = 0;
  let cappedEarly = false;
  let snapshotsProcessed = 0;

  for (const item of scope) {
    const cap = await checkCap();
    if (!cap.ok) {
      cappedEarly = true;
      break;
    }

    const snapshot = await getSnap(item.snapshotId);
    if (!snapshot) continue; // defensive: retired/deleted between scope query and here

    const old = await getCarried(executor, item.snapshotId);
    const result = await score({
      snapshotId: item.snapshotId,
      courseCode: item.courseCode,
      snapshotProfile: snapshot.profile,
      competencies: competencies.map(c => ({
        id: c.id,
        name: c.name,
        knowDescriptor: c.knowDescriptor,
        understandDescriptor: c.understandDescriptor,
        doDescriptor: c.doDescriptor,
      })),
    });

    totalCostUsdCents += result.costUsdCents;
    await recordSp(result.costUsdCents);

    for (const cell of result.result.cells) {
      if (!SURVIVOR_IDS.includes(cell.competency_id)) continue; // defensive — scorer already filters to known ids
      await upsert({
        snapshotId: item.snapshotId,
        subCompetencyId: cell.competency_id,
        kDepth: cell.k_depth,
        uDepth: cell.u_depth,
        dDepth: cell.d_depth,
        matchedCompetency: cell.matched_competency,
        evidenceExcerpt: cell.evidence_excerpt,
        confidence: cell.confidence,
        rationale: cell.rationale,
        model: result.model,
      });
      rows.push({
        snapshotId: item.snapshotId,
        courseCode: item.courseCode,
        competencyId: cell.competency_id,
        old: old[cell.competency_id] ?? null,
        new: { kDepth: cell.k_depth, uDepth: cell.u_depth, dDepth: cell.d_depth },
      });
    }

    snapshotsProcessed++;

    // I-2: AWAITED, sequentially (wiki git writes serialize anyway). A
    // failure is caught and reported — it must NOT undo the DB cell writes
    // just made above, and must NOT stop later snapshots from being scored.
    if (writeWiki) {
      try {
        await regenWiki(item.snapshotId, 'p0b-rescore: survivor re-score (domain-knowledge, project-management)');
        wikiResults.push({ snapshotId: item.snapshotId, courseCode: item.courseCode, ok: true });
      } catch (err) {
        wikiResults.push({
          snapshotId: item.snapshotId,
          courseCode: item.courseCode,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const stubResults: StubWriteOutcome[] = [];
  if (writeWiki) {
    const getNames = deps.getMergedAwayNames ?? getMergedAwayNames;
    const names = await getNames(executor);
    const survivorNameById = new Map(competencies.map(c => [c.id, c.name]));
    const writeStub = deps.writeMergedStub ?? writeMergedStub;
    for (const oldId of MERGED_AWAY_IDS) {
      const survivorId = MERGE_PLAN[oldId]!;
      try {
        await writeStub(oldId, survivorId, survivorNameById.get(survivorId) ?? survivorId, names[oldId] ?? oldId);
        stubResults.push({ oldId, survivorId, ok: true });
      } catch (err) {
        stubResults.push({ oldId, survivorId, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  return { scope, rows, totalCostUsdCents, cappedEarly, snapshotsProcessed, wikiWritesEnabled: writeWiki, wikiResults, stubResults };
}

// ─── Report ─────────────────────────────────────────────────────────────────

function fmtCell(c: CarriedCell | null): string {
  if (!c) return '(none)';
  return `${c.kDepth ?? '-'}/${c.uDepth ?? '-'}/${c.dDepth}`;
}

export function printReport(args: RescoreArgs, outcome: RescoreOutcome): void {
  console.log(`mode: ${args.apply ? 'APPLY' : 'DRY RUN'}  expect-db: ${args.expectDb}  skip-wiki: ${args.skipWiki}`);
  console.log(`in-scope snapshots: ${outcome.scope.length}`);

  if (!args.apply) {
    console.log(`estimated calls (one per in-scope snapshot, ${SURVIVOR_IDS.length} competencies each): ${outcome.scope.length}`);
    console.log('DRY RUN — nothing written, no AI calls made, no wiki writes.');
    return;
  }

  console.log('\nold (carried) -> new K/U/D per (course, survivor):');
  console.log('course_code | survivor | old K/U/D | new K/U/D');
  for (const row of outcome.rows) {
    console.log(`${row.courseCode} | ${row.competencyId} | ${fmtCell(row.old)} | ${fmtCell(row.new)}`);
  }
  console.log(`\nsnapshots processed: ${outcome.snapshotsProcessed} / ${outcome.scope.length}`);
  console.log(`cells upserted: ${outcome.rows.length}`);
  console.log(`total cost: $${(outcome.totalCostUsdCents / 10_000).toFixed(4)} (${outcome.totalCostUsdCents} 1/100-cent units)`);
  if (outcome.cappedEarly) {
    console.log('STOPPED EARLY: daily cost cap reached before all in-scope snapshots were processed.');
  }

  if (outcome.wikiWritesEnabled) {
    console.log('\nwiki regeneration, one line per snapshot:');
    for (const r of outcome.wikiResults) {
      console.log(r.ok
        ? `  OK   ${r.courseCode} (${r.snapshotId})`
        : `  FAIL ${r.courseCode} (${r.snapshotId}): ${r.error}`);
    }
    console.log('\nmerged-away stub writes, one line per competency:');
    for (const r of outcome.stubResults) {
      console.log(r.ok ? `  OK   ${r.oldId} -> ${r.survivorId}` : `  FAIL ${r.oldId} -> ${r.survivorId}: ${r.error}`);
    }
  }
}

/** Every wiki write (regeneration or merged-stub) that failed, in report order. */
export function wikiFailures(outcome: RescoreOutcome): Array<{ label: string; error: string }> {
  const failures: Array<{ label: string; error: string }> = [];
  for (const r of outcome.wikiResults) {
    if (!r.ok) failures.push({ label: `wiki regeneration for ${r.courseCode} (${r.snapshotId})`, error: r.error ?? 'unknown error' });
  }
  for (const r of outcome.stubResults) {
    if (!r.ok) failures.push({ label: `merged-stub write ${r.oldId} -> ${r.survivorId}`, error: r.error ?? 'unknown error' });
  }
  return failures;
}

// ─── Entry point ────────────────────────────────────────────────────────────

/**
 * Returns an exit code rather than calling process.exit itself, so tests can
 * call this directly. Order matters: parse args -> assertExpectedDb (the
 * ONLY db-identity check, before any other read) -> runRescore -> report.
 *
 * All DB writes (cell upserts) from runRescore stand regardless of exit
 * code — a wiki failure (I-2) never undoes them. A non-zero exit here means
 * ONLY that at least one wiki write failed; the caller should re-run this
 * same script with the same args (cells already scored are re-scored
 * again, which is harmless — see M-7, deferred) or investigate the wiki
 * repo directly before re-running just the wiki side.
 */
export async function main(argv: string[], deps: RescoreDeps = {}): Promise<number> {
  let args: RescoreArgs;
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

  const outcome = await runRescore(args, deps);
  printReport(args, outcome);

  const failures = wikiFailures(outcome);
  if (failures.length > 0) {
    console.error(`\n${failures.length} wiki write(s) failed; DB cell writes above are NOT affected and were NOT rolled back:`);
    for (const f of failures) console.error(`  - ${f.label}: ${f.error}`);
    console.error('Re-run this same script (same args) to retry — a cell that already scored correctly will just be re-scored, which is harmless.');
    return 3;
  }
  return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadAppEnv();
  void main(process.argv.slice(2)).then(code => process.exit(code));
}
