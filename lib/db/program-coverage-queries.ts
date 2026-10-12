import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { snapshotCompetencyCoverage, targetCoverage, courseCaptureSnapshots, careerTargets, targetSubCompetencies, subCompetencies } from '@/lib/db/schema';
import { listPairedCodesForCourses } from '@/lib/db/course-codes-queries';
import { PROGRAM_VISIBLE_SQL } from '@/lib/courses/program-visibility';
import type { Tx } from '@/lib/db/competency-catalog-queries';

export interface CoverageCellRow {
  snapshotId: string;
  careerTargetId: string;
  subCompetencyId: string;
  kDepth: number | null;
  uDepth: number | null;
  dDepth: number;
  matchedCompetency: string | null;
  evidenceExcerpt: string | null;
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
  model: string;
  generatedAt: Date;
}

export interface UpsertCoverageCellInput {
  snapshotId: string;
  /**
   * P0b Task 5: scoring carries no career-target context any more, so a
   * caller scoring a stale snapshot across many targets' competencies at
   * once has no single target id to pass. Kept optional for the per-pair
   * route (which still has one) and old callers — the write itself never
   * reads this field (cells are keyed (snapshot, competency) only; which
   * targets see the cell comes from career_target_requirements).
   */
  careerTargetId?: string;
  subCompetencyId: string;
  kDepth: number | null;
  uDepth: number | null;
  dDepth: number;
  matchedCompetency: string | null;
  evidenceExcerpt: string | null;
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
  model: string;
}

function rowToCell(row: typeof targetCoverage.$inferSelect): CoverageCellRow {
  return {
    snapshotId: row.snapshotId,
    careerTargetId: row.careerTargetId,
    subCompetencyId: row.subCompetencyId,
    kDepth: row.kDepth,
    uDepth: row.uDepth,
    dDepth: row.dDepth,
    matchedCompetency: row.matchedCompetency,
    evidenceExcerpt: row.evidenceExcerpt,
    confidence: row.confidence as 'high' | 'medium' | 'low',
    rationale: row.rationale,
    model: row.model,
    generatedAt: row.generatedAt,
  };
}

/**
 * Upsert one cell. One row per (snapshot, competency): re-scoring overwrites.
 * careerTargetId is the scoring context only — which targets see the cell
 * comes from career_target_requirements (view target_coverage).
 */
export async function upsertCoverageCell(input: UpsertCoverageCellInput): Promise<void> {
  const now = new Date();
  const values = {
    kDepth: input.kDepth,
    uDepth: input.uDepth,
    dDepth: input.dDepth,
    matchedCompetency: input.matchedCompetency,
    evidenceExcerpt: input.evidenceExcerpt,
    confidence: input.confidence,
    rationale: input.rationale,
    model: input.model,
    generatedAt: now,
  };
  await db.insert(snapshotCompetencyCoverage).values({
    snapshotId: input.snapshotId,
    competencyId: input.subCompetencyId,
    ...values,
  }).onConflictDoUpdate({
    target: [snapshotCompetencyCoverage.snapshotId, snapshotCompetencyCoverage.competencyId],
    set: values,
  });
}

export async function getCellsForSnapshotTarget(snapshotId: string, careerTargetId: string): Promise<CoverageCellRow[]> {
  const rows = await db
    .select()
    .from(targetCoverage)
    .where(and(
      eq(targetCoverage.snapshotId, snapshotId),
      eq(targetCoverage.careerTargetId, careerTargetId),
    ));
  return rows.map(rowToCell);
}

export async function getAllCells(): Promise<CoverageCellRow[]> {
  const rows = await db.select().from(targetCoverage);
  return rows.map(rowToCell);
}

