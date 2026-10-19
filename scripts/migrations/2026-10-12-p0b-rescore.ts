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
 *   ... --apply --expect-db gc_curriculum --wiki-only             # skip scoring; regen wiki only (I-2/I-3 retry path, m6)
 *   ... --max-calls 60                                            # raise the scoring-call stop threshold (default 40)
 *
 * Safety discipline:
 *   - --expect-db is REQUIRED; the first thing this script does after
 *     parsing args is compare it against current_database() — a mismatch
 *     refuses before any other read (scope query, catalog read, anything).
 *   - --dry-run (the default) makes NO AI calls and writes NOTHING — it
 *     only reports the in-scope snapshot count (= the estimated scoring-call
 *     count, one call per snapshot, two competencies each) PLUS an estimated
 *     wiki-call count (m2: one call per distinct in-scope course, plus the
 *     program-wide batches — see estimateWikiCalls).
 *   - --apply checks checkDailyCap() before every scoring call, and again
 *     once before the wiki phase starts, and stops cleanly (reporting
 *     partial progress) if the cap trips at either point — main() then
 *     exits non-zero (3, n1 final review) naming exactly which phase
 *     stopped (scoring or wiki) and what's incomplete, in every mode
 *     including --wiki-only. A cap trip at the wiki-phase check skips
 *     every wiki write for that invocation, including the merged-away
 *     stub writes — a stub is never written when the wiki phase itself
 *     was skipped by the cap. It also refuses to START scoring at all if
 *     the planned call count exceeds --max-calls (default 40,
 *     hostile-review hard stop, exit 4) — --wiki-only skips the scoring
 *     cap check and the --max-calls check entirely, since it does no
 *     scoring, but still checks the cap once before its own wiki writes.
 *   - Each scoring step (getSnapshotById, scoreSnapshotCompetencies,
 *     upsertCoverageCell) is wrapped in one try/record (m5): a failure on
 *     one snapshot is caught, reported, and does not stop the rest of the
 *     run — cells already written by earlier snapshots stand.
 *   - Wiki writes (the merged-away "merged into" stub writes — Task 6:
 *     writeMergedStub — the per-course regeneration, and the program-wide
 *     pass) happen ONLY when --expect-db is exactly 'gc_curriculum' (the
 *     live database; see shouldWriteWiki/LIVE_DB_NAME). The wiki repo is a
 *     real git repo that pushes, so ANY other --expect-db skips wiki writes
 *     automatically (a line is printed saying so) regardless of
 *     --skip-wiki. --skip-wiki remains the explicit opt-out for the live
 *     run (Task 11).
 *   - I-3 (hostile review round 2, 2026-10-12): wiki regeneration is
 *     decoupled from the scoring scope. The scoring scope includes
 *     SUPERSEDED (non-latest) snapshots on purpose (I-1) — but
 *     regenerating a course's public wiki page from a superseded capture
 *     would silently roll that page back to older content and still
 *     report OK. So after scoring, the wiki phase regenerates each
 *     successfully-scored COURSE's page exactly once, from that course's
 *     actual latest non-retired snapshot (via findLatestNonRetiredSnapshot
 *     — never necessarily the snapshot that was in scope), using the same
 *     course-only regeneration path scripts/wiki/refresh-all.ts uses
 *     (updateWikiForSnapshot with pageTypes:['course']). Then ONE
 *     program-wide pass regenerates the competency/target/concept/index
 *     pages (reusing lib/ai/wiki/refresh-all.ts's planRefresh/
 *     loadRefreshInputs/generateProgramWikiBatch — the exact path
 *     scripts/wiki/refresh-all.ts's `--only program` uses). checkDailyCap
 *     is checked once before this wiki phase starts (m2).
 *   - Every wiki write (course regen, program batch, merged-stub) is
 *     AWAITED, sequentially (git writes to the wiki repo serialize
 *     anyway), BEFORE this script exits. A per-item failure is caught and
 *     reported — it does NOT undo any DB cell writes and does NOT stop
 *     the rest of the wiki phase — but main() exits non-zero (3) if
 *     anything failed, naming each failure and recommending
 *     --apply --expect-db gc_curriculum --wiki-only to retry just the
 *     wiki side without re-paying scoring (m6) — n2 (final review): that
 *     retry still re-pays roughly the FULL wiki-call count again (~25 on
 *     live), since it reruns the whole wiki phase, not only the items
 *     that failed; it is not free.
 *   - Never creates or closes a faculty_flags row — the 0057 flags stay
 *     open for faculty; this script doesn't touch faculty_flags at all.
 *   - Never prints DATABASE_URL or any other credential.
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { subCompetencies, snapshotCompetencyCoverage, p0bPremergeSurvivorCoverage, courseCaptureSnapshots } from '@/lib/db/schema';
import { PROGRAM_VISIBLE_SQL } from '@/lib/courses/program-visibility';
import type { Tx } from '@/lib/db/competency-catalog-queries';
import { getSnapshotById } from '@/lib/db/capture-snapshots-queries';
import { scoreSnapshotCompetencies } from '@/lib/ai/analyze/program-score-coverage';
import { upsertCoverageCell } from '@/lib/db/program-coverage-queries';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import { writeMergedStub, regenerateWikiForSnapshot, generateProgramWikiBatch } from '@/lib/ai/wiki/update';
import { loadRefreshInputs, planRefresh, loadProgramCourseSummaries, latestSnapshotPerCourse, type RefreshInputs, type RefreshPlan } from '@/lib/ai/wiki/refresh-all';
import { writeAndPush } from '@/lib/wiki/git-ops';
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

/** Hostile-review hard stop (round 2): the default --max-calls ceiling. */
export const DEFAULT_MAX_CALLS = 40;

/**
 * Wiki writes (the merged-away stub writes, per-course regen and the
 * program-wide pass) happen only when --expect-db names the live database
 * exactly, and --skip-wiki was not passed. Any non-live --expect-db skips
 * wiki writes automatically — --skip-wiki is not required (and has no
 * effect) off the live database.
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
  /** m6: skip scoring entirely; only run the wiki phase (course regen + program pass). */
  wikiOnly: boolean;
  /** Hard stop: refuse to start scoring if the planned call count exceeds this. Default 40. */
  maxCalls: number;
}

