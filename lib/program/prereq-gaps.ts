/**
 * Deterministic prerequisite-gap engine.
 *
 * `computeGapsFromInputs` — pure, no-DB inner function.
 * `computePrereqGaps`    — DB-backed wrapper (direct edges only).
 *
 * Design: docs/superpowers/specs/2026-06-05-prerequisite-edges-design.md
 * Plan:   docs/superpowers/plans/2026-06-05-prerequisite-edges.md  Task 5
 *
 * Key invariant: ordinal-MAX aggregation across all relied prereqs for the
 * same sub-competency — no sum, no double-count. Redundant edges, diamond
 * paths, and duplicate skill-tags all collapse cleanly under MAX.
 *
 * Per-prereq measured-beats-intended: each relied prereq contributes its own
 * measured attainment if it has one, else its intended attainment. A measured
 * row for prereq B does NOT suppress an intended row for a different prereq C.
 *
 * Basis derivation (precise):
 *   measured — every delivered value is backed by measured attainment only;
 *              an intended row never raised the delivered figure above what
 *              measured alone would have provided.
 *   mixed    — at least one measured row is present, BUT an intended (syllabus)
 *              value raised the delivered figure on ≥1 KUD dimension above what
 *              measured rows alone provide. The gap may appear "met" only because
 *              of an unverified syllabus promise — must be flagged in the UI.
 *   intended — no measured rows at all; the entire delivered figure rests on
 *              syllabus promises.
 *   none     — no delivered data whatsoever (pool is empty).
 *
 * Chain traversal (transitivity) is NOT performed here. Direct edges only.
 * Program-wide transitive diagnostics belong to the deferred scaffolding-
 * analysis increment; this function is a per-course building block.
 */

import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  courseCaptureSnapshots,
  snapshotTargetCoverage,
  subCompetencies,
} from '@/lib/db/schema';
import { listEdgesForFocal } from '@/lib/db/prerequisite-edge-queries';
import { getIntendedCoverageForCourses } from '@/lib/db/courses-queries';

// ---------------------------------------------------------------------------
// Types (exported for callers + tests)
// ---------------------------------------------------------------------------

export type GapBasis = 'measured' | 'mixed' | 'intended' | 'none';
export type GapStatus = 'met' | 'gap' | 'no_data';

/**
 * Measured (or intended) attainment of a specific sub-competency by a
 * specific prereq course, as sourced from `snapshotTargetCoverage`.
 */
export interface DeliveredAttainment {
  prereqCourseCode: string;
  subCompetencyId: string;
  k: number | null;
  u: number | null;
  d: number | null;
  /** Where this row came from. Only 'measured' is produced by the DB wrapper
   *  in this increment; the 'intended' seam is wired in by the rough-pass
   *  increment (see comment in computePrereqGaps). */
  basis: 'measured' | 'intended';
}

/** A confirmed edge the focal course relies on. */
export interface RelyEdge {
  prereqCourseCode: string;
  subCompetencyId: string;
  expectedK: number | null;
  expectedU: number | null;
  expectedD: number | null;
}