/**
 * Resolves which latest snapshots are missing coverage cells against the
 * active catalog (P0b Task 5 — replaces listStalePairs's per-target
 * cross-product now that scoring carries no target context). "Active
 * catalog" = non-retired `sub_competencies` rows. Since P0b Amendment 1 (A1)
 * a non-retired competency is NOT necessarily "used by at least one
 * target" any more — it can be unlinked (see retireCompetencyFromTarget) —
 * but it is still part of the active catalog every program-visible snapshot
 * is scored against, linked or not.
 *
 * Scoring scope (A2): every program-visible course (PROGRAM_VISIBLE_SQL —
 * `scope = 'gc' AND status = 'offered'`), regardless of `builds_to_career`.
 *
 * Career-rollup scope (owner decision, 2026-10-12, SUPERSEDING Amendment 1
 * ruling A2's "career rollups stay builds_to_career-only"): career views
 * also count every PROGRAM-VISIBLE course — same scope as scoring. Only
 * external, sandbox and non-offered courses are excluded from a career
 * rollup; an off-path (builds_to_career=false) GC/offered course counts the
 * same as an on-path one. Later, the career-view course set becomes
 * selectable per pathway (core + minor + electives taken) — that's P3 work,
 * deferred (see STATE.md Deferred/debt). The matrix's own ROW list
 * (`getMatrixData`'s `courses`, i.e. which courses get a row in the UI)
 * keeps `builds_to_career = true` unchanged — that's a display choice, not
 * the rollup-scope question this comment is about.
 *
 * ---- Audit (Task 8b, 2026-10-12; scope corrected 2026-10-12 fix round 1,
 * owner decision): every reader of target_coverage /
 * snapshot_competency_coverage in app/ and lib/, classified career-rollup
 * (program-visible scope, external/sandbox/non-offered excluded) vs.
 * per-competency/per-course (also program-visible scope — the two camps
 * read identically now, except the matrix's own display row list) vs.
 * scoring/other. ----
 *
 *   SCORING SCOPE (this function) — program-visible:
 *     - listStaleSnapshots (here)                     — drives the bulk refresh route.
 *
 *   CAREER ROLLUPS — must and do filter to program-visible (not builds_to_career):
 *     - getMatrixData (here)                           — its `courses` (matrix ROWS)
 *       query keeps `builds_to_career = true` unchanged (a display choice, item 2
 *       of the owner decision); its `cells` are now restricted by a SEPARATE,
 *       unrestricted-by-snapshot-window query over every program-visible
 *       course's snapshots (getAllCells() reads the whole target_coverage view
 *       with no course filter at all, so without this an external/sandbox/
 *       non-offered course's cell would otherwise leak into every target's
 *       rollup through matrix.cells — fixed in Task 8b, course exclusion
 *       corrected from builds_to_career to program-visible in fix round 1).
 *     - app/api/program/coverage/route.ts              — reads getMatrixData; inherits the fix.
 *     - app/api/flags/route.ts                          — reads getMatrixData; inherits the fix.
 *     - app/program/ProgramCoverageClient.tsx           — reads data.cells from the
 *       route above; its stale-pair COUNT was separately fixed (fix round 1) to
 *       count only pairs for the matrix's own row snapshots (`data.courses`),
 *       since `data.cells` is now broader (program-visible) than `data.courses`
 *       (builds_to_career-only matrix rows) — without that, the count could go
 *       negative ("Score -50 stale pairs").
 *     - lib/ai/wiki/graph-tools.ts (coverageForTargetTool) — reads getMatrixData; inherits.
 *     - lib/program/sufficiency-read.ts (getTargetSufficiency) — reads getMatrixData's
 *       cells directly (`matrix.cells.filter(c => c.careerTargetId === targetId)`,
 *       no course cross-reference of its own); inherits the fix.
 *     - lib/ai/explore/run-impact.ts (runImpact → computeCareerFit)        — reads
 *       getMatrixData; inherits the fix.
 *     - lib/ai/explore/career-fit.ts (computeCareerFit)  — pure, reads matrix.cells
 *       passed in by run-impact; inherits the fix transitively.
 *     - lib/db/scaffolding-queries.ts (loadScaffoldingTarget) — already filtered
 *       scope='gc' AND status='offered' (program-visible) before Task 8b; a
 *       builds_to_career condition added in Task 8b (commit fd0daf0) is
 *       reverted (removed) by this fix round 1 decision, restoring its
 *       original (already-correct) scope.
 *     - lib/ai/wiki/update.ts (loadTargetSubstrate — the TARGET wiki page's
 *       coverageRollup/contributingCourses) — previously (pre-Task 8b) joined
 *       only courseCaptureSnapshots (retiredAt IS NULL), with NO courses join
 *       at all — even an external/sandbox cell would have rolled up. FIXED
 *       (Task 8b): joined `courses`, filtered scope/status (program-visible)
 *       AND builds_to_career=true; the builds_to_career condition is removed
 *       by this fix round 1 decision, leaving the scope/status filter.
 *
 *   PER-COMPETENCY / PER-COURSE VIEWS — correctly include every
 *   program-visible course; no builds_to_career filter, by design (A2):
 *     - lib/ai/wiki/update.ts (loadCompetencySubstrate — the COMPETENCY wiki page)
 *       — reads snapshot_competency_coverage for one competency across every
 *       non-retired snapshot. Had NO course filter at all before fix round 1
 *       (a real pre-existing gap, not a builds_to_career question); FIXED
 *       (fix round 1): joined `courses`, filtered scope='gc' AND
 *       status='offered' (program-visible) so a sandbox/external snapshot
 *       can never reach a competency page.
 *     - lib/ai/wiki/update.ts (loadCompetencyLinksForSnapshot) — per-snapshot
 *       (course page's competency links). Correct as-is.
 *     - lib/ai/explore/run-impact.ts (resolveSubCompetencyDepths,
 *       buildBaselineDelivered) — per focal-course snapshot, whatever course
 *       that is (on-path or not). Correct as-is.
 *     - lib/program/prereq-gaps.ts — per prereq course, per competency.
 *       Correct as-is (A2 says so explicitly).
 *
 *   SCHEDULING ONLY (decide which pages to regenerate, not rollup content;
 *   the actual target-page content comes from loadTargetSubstrate above,
 *   which IS fixed) — left unfiltered on purpose; worst case is one wasted
 *   regeneration (an AI call) for a target page whose content doesn't
 *   change, not an incorrect rollup:
 *     - lib/ai/wiki/update.ts (computeAffectedPages) — targetCoverage filtered
 *       by snapshot id only, to pick which pages to queue.
 *     - lib/ai/wiki/refresh-all.ts (loadRefreshInputs) — targetSlugs/competencySlugs
 *       for the one-pass program refresh's batch planning.
 *
 *   NOT READERS of these tables (writers, deletes, or comments only):
 *     - lib/db/program-coverage-queries.ts upsertCoverageCell / invalidateCoverageForSubCompetency (writes).
 *     - lib/capture/run-course-reset.ts (deletes a course's cells on reset).
 *     - app/api/program/coverage/refresh/route.ts and
 *       .../[snapshotId]/[targetId]/route.ts (call listStaleSnapshots/upsertCoverageCell;
 *       the per-pair route scores one target's active members, scoped by that target's
 *       membership, not by course — out of scope for this audit).
 *     - lib/db/__tests__/scaffolding-queries.test.ts, program-coverage-queries.test.ts,
 *       lib/ai/wiki/__tests__/* (test doubles).
 *     - tests/db/p0a/probes.ts (getCellsForSnapshotTarget) — a characterization
 *       probe that reads raw (snapshot, target) cells for before/after diffing
 *       of DB state across a migration, not a production rollup consumer;
 *       deliberately unfiltered so it can SEE a diff if one appears.
 */