function argValueFrom(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Throws if --expect-db is missing, or --max-calls is present but not a positive integer. */
export function parseArgs(argv: string[]): RescoreArgs {
  const expectDb = argValueFrom(argv, '--expect-db');
  if (!expectDb) {
    throw new Error(
      'usage: --expect-db <name> is required, plus --dry-run (default) | --apply, and optional --skip-wiki | --wiki-only | --max-calls <n>',
    );
  }
  let maxCalls = DEFAULT_MAX_CALLS;
  const maxCallsRaw = argValueFrom(argv, '--max-calls');
  if (maxCallsRaw !== undefined) {
    const n = Number(maxCallsRaw);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`usage: --max-calls <positive integer>, got "${maxCallsRaw}"`);
    }
    maxCalls = n;
  }
  return {
    apply: argv.includes('--apply'),
    expectDb,
    skipWiki: argv.includes('--skip-wiki'),
    wikiOnly: argv.includes('--wiki-only'),
    maxCalls,
  };
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
 * instructor), and not restricted to `builds_to_career`. Ordered by
 * (course_code, snapshot id) for a deterministic report (hostile review
 * round 2: the old unordered query made GC 3800/GC 4800's then-per-snapshot
 * wiki regen order depend on heap order — moot now that wiki regen is
 * decoupled from this scope (I-3), but a deterministic report is still
 * worth having).
 *
 * Fix (I-1, hostile review round 1, 2026-10-12): the owner's Task 8b
 * decision widened career rollups AND scoring scope from `builds_to_career
 * = true` to every program-visible course (see listStaleSnapshots's own
 * PROGRAM_VISIBLE_SQL use) — this script predated that decision and still
 * filtered on `builds_to_career`, so 8 off-path program-visible snapshots
 * were silently skipped forever (carried/pre-merge cells that would never
 * be re-scored, and merge-disagreement flags whose "Re-scored against the
 * merged descriptor" note would never become true). Scoring EVERY
 * non-retired snapshot (not just the latest per course/instructor) also
 * fixes M-8: a course's flag-representative snapshot is not always its
 * instructor's latest capture, and the latest capture can have no group
 * cell at all (so it was never in scope either way) while an older
 * snapshot does.
 *
 * "Has a cell on any group member" is read from TWO sources, never from the
 * survivor's current (already-carried) snapshot_competency_coverage row:
 *   - the merged-away ids' rows in snapshot_competency_coverage, which 0057
 *     never touched (still keyed by the old id), and
 *   - p0b_premerge_survivor_coverage, the survivor's own pre-merge cell,
 *     captured by 0057 before the carry overwrote it.
 *
 * Note (I-3): this scope INTENTIONALLY includes superseded (non-latest)
 * snapshots for SCORING — the wiki phase must never regenerate a page
 * straight from one of these; see findLatestNonRetiredSnapshot below.
 */
export async function findInScopeSnapshots(executor: Executor = db): Promise<InScopeSnapshot[]> {
  const visibleResult = await executor.execute(sql`
    SELECT s.id, s.course_code
    FROM ${courseCaptureSnapshots} s
    JOIN courses c ON c.code = s.course_code
    WHERE s.retired_at IS NULL AND ${PROGRAM_VISIBLE_SQL}
    ORDER BY s.course_code, s.id
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

/**
 * A course's actual latest non-retired snapshot — regardless of whether
 * THAT snapshot is in the scoring scope. I-3: this, never a scope item, is
 * what the wiki course-page regeneration reads from. Ordered created_at
 * DESC then id DESC (the same "representative" tiebreak 0057 and
 * listStaleSnapshots use), so it is deterministic even on a tie.
 */
export async function findLatestNonRetiredSnapshot(courseCode: string, executor: Executor = db): Promise<{ snapshotId: string } | null> {
  const rows = await executor
    .select({ id: courseCaptureSnapshots.id })
    .from(courseCaptureSnapshots)
    .where(and(eq(courseCaptureSnapshots.courseCode, courseCode), isNull(courseCaptureSnapshots.retiredAt)))
    .orderBy(desc(courseCaptureSnapshots.createdAt), desc(courseCaptureSnapshots.id))
    .limit(1);
  const row = rows[0];
  return row ? { snapshotId: row.id } : null;
}

// ─── Catalog reads ──────────────────────────────────────────────────────────

export interface SurvivorCompetency {
  id: string;
  name: string;
  knowDescriptor: string | null;
  understandDescriptor: string | null;
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

// ─── Wiki phase defaults (program-wide pass reuses lib/ai/wiki/refresh-all.ts) ──

/** I-3: course-only regeneration, from the course's ACTUAL latest snapshot. */
async function defaultRegenerateCoursePage(snapshotId: string, reason: string): Promise<{ sha: string }> {
  return regenerateWikiForSnapshot(snapshotId, reason, { pageTypes: ['course'] });
}

export interface ProgramBatchOutcome {
  batchIndex: number;
  pages: string[];
  ok: boolean;
  error?: string;
}

/**
 * I-3: the program-wide pass — one competency/target/concept/index pass,
 * via the exact path scripts/wiki/refresh-all.ts's `--only program` uses
 * (planRefresh + generateProgramWikiBatch), not a per-snapshot path.
 */
async function defaultRunProgramWikiPass(): Promise<ProgramBatchOutcome[]> {
  const inputs: RefreshInputs & { latestProfiles: Map<string, import('@/lib/ai/capture/schema').CaptureProfile> } = await loadRefreshInputs();
  const plan: RefreshPlan = planRefresh(inputs, { only: 'program' });
  const allLatest = latestSnapshotPerCourse(inputs.snapshots).map(s => ({ courseCode: s.courseCode, snapshotId: s.id, createdAt: s.createdAt }));
  const programCourses = plan.programPages.length > 0 ? await loadProgramCourseSummaries(allLatest, inputs.latestProfiles) : [];

  const outcomes: ProgramBatchOutcome[] = [];
  for (let i = 0; i < plan.programBatches.length; i++) {
    const batch = plan.programBatches[i]!;
    try {
      const r = await generateProgramWikiBatch(batch, {
        manifest: plan.manifest,
        programCourses,
        totals: { totalSnapshots: inputs.snapshots.length, totalCoursesWithSnapshots: allLatest.length },
      });
      const commitMessage = `feat(program): p0b-rescore program-wide refresh batch ${i + 1}/${plan.programBatches.length} — ${batch.map(p => p.slug).join(', ')}`;
      await writeAndPush({ pages: r.wiki, logEntry: r.logEntry, commitMessage });
      outcomes.push({ batchIndex: i, pages: batch.map(p => p.path), ok: true });
    } catch (err) {
      outcomes.push({ batchIndex: i, pages: batch.map(p => p.path), ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return outcomes;
}

/** m2: the dry-run wiki-call estimate — 1 call per distinct in-scope course, plus the program batches. Read-only. */
export async function estimateWikiCalls(scope: InScopeSnapshot[]): Promise<number> {
  const distinctCourses = new Set(scope.map(s => s.courseCode)).size;
  const inputs = await loadRefreshInputs();
  const plan = planRefresh(inputs, { only: 'program' });
  return distinctCourses + plan.programBatches.length;
}

// ─── Re-score ───────────────────────────────────────────────────────────────

export interface RescoreDeps {
  executor?: Executor;
  findInScopeSnapshots?: typeof findInScopeSnapshots;
  findLatestNonRetiredSnapshot?: typeof findLatestNonRetiredSnapshot;
  getSurvivorCompetencies?: typeof getSurvivorCompetencies;
  getMergedAwayNames?: typeof getMergedAwayNames;
  getCarriedCells?: typeof getCarriedCells;
  getSnapshotById?: typeof getSnapshotById;
  scoreSnapshotCompetencies?: typeof scoreSnapshotCompetencies;
  upsertCoverageCell?: typeof upsertCoverageCell;
  checkDailyCap?: typeof checkDailyCap;
  recordSpend?: typeof recordSpend;
  writeMergedStub?: typeof writeMergedStub;
  regenerateCoursePage?: (snapshotId: string, reason: string) => Promise<{ sha: string }>;
  runProgramWikiPass?: () => Promise<ProgramBatchOutcome[]>;
  estimateWikiCalls?: typeof estimateWikiCalls;
}

export interface RescoreRow {
  snapshotId: string;
  courseCode: string;
  competencyId: string;
  old: CarriedCell | null;
  new: CarriedCell;
}

/** m5: one scoring item's outcome — reported, never silently dropped. */
export interface ScoreOutcome {
  snapshotId: string;
  courseCode: string;
  ok: boolean;
  error?: string;
}

/** I-3: one course's wiki-page regeneration outcome. */
export interface CourseRegenOutcome {
  courseCode: string;
  snapshotId: string;
  ok: boolean;
  error?: string;
}

/** One merged-away stub write's outcome — same discipline as the wiki outcomes. */
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
  /**
   * n1 (final review): WHICH phase the daily cap actually stopped —
   * 'scoring' if it tripped mid-scoring-loop (some snapshots never
   * attempted, wiki phase never ran at all for this invocation), 'wiki' if
   * scoring fully finished but the cap tripped at the single check before
   * the wiki phase starts (no course regen, no program pass, no stubs).
   * Unset when `cappedEarly` is false.
   */
  cappedAt?: 'scoring' | 'wiki';
  snapshotsProcessed: number;
  wikiWritesEnabled: boolean;
  scoreResults: ScoreOutcome[];
  courseWikiResults: CourseRegenOutcome[];
  programWikiResults: ProgramBatchOutcome[];
  stubResults: StubWriteOutcome[];
  /** Hard stop (hostile review round 2): set when scope.length > args.maxCalls and scoring never started. */
  refused: boolean;
  refusedReason?: string;
  /** m2: only set on a --dry-run. */
  estimatedWikiCalls?: number;
}

function emptyOutcome(scope: InScopeSnapshot[], writeWiki: boolean, extra: Partial<RescoreOutcome> = {}): RescoreOutcome {
  return {
    scope, rows: [], totalCostUsdCents: 0, cappedEarly: false, snapshotsProcessed: 0,
    wikiWritesEnabled: writeWiki, scoreResults: [], courseWikiResults: [], programWikiResults: [],
    stubResults: [], refused: false, ...extra,
  };
}

export async function runRescore(args: RescoreArgs, deps: RescoreDeps = {}): Promise<RescoreOutcome> {
  const executor = deps.executor ?? db;
  const findScope = deps.findInScopeSnapshots ?? findInScopeSnapshots;
  const scope = await findScope(executor);
  const writeWiki = shouldWriteWiki(args);

  if (!args.apply) {
    // Dry run: report the scope + a wiki-call estimate only. No AI call, no
    // DB write, no wiki write.
    const estimate = deps.estimateWikiCalls ?? estimateWikiCalls;
    const estimatedWikiCalls = await estimate(scope);
    return emptyOutcome(scope, writeWiki, { estimatedWikiCalls });
  }

  // Hard stop (hostile review round 2): refuse to START scoring if the plan
  // is too big. --wiki-only does no scoring, so this never applies to it.
  if (!args.wikiOnly && scope.length > args.maxCalls) {
    return emptyOutcome(scope, writeWiki, {
      refused: true,
      refusedReason: `planned ${scope.length} scoring call(s) exceeds --max-calls ${args.maxCalls}`,
    });
  }

  if (!writeWiki && !args.skipWiki) {
    console.log(`wiki writes skipped automatically: --expect-db '${args.expectDb}' is not the live database ('${LIVE_DB_NAME}')`);
  }

  const checkCap = deps.checkDailyCap ?? checkDailyCap;
  const recordSp = deps.recordSpend ?? recordSpend;
  const getSnap = deps.getSnapshotById ?? getSnapshotById;
  const score = deps.scoreSnapshotCompetencies ?? scoreSnapshotCompetencies;
  const upsert = deps.upsertCoverageCell ?? upsertCoverageCell;
  const getCarried = deps.getCarriedCells ?? getCarriedCells;

  const rows: RescoreRow[] = [];
  const scoreResults: ScoreOutcome[] = [];
  let totalCostUsdCents = 0;
  let cappedEarly = false;
  let cappedAt: 'scoring' | 'wiki' | undefined;

  // --- scoring phase (m5: every per-item step wrapped in one try/record;
  // a failure on one snapshot is caught and reported, never stops the rest
  // of the run — cells already written stand). Skipped entirely in
  // --wiki-only mode.
  if (!args.wikiOnly) {
    const getCompetencies = deps.getSurvivorCompetencies ?? getSurvivorCompetencies;
    const competencies = await getCompetencies(executor);

    for (const item of scope) {
      const cap = await checkCap();
      if (!cap.ok) {
        cappedEarly = true;
        cappedAt = 'scoring';
        break;
      }

      try {
        const snapshot = await getSnap(item.snapshotId);
        if (!snapshot) {
          // defensive: retired/deleted between scope query and here
          scoreResults.push({ snapshotId: item.snapshotId, courseCode: item.courseCode, ok: false, error: 'snapshot not found (retired or deleted after the scope query)' });
          continue;
        }

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

        scoreResults.push({ snapshotId: item.snapshotId, courseCode: item.courseCode, ok: true });
      } catch (err) {
        scoreResults.push({ snapshotId: item.snapshotId, courseCode: item.courseCode, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  const snapshotsProcessed = scoreResults.filter(r => r.ok).length;

  // --- wiki phase (I-3: decoupled from the scoring scope). In --wiki-only
  // mode the course set comes straight from `scope` (no scoring happened);
  // otherwise it is every COURSE that scored successfully this run.
  const courseWikiResults: CourseRegenOutcome[] = [];
  const programWikiResults: ProgramBatchOutcome[] = [];
  const stubResults: StubWriteOutcome[] = [];
  if (writeWiki) {
    // n1 (final review): if the cap already tripped during scoring, the
    // wiki phase never even checks the cap again — it's already capped,
    // and nothing below (course regen, program pass, merged-stub writes)
    // runs for this invocation. If scoring finished clean (or this is
    // --wiki-only), check the cap once here, before any wiki write; a trip
    // at THIS check also skips every wiki write below, including the
    // merged-stub writes — a stub must never be written when the wiki
    // phase itself was skipped by the cap.
    const cap = cappedEarly ? { ok: false } : await checkCap();
    if (!cap.ok) {
      cappedEarly = true;
      if (!cappedAt) cappedAt = 'wiki';
    } else {
      const findLatest = deps.findLatestNonRetiredSnapshot ?? findLatestNonRetiredSnapshot;
      const regenCourse = deps.regenerateCoursePage ?? defaultRegenerateCoursePage;
      const courseCodes = args.wikiOnly
        ? [...new Set(scope.map(s => s.courseCode))]
        : [...new Set(scoreResults.filter(r => r.ok).map(r => r.courseCode))];
      courseCodes.sort();

      for (const courseCode of courseCodes) {
        const latest = await findLatest(courseCode, executor);
        if (!latest) continue; // defensive: a just-scored course with no non-retired snapshot at all
        try {
          await regenCourse(latest.snapshotId, 'p0b-rescore: survivor re-score (domain-knowledge, project-management)');
          courseWikiResults.push({ courseCode, snapshotId: latest.snapshotId, ok: true });
        } catch (err) {
          courseWikiResults.push({ courseCode, snapshotId: latest.snapshotId, ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      }

      const runProgram = deps.runProgramWikiPass ?? defaultRunProgramWikiPass;
      programWikiResults.push(...await runProgram());

      const getCompetenciesForStub = deps.getSurvivorCompetencies ?? getSurvivorCompetencies;
      const competencies = await getCompetenciesForStub(executor);
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
  }

  return {
    scope, rows, totalCostUsdCents, cappedEarly, cappedAt, snapshotsProcessed, wikiWritesEnabled: writeWiki,
    scoreResults, courseWikiResults, programWikiResults, stubResults, refused: false,
  };
}

// ─── Report ─────────────────────────────────────────────────────────────────

function fmtCell(c: CarriedCell | null): string {
  if (!c) return '(none)';
  return `${c.kDepth ?? '-'}/${c.uDepth ?? '-'}/${c.dDepth}`;
}

export function printReport(args: RescoreArgs, outcome: RescoreOutcome): void {
  console.log(`mode: ${args.apply ? 'APPLY' : 'DRY RUN'}  expect-db: ${args.expectDb}  skip-wiki: ${args.skipWiki}  wiki-only: ${args.wikiOnly}  max-calls: ${args.maxCalls}`);
  console.log(`in-scope snapshots: ${outcome.scope.length}`);

  if (!args.apply) {
    console.log(`estimated scoring calls (one per in-scope snapshot, ${SURVIVOR_IDS.length} competencies each): ${outcome.scope.length}`);
    console.log(`estimated wiki calls (one per distinct in-scope course, plus the program-wide batches — see estimateWikiCalls): ${outcome.estimatedWikiCalls ?? 0}`);
    console.log('DRY RUN — nothing written, no AI calls made, no wiki writes.');
    return;
  }

  if (outcome.refused) {
    console.log(`REFUSED: ${outcome.refusedReason}`);
    return;
  }

  if (!args.wikiOnly) {
    console.log('\nold (carried) -> new K/U/D per (course, survivor):');
    console.log('course_code | survivor | old K/U/D | new K/U/D');
    for (const row of outcome.rows) {
      console.log(`${row.courseCode} | ${row.competencyId} | ${fmtCell(row.old)} | ${fmtCell(row.new)}`);
    }
    console.log(`\nscoring, one line per snapshot:`);
    for (const r of outcome.scoreResults) {
      console.log(r.ok ? `  OK   ${r.courseCode} (${r.snapshotId})` : `  FAIL ${r.courseCode} (${r.snapshotId}): ${r.error}`);
    }
    console.log(`\nsnapshots processed: ${outcome.snapshotsProcessed} / ${outcome.scope.length}`);
    console.log(`cells upserted: ${outcome.rows.length}`);
    console.log(`total cost: $${(outcome.totalCostUsdCents / 10_000).toFixed(4)} (${outcome.totalCostUsdCents} 1/100-cent units)`);
  }

  // n1 (final review): printed in EVERY mode, including --wiki-only — the
  // old code hid this inside the `!args.wikiOnly` block above, so a cap
  // trip in --wiki-only mode exited silently with no signal at all.
  if (outcome.cappedEarly) {
    if (outcome.cappedAt === 'wiki') {
      console.log('STOPPED EARLY at the wiki phase: the daily cost cap was reached before any wiki write (course regen, program pass, or merged-stub write) ran.');
    } else {
      console.log('STOPPED EARLY at the scoring phase: the daily cost cap was reached before all in-scope snapshots were scored; the wiki phase did not run at all for this invocation.');
    }
  }

  if (outcome.wikiWritesEnabled) {
    console.log('\nwiki course-page regeneration, one line per course:');
    for (const r of outcome.courseWikiResults) {
      console.log(r.ok
        ? `  OK   ${r.courseCode} (${r.snapshotId})`
        : `  FAIL ${r.courseCode} (${r.snapshotId}): ${r.error}`);
    }
    console.log('\nwiki program-wide pass, one line per batch:');
    for (const r of outcome.programWikiResults) {
      console.log(r.ok
        ? `  OK   batch ${r.batchIndex + 1} (${r.pages.join(', ')})`
        : `  FAIL batch ${r.batchIndex + 1} (${r.pages.join(', ')}): ${r.error}`);
    }
    console.log('\nmerged-away stub writes, one line per competency:');
    for (const r of outcome.stubResults) {
      console.log(r.ok ? `  OK   ${r.oldId} -> ${r.survivorId}` : `  FAIL ${r.oldId} -> ${r.survivorId}: ${r.error}`);
    }
  }
}

/** Every scoring item or wiki write (course regen, program batch, merged-stub) that failed, in report order. */
export function allFailures(outcome: RescoreOutcome): Array<{ label: string; error: string }> {
  const failures: Array<{ label: string; error: string }> = [];
  for (const r of outcome.scoreResults) {
    if (!r.ok) failures.push({ label: `scoring for ${r.courseCode} (${r.snapshotId})`, error: r.error ?? 'unknown error' });
  }
  for (const r of outcome.courseWikiResults) {
    if (!r.ok) failures.push({ label: `wiki course-page regeneration for ${r.courseCode} (${r.snapshotId})`, error: r.error ?? 'unknown error' });
  }
  for (const r of outcome.programWikiResults) {
    if (!r.ok) failures.push({ label: `wiki program-wide batch ${r.batchIndex + 1}`, error: r.error ?? 'unknown error' });
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
 * code — a scoring or wiki failure (m5/I-2/I-3) never undoes an earlier
 * one's. A non-zero exit here means at least one scoring item or wiki write
 * failed (exit 3), or the plan exceeded --max-calls before anything ran
 * (exit 4, m1's hard stop).
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

  if (outcome.refused) {
    return 4;
  }

  const failures = allFailures(outcome);
  if (failures.length > 0) {
    console.error(`\n${failures.length} item(s) failed; DB cell writes above are NOT affected and were NOT rolled back:`);
    for (const f of failures) console.error(`  - ${f.label}: ${f.error}`);
    // m6: a full re-run re-pays every scoring call AND every wiki write —
    // if only wiki items failed, --wiki-only retries just those.
    const onlyWikiFailed = outcome.scoreResults.every(r => r.ok);
    if (onlyWikiFailed) {
      // n2 (final review): a --wiki-only retry is NOT free — it re-runs the
      // ENTIRE wiki phase (every course regen, the program pass, every
      // merged-stub write), not only the items that failed, so it re-pays
      // roughly the full wiki-call count (~25 on live) again. It also still
      // needs --apply --expect-db gc_curriculum explicitly; --wiki-only
      // alone (e.g. under --dry-run, or against a scratch DB) writes
      // nothing.
      console.error('Re-run with --apply --expect-db gc_curriculum --wiki-only to retry the wiki side. This re-pays roughly the FULL wiki-call count again (~25 on live) — it reruns every course regen, the program pass, and every merged-stub write, not only the ones that failed — but no scoring call is repeated.');
    } else {
      console.error('Re-run this same script (same args) to retry. WARNING: a full re-run re-pays every scoring call, including ones that already succeeded (M-7, deferred) — if scoring itself is fine and only a wiki write failed, use --apply --expect-db gc_curriculum --wiki-only instead to avoid repaying scoring (note: that still re-pays the full wiki-call count, ~25 on live — see above).');
    }
    return 3;
  }

  if (outcome.cappedEarly) {
    // n1 (final review): a cap trip during scoring, or at the wiki-phase
    // check, previously fell through to `return 0` here with no signal at
    // all once allFailures() was empty (the loop simply `break`s rather
    // than recording a failure) — the printReport message above was the
    // only hint, and it was silently absent in --wiki-only mode. Now it's
    // always a non-zero exit with a phase-specific message naming exactly
    // what's incomplete.
    const phase = outcome.cappedAt ?? 'scoring';
    const message = phase === 'wiki'
      ? `STOPPED EARLY at the wiki phase: the daily cost cap was reached after scoring finished (${outcome.snapshotsProcessed}/${outcome.scope.length} in-scope snapshots scored), but no wiki course regeneration, program pass, or merged-stub write ran for this invocation.`
      : `STOPPED EARLY at the scoring phase: the daily cost cap was reached. ${outcome.snapshotsProcessed}/${outcome.scope.length} in-scope snapshots were scored; the rest were never attempted, and no wiki regeneration or merged-stub write ran for this invocation at all.`;
    console.error(`\n${message}`);
    console.error('Re-run this same script once the cap resets (or raise it with --max-calls) to finish the remaining work.');
    return 3;
  }

  return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadAppEnv();
  void main(process.argv.slice(2)).then(code => process.exit(code));
}