/** Per-sub-competency gap result. */
export interface SubCompetencyGap {
  subCompetencyId: string;
  needed: { k: number | null; u: number | null; d: number | null };
  delivered: { k: number | null; u: number | null; d: number | null };
  /** max(0, needed - delivered) per dim; 0 when needed is null. */
  gap: { k: number; u: number; d: number };
  status: GapStatus;
  basis: GapBasis;
  /** Deduped list of prereq course codes that were considered for this sub-comp. */
  contributingPrereqs: string[];
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** Ordinal MAX that treats null as "no data" (identity for MAX). */
const maxN = (a: number | null, b: number | null): number | null =>
  a == null ? b : b == null ? a : Math.max(a, b);

/** Gap on a single dimension: max(0, need - got); 0 when need is null. */
const gapDim = (need: number | null, got: number | null): number =>
  need == null ? 0 : Math.max(0, need - (got ?? 0));

// ---------------------------------------------------------------------------
// Pure core (exported for unit tests — no DB dependency)
// ---------------------------------------------------------------------------

/**
 * Compute per-sub-competency gaps from a set of rely-edges and a pool of
 * delivered attainments.
 *
 * Algorithm:
 *  1. Group edges by subCompetencyId.
 *  2. For each sub-comp group:
 *     a. needed  = MAX of expected{K,U,D} across the group's edges.
 *     b. reliedPrereqs = deduped set of prereqCourseCodes in the group.
 *     c. relevant delivered = rows whose (prereqCourseCode, subCompetencyId)
 *        matches the group. Per-prereq: each prereq contributes its own
 *        measured rows if present, else its intended rows.
 *     d. delivered = MAX of {k,u,d} across the winning pool.
 *     e. gap = max(0, needed - delivered) per dim.
 *     f. status = no_data | gap | met.
 *
 * No sum, no double-count. Redundant edges / duplicate tags / diamonds
 * all resolve to the same MAX.
 */
export function computeGapsFromInputs(
  edges: RelyEdge[],
  delivered: DeliveredAttainment[],
): SubCompetencyGap[] {
  // Group edges by sub-competency
  const bySub = new Map<string, RelyEdge[]>();
  for (const e of edges) {
    if (!bySub.has(e.subCompetencyId)) bySub.set(e.subCompetencyId, []);
    bySub.get(e.subCompetencyId)!.push(e);
  }

  const out: SubCompetencyGap[] = [];

  for (const [subId, subEdges] of bySub) {
    // (a) needed = MAX expected across all edges for this sub-comp
    const needed = {
      k: subEdges.reduce<number | null>((m, e) => maxN(m, e.expectedK), null),
      u: subEdges.reduce<number | null>((m, e) => maxN(m, e.expectedU), null),
      d: subEdges.reduce<number | null>((m, e) => maxN(m, e.expectedD), null),
    };

    // (b) deduped relied prereqs
    const reliedPrereqs = Array.from(
      new Set(subEdges.map((e) => e.prereqCourseCode)),
    );

    // (c) attainment rows relevant to this (reliedPrereqs, subComp) combo
    const relevant = delivered.filter(
      (d) =>
        d.subCompetencyId === subId &&
        reliedPrereqs.includes(d.prereqCourseCode),
    );

    // Per-prereq: each relied prereq uses its own measured attainment if present, else its intended.
    const pool = reliedPrereqs.flatMap((rc) => {
      const rcRows = relevant.filter((d) => d.prereqCourseCode === rc);
      const rcMeasured = rcRows.filter((d) => d.basis === 'measured');
      return rcMeasured.length > 0 ? rcMeasured : rcRows;
    });

    // (d) delivered = MAX across pool; basis derived precisely
    let basis: GapBasis;
    let delivD: { k: number | null; u: number | null; d: number | null };

    if (pool.length === 0) {
      basis = 'none';
      delivD = { k: null, u: null, d: null };
    } else {
      delivD = {
        k: pool.reduce<number | null>((m, d) => maxN(m, d.k), null),
        u: pool.reduce<number | null>((m, d) => maxN(m, d.u), null),
        d: pool.reduce<number | null>((m, d) => maxN(m, d.d), null),
      };

      const measuredRows = pool.filter((d) => d.basis === 'measured');
      if (measuredRows.length === 0) {
        basis = 'intended';
      } else {
        // Measure-only delivered — what measured alone would have provided
        const measDeliv = {
          k: measuredRows.reduce<number | null>((m, d) => maxN(m, d.k), null),
          u: measuredRows.reduce<number | null>((m, d) => maxN(m, d.u), null),
          d: measuredRows.reduce<number | null>((m, d) => maxN(m, d.d), null),
        };
        // raised(full, meas): an intended row pushed this dim above what measured alone provides
        const raised = (full: number | null, meas: number | null) =>
          (full ?? -1) > (meas ?? -1);
        const intendedRaised =
          raised(delivD.k, measDeliv.k) ||
          raised(delivD.u, measDeliv.u) ||
          raised(delivD.d, measDeliv.d);
        basis = intendedRaised ? 'mixed' : 'measured';
      }
    }

    // (e) gap per dim
    const gap = {
      k: gapDim(needed.k, delivD.k),
      u: gapDim(needed.u, delivD.u),
      d: gapDim(needed.d, delivD.d),
    };

    // (f) status
    const status: GapStatus =
      basis === 'none'
        ? 'no_data'
        : gap.k + gap.u + gap.d > 0
          ? 'gap'
          : 'met';

    out.push({
      subCompetencyId: subId,
      needed,
      delivered: delivD,
      gap,
      status,
      basis,
      contributingPrereqs: reliedPrereqs,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// DB-backed wrapper
// ---------------------------------------------------------------------------

export interface PrereqGapResult {
  focalCourseCode: string;
  gaps: SubCompetencyGap[];
}

/**
 * Compute prerequisite gaps for a focal course.
 *
 * Steps:
 *  1. Fetch all confirmed edges for the focal course (direct edges only —
 *     chain traversal for program-wide diagnostics is deferred to the
 *     scaffolding-analysis increment).
 *  2. For each distinct (prereqCourseCode, subCompetencyId) pair:
 *     a. Resolve the sub-competency's careerTargetId from `sub_competencies`.
 *     b. Find the prereq course's latest non-retired `courseCaptureSnapshots`
 *        row (ordered by createdAt DESC).
 *     c. Look up the matching `snapshotTargetCoverage` row for
 *        (snapshotId, careerTargetId, subCompetencyId).
 *     d. If found → DeliveredAttainment{ basis: 'measured', k/u/d from depths }.
 *        If not found → contributes nothing (will surface as no_data).
 *  3. INTENDED-BASIS SEAM (wired):
 *     `course_intended_coverage` rows are batch-loaded for all distinct
 *     prereq courses and pushed as `basis:'intended'` DeliveredAttainment
 *     entries alongside any measured rows. The pure engine applies per-prereq
 *     measured-beats-intended logic; no precedence code is needed here.
 *  4. Call computeGapsFromInputs(edges, delivered) and return.
 */
export async function computePrereqGaps(
  focalCourseCode: string,
): Promise<PrereqGapResult> {
  // Step 1 — confirmed direct edges only
  const allEdges = await listEdgesForFocal(focalCourseCode);
  const confirmedEdges = allEdges.filter((e) => e.confirmed);
  const relyEdges: RelyEdge[] = confirmedEdges.map((e) => ({
    prereqCourseCode: e.prereqCourseCode,
    subCompetencyId: e.subCompetencyId,
    expectedK: e.expectedK,
    expectedU: e.expectedU,
    expectedD: e.expectedD,
  }));

  if (relyEdges.length === 0) {
    return { focalCourseCode, gaps: [] };
  }

  // Step 2 — collect measured attainment for each distinct (prereq, subComp) pair
  const pairs = Array.from(
    new Map(
      relyEdges.map((e) => [`${e.prereqCourseCode}::${e.subCompetencyId}`, e]),
    ).values(),
  );

  // INTENDED-BASIS SEAM — batch-load intended coverage for all distinct prereq courses
  const distinctPrereqCodes = Array.from(
    new Set(relyEdges.map((e) => e.prereqCourseCode)),
  );
  const intendedRows = await getIntendedCoverageForCourses(distinctPrereqCodes);
  // Build lookup: `${courseCode}::${subCompetencyId}` → IntendedCoverageRow
  const intendedLookup = new Map(
    intendedRows.map((r) => [`${r.courseCode}::${r.subCompetencyId}`, r]),
  );

  const deliveredAttainments: DeliveredAttainment[] = [];

  for (const pair of pairs) {
    const { prereqCourseCode, subCompetencyId } = pair;

    // (a) Resolve the sub-competency's careerTargetId
    const [subComp] = await db
      .select({ careerTargetId: subCompetencies.careerTargetId })
      .from(subCompetencies)
      .where(eq(subCompetencies.id, subCompetencyId))
      .limit(1);

    if (!subComp) {
      // sub-comp deleted → its edges + intended rows are cascade-deleted; unreachable.
      continue;
    }

    // (b) Latest non-retired snapshot for the prereq course
    const [snapshot] = await db
      .select({ id: courseCaptureSnapshots.id })
      .from(courseCaptureSnapshots)
      .where(
        and(
          eq(courseCaptureSnapshots.courseCode, prereqCourseCode),
          // retiredAt IS NULL — exclude retired snapshots
          isNull(courseCaptureSnapshots.retiredAt),
        ),
      )
      .orderBy(desc(courseCaptureSnapshots.createdAt))
      .limit(1);

    if (!snapshot) {
      // No snapshot — emit intended if available, then continue
      const intRow = intendedLookup.get(`${prereqCourseCode}::${subCompetencyId}`);
      if (intRow) {
        deliveredAttainments.push({
          prereqCourseCode,
          subCompetencyId,
          k: intRow.intendedK,
          u: intRow.intendedU,
          d: intRow.intendedD,
          basis: 'intended',
        });
      }
      continue;
    }

    // (c) Coverage row for (snapshotId, careerTargetId, subCompetencyId)
    const [coverage] = await db
      .select({
        kDepth: snapshotTargetCoverage.kDepth,
        uDepth: snapshotTargetCoverage.uDepth,
        dDepth: snapshotTargetCoverage.dDepth,
      })
      .from(snapshotTargetCoverage)
      .where(
        and(
          eq(snapshotTargetCoverage.snapshotId, snapshot.id),
          eq(snapshotTargetCoverage.careerTargetId, subComp.careerTargetId),
          eq(snapshotTargetCoverage.subCompetencyId, subCompetencyId),
        ),
      )
      .limit(1);

    if (!coverage) {
      // No coverage row — emit intended if available, then continue
      const intRow = intendedLookup.get(`${prereqCourseCode}::${subCompetencyId}`);
      if (intRow) {
        deliveredAttainments.push({
          prereqCourseCode,
          subCompetencyId,
          k: intRow.intendedK,
          u: intRow.intendedU,
          d: intRow.intendedD,
          basis: 'intended',
        });
      }
      continue;
    }

    // (d) Emit a measured attainment row
    deliveredAttainments.push({
      prereqCourseCode,
      subCompetencyId,
      k: coverage.kDepth,
      u: coverage.uDepth,
      d: coverage.dDepth,
      basis: 'measured',
    });

    // INTENDED-BASIS SEAM — also push intended row if one exists for this pair.
    // Both rows are emitted; the pure engine's per-prereq pool logic selects
    // measured over intended for the same prereq, so no precedence code is needed here.
    const intRow = intendedLookup.get(`${prereqCourseCode}::${subCompetencyId}`);
    if (intRow) {
      deliveredAttainments.push({
        prereqCourseCode,
        subCompetencyId,
        k: intRow.intendedK,
        u: intRow.intendedU,
        d: intRow.intendedD,
        basis: 'intended',
      });
    }
  }

  // Step 4 — delegate to pure engine
  return {
    focalCourseCode,
    gaps: computeGapsFromInputs(relyEdges, deliveredAttainments),
  };
}