export interface SnapshotToScore {
  snapshotId: string;
  courseCode: string;
  /** Active catalog competency ids this snapshot has no cell for yet. */
  missingCompetencyIds: string[];
}

/**
 * `executor` defaults to the module-level `db` but accepts a transaction
 * client (`Tx`, same type `competency-catalog-queries.ts` uses) so tests can
 * run a setup mutation and this read on the SAME connection inside one
 * `BEGIN … ROLLBACK` — reads via the bare `db` singleton run on a different
 * pooled connection and would never see an uncommitted change made on `tx`.
 */
export async function listStaleSnapshots(executor: Tx | typeof db = db): Promise<SnapshotToScore[]> {
  // Pick the latest non-retired snapshot per (course, instructor) — every
  // PROGRAM-VISIBLE course (A2: scoring scope widened in Task 8b from
  // builds_to_career = true to PROGRAM_VISIBLE_SQL below; this comment used
  // to say "only courses flagged builds_to_career," which stopped being
  // true the moment that widening landed). Per-instructor rows (A8 decision,
  // 2026-06-12): the same code taught by different faculty is scored as
  // separate matrix rows rather than newest-capture-wins, so variance stays
  // visible. NULL instructor_name groups as its own row (pre-0027 snapshots
  // were backfilled to 'Department canonical').
  const latestSnapshots = await executor.execute(sql`
    SELECT DISTINCT ON (s.course_code, s.instructor_name)
      s.id, s.course_code, s.created_at
    FROM ${courseCaptureSnapshots} s
    JOIN courses c ON c.code = s.course_code
    WHERE s.retired_at IS NULL AND ${PROGRAM_VISIBLE_SQL}
    ORDER BY s.course_code, s.instructor_name, s.created_at DESC
  `);
  const latestSnaps = (latestSnapshots.rows as Array<{ id: string; course_code: string }>);

  const activeCompetencyIds = (await executor
    .select({ id: subCompetencies.id })
    .from(subCompetencies)
    .where(eq(subCompetencies.retired, false)))
    .map(r => r.id)
    .sort();

  // Get every (snapshot, competency) pair that already has a cell.
  const existing = await executor
    .select({
      snapshotId: snapshotCompetencyCoverage.snapshotId,
      competencyId: snapshotCompetencyCoverage.competencyId,
    })
    .from(snapshotCompetencyCoverage);
  const scoredBySnapshot = new Map<string, Set<string>>();
  for (const row of existing) {
    const set = scoredBySnapshot.get(row.snapshotId) ?? new Set<string>();
    set.add(row.competencyId);
    scoredBySnapshot.set(row.snapshotId, set);
  }

  const stale: SnapshotToScore[] = [];
  for (const snap of latestSnaps) {
    const scored = scoredBySnapshot.get(snap.id) ?? new Set<string>();
    const missingCompetencyIds = activeCompetencyIds.filter(id => !scored.has(id));
    if (missingCompetencyIds.length > 0) {
      stale.push({ snapshotId: snap.id, courseCode: snap.course_code, missingCompetencyIds });
    }
  }
  return stale;
}

export interface MatrixCourse {
  courseCode: string;
  courseTitle: string;
  level: number;
  snapshotId: string;
  snapshotCaption: string | null;
  snapshotCreatedAt: Date;
  /** Whose capture this row represents — one matrix row per (course, instructor). */
  instructorName: string | null;
  /** Paired lecture/lab codes for bundled display label. */
  pairedCodes: Array<{ pairedCode: string }>;
}

export interface MatrixSubCompetency {
  id: string;
  name: string;
  careerTargetId: string;
  careerTargetName: string;
  displayOrder: number;
}

export interface MatrixCoverageCell {
  snapshotId: string;
  careerTargetId: string;
  subCompetencyId: string;
  kDepth: number | null;
  uDepth: number | null;
  dDepth: number;
  matchedCompetency: string | null;
  evidenceExcerpt: string | null;
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
  /** Which model produced this cell's scores (A10 — provider/model flips must be visible in longitudinal claims). */
  model: string;
}

/**
 * Course code/title for a snapshot that may or may not be a matrix ROW
 * (fix round 2, 2026-10-12): `cells` now carries every program-visible
 * course's snapshots (owner decision), including off-path ones and
 * superseded (non-latest) ones for on-path courses — neither of those is
 * in `courses` (matrix rows: builds_to_career-only, latest-per-instructor).
 * A consumer that needs "which course did this cell's snapshot belong to"
 * (e.g. coverage_for_target) must resolve through this, not through
 * `courses`, or it prints '?' for every cell outside the matrix's own rows.
 */
export interface SnapshotCourseInfo {
  snapshotId: string;
  courseCode: string;
  courseTitle: string;
}

export interface MatrixData {
  courses: MatrixCourse[];
  targets: Array<{ id: string; name: string; displayOrder: number }>;
  subCompetencies: MatrixSubCompetency[];
  cells: MatrixCoverageCell[];
  /** Course code/title for every snapshot id that can appear in `cells` — see SnapshotCourseInfo. */
  snapshotCourses: SnapshotCourseInfo[];
}

/**
 * Invalidate (delete) all Phase-1A coverage cells for one sub-competency under
 * one target. Called when the sub-competency's descriptor/name changes — the
 * cells were scored against the OLD prose and must be recomputed. listStalePairs()
 * then sees the pair as needing re-score; the matrix view recomputes on next load.
 *
 * P0a: cells are per (snapshot, competency) and shared by every target that
 * uses the competency, so all of them go; with one target per competency
 * (P0a) these are exactly the rows the old per-target delete removed.
 * Returns the count of deleted cells.
 */
export async function invalidateCoverageForSubCompetency(
  careerTargetId: string,
  subCompetencyId: string,
): Promise<number> {
  void careerTargetId; // kept for callers; cells are per competency since P0a
  const deleted = await db
    .delete(snapshotCompetencyCoverage)
    .where(eq(snapshotCompetencyCoverage.competencyId, subCompetencyId))
    .returning();
  return deleted.length;
}

/**
 * Read the full matrix payload in one shot: every course with a non-retired
 * snapshot, every active career target with its non-retired sub-competencies,
 * and every scored cell for those (non-retired) sub-competencies. Cells under a
 * retired sub-competency stay in snapshot_competency_coverage as history but are
 * not returned: every consumer of this payload (matrix, sufficiency, Explore
 * career-fit, wiki graph tools, flags) reads it as the current state.
 */
export async function getMatrixData(): Promise<MatrixData> {
  // One row per (course, instructor): the latest non-retired snapshot for
  // each instructor who has captured the course (A8 decision, 2026-06-12 —
  // per-instructor rows surface variance instead of newest-capture-wins).
  const latestSnapshotsRaw = await db.execute(sql`
    SELECT DISTINCT ON (s.course_code, s.instructor_name)
      s.id              AS snapshot_id,
      s.course_code     AS course_code,
      s.caption         AS caption,
      s.created_at      AS created_at,
      s.instructor_name AS instructor_name,
      c.title           AS title,
      c.level           AS level
    FROM ${courseCaptureSnapshots} s
    JOIN courses c ON c.code = s.course_code
    WHERE s.retired_at IS NULL AND c.builds_to_career = true
      AND c.scope = 'gc' AND c.status = 'offered'  -- scope/status: see lib/courses/program-visibility.ts
    ORDER BY s.course_code, s.instructor_name, s.created_at DESC
  `);
  const courseRows = (latestSnapshotsRaw.rows as Array<{
    snapshot_id: string;
    course_code: string;
    caption: string | null;
    created_at: Date;
    instructor_name: string | null;
    title: string;
    level: number;
  }>);

  // Batched paired-code lookup for bundled display labels.
  const uniqueCodes = [...new Set(courseRows.map(r => r.course_code))];
  const pairedCodeRows = await listPairedCodesForCourses(uniqueCodes);
  const pairedByCode = new Map<string, Array<{ pairedCode: string }>>();
  for (const pc of pairedCodeRows) {
    const arr = pairedByCode.get(pc.courseCode) ?? [];
    arr.push({ pairedCode: pc.pairedCode });
    pairedByCode.set(pc.courseCode, arr);
  }

  const courses: MatrixCourse[] = courseRows.map(r => ({
    courseCode: r.course_code,
    courseTitle: r.title,
    level: r.level,
    snapshotId: r.snapshot_id,
    snapshotCaption: r.caption,
    snapshotCreatedAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
    instructorName: r.instructor_name,
    pairedCodes: pairedByCode.get(r.course_code) ?? [],
  }));

  const targets = await db
    .select({ id: careerTargets.id, name: careerTargets.name, displayOrder: careerTargets.displayOrder })
    .from(careerTargets);

  const subs = await db
    .select({
      id: targetSubCompetencies.id,
      name: targetSubCompetencies.name,
      careerTargetId: targetSubCompetencies.careerTargetId,
      displayOrder: targetSubCompetencies.displayOrder,
      retired: targetSubCompetencies.retired,
    })
    .from(targetSubCompetencies);

  const targetById = new Map(targets.map(t => [t.id, t]));
  const subCompetenciesOut: MatrixSubCompetency[] = subs
    .filter(s => !s.retired)
    .map(s => ({
      id: s.id,
      name: s.name,
      careerTargetId: s.careerTargetId,
      careerTargetName: targetById.get(s.careerTargetId)?.name ?? '',
      displayOrder: s.displayOrder,
    }));

  const activeSubIds = new Set(subCompetenciesOut.map(s => s.id));
  // Career-rollup scope (owner decision, 2026-10-12, superseding Amendment 1
  // ruling A2): getAllCells() reads the WHOLE target_coverage view with no
  // course filter of its own, so without this a cell scored for an
  // external/sandbox/non-offered course's snapshot would leak into this
  // target rollup. Career views count every PROGRAM-VISIBLE course (same
  // scope as scoring, PROGRAM_VISIBLE_SQL) — NOT restricted to
  // builds_to_career, so this can't reuse `courses` above (which stays
  // builds_to_career-restricted on purpose: it's the matrix's own ROW list,
  // unchanged). This also must NOT narrow to the latest-snapshot-per-
  // (course,instructor) window `courses` carries: getAllCells() had no
  // snapshot-window restriction at all before Task 8b, so a separate,
  // unrestricted query is used here (a first fix-round-1 draft wrongly
  // reused `courses`'s snapshot ids, which would have narrowed that window —
  // caught before merge, not shipped).
  // Also carries course_code/title (fix round 2, 2026-10-12): a cell's
  // snapshot is frequently NOT one of `courses` (matrix rows) — it may be
  // off-path, or a superseded (non-latest) snapshot of an on-path course —
  // so a consumer resolving "which course is this cell's snapshot" (e.g.
  // coverage_for_target in graph-tools.ts) must look here, in
  // `snapshotCourses` below, not in `courses`, or it prints '?' for every
  // cell outside the matrix's own rows (measured on scratch: 88 of 188
  // coverage_for_target entries, 64 off-path + 24 superseded on-path).
  const programVisibleSnapshotsRaw = await db.execute(sql`
    SELECT s.id, s.course_code, c.title
    FROM ${courseCaptureSnapshots} s
    JOIN courses c ON c.code = s.course_code
    WHERE ${PROGRAM_VISIBLE_SQL}
  `);
  const programVisibleSnapshotRows = programVisibleSnapshotsRaw.rows as Array<{ id: string; course_code: string; title: string }>;
  const programVisibleSnapshotIds = new Set(programVisibleSnapshotRows.map(r => r.id));
  const snapshotCourses: SnapshotCourseInfo[] = programVisibleSnapshotRows.map(r => ({
    snapshotId: r.id,
    courseCode: r.course_code,
    courseTitle: r.title,
  }));
  const cells = (await getAllCells()).filter(c => activeSubIds.has(c.subCompetencyId) && programVisibleSnapshotIds.has(c.snapshotId));

  return {
    courses: courses.sort((a, b) =>
      a.courseCode === b.courseCode
        ? (a.instructorName ?? '').localeCompare(b.instructorName ?? '')
        : a.courseCode.localeCompare(b.courseCode)),
    targets: targets.sort((a, b) => a.displayOrder - b.displayOrder),
    subCompetencies: subCompetenciesOut.sort((a, b) =>
      a.careerTargetId === b.careerTargetId
        ? a.displayOrder - b.displayOrder
        : a.careerTargetId.localeCompare(b.careerTargetId)
    ),
    cells: cells.map(c => ({
      snapshotId: c.snapshotId,
      careerTargetId: c.careerTargetId,
      subCompetencyId: c.subCompetencyId,
      kDepth: c.kDepth,
      uDepth: c.uDepth,
      dDepth: c.dDepth,
      matchedCompetency: c.matchedCompetency,
      evidenceExcerpt: c.evidenceExcerpt,
      confidence: c.confidence,
      rationale: c.rationale,
      model: c.model,
    })),
    snapshotCourses,
  };
}
