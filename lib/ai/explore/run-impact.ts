/**
 * Impact-orchestration layer for the Explore thinking-partner.
 *
 * Two exports:
 *   assembleScenario — pure, DB-free; tested directly in run-impact.test.ts.
 *   runImpact        — DB/AI wrapper; validated by a harness (not unit-tested).
 */

import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { snapshotTargetCoverage, subCompetencies, prerequisiteEdges } from '@/lib/db/schema';
import { computeRipple, type PredictedSubCompDepth } from './ripple';
import { scenarioSchema } from './scenario';
import type { Scenario, RippleLine } from './scenario';
import type { DeliveredAttainment, RelyEdge } from '@/lib/program/prereq-gaps';
import type { LocalDeltaResult } from '@/lib/ai/analyze/explore-local-delta';
import { estimateLocalDelta } from '@/lib/ai/analyze/explore-local-delta';
import { assembleNeighborContext, type EdgePair, type NeighborProfile } from './neighbor-context';
import { listConfirmedEdgePairs } from '@/lib/db/prerequisite-edge-queries';
import { getLatestSnapshotByCourse } from '@/lib/db/capture-snapshots-queries';
import { saveScenario } from '@/lib/db/explore-scenario-queries';
import { getIntendedCoverageForCourses } from '@/lib/db/courses-queries';
import type { CaptureProfile } from '@/lib/ai/capture/schema';
import { computeCareerFit } from './career-fit';
import { getMatrixData } from '@/lib/db/program-coverage-queries';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Normalize a competency statement for matching: trim, lowercase, collapse internal whitespace.
 *  Tolerates the formatting/casing drift between the local-delta AI's competency wording and
 *  snapshot_target_coverage.matched_competency (which the scoring AI may have re-cased/spaced). */
export function normalizeCompetencyKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// assembleScenario — pure orchestration (no DB, no AI)
// ---------------------------------------------------------------------------

export interface AssembleScenarioInput {
  id: string;
  courseCode: string;
  baselineSnapshotId: string;
  createdAt: string;
  aiResult: LocalDeltaResult;
  predictedSubCompDepths: PredictedSubCompDepth[];
  baselineDelivered: DeliveredAttainment[];
  /**
   * Downstream edges grouped by the relying course code.
   * Key = relying course code; value = edges where prereqCourseCode === focalCourseCode.
   */
  downstreamByCourse: Record<string, RelyEdge[]>;
  /** Career-fit ripple lines computed externally; appended verbatim after the downstream + upstream passes. */
  careerFitLines?: RippleLine[];
  subCompLabel: (subCompetencyId: string) => string;
}

/**
 * Pure assembly — runs the ripple engine per downstream course, stamps
 * courseCode onto each downstream_gap line, and builds the full Scenario.
 * Validates the result through scenarioSchema before returning.
 *
 * Invariant: downstream_gap lines come exclusively from the per-course loop
 * (stamped with courseCode); upstream_gap lines come exclusively from the
 * final assumesIncoming pass. Filtering each pass by kind keeps these sources
 * from ever crossing, regardless of computeRipple's internal emission order.
 */
export function assembleScenario(input: AssembleScenarioInput): Scenario {
  const rippleLines: RippleLine[] = [];

  // Per downstream course: run ripple with only that course's edges,
  // filter to downstream_gap lines only, then stamp courseCode on each.
  // Lines of any other kind from this call are dropped — they must come
  // from the dedicated upstream pass, not the downstream loop.
  for (const [downCourse, edges] of Object.entries(input.downstreamByCourse)) {
    const lines = computeRipple({
      focalCourseCode: input.courseCode,
      downstreamEdges: edges,
      baselineDelivered: input.baselineDelivered,
      predictedSubCompDepths: input.predictedSubCompDepths,
      assumesIncoming: [],
      subCompLabel: input.subCompLabel,
    });
    for (const line of lines.filter(l => l.kind === 'downstream_gap')) {
      rippleLines.push({ ...line, courseCode: downCourse });
    }
  }

  // One more pass with no downstream edges but with the real assumesIncoming
  // to get upstream_gap lines. Filter to upstream_gap only — career_fit is a
  // future kind produced by a separate path, not here.
  const upstreamLines = computeRipple({
    focalCourseCode: input.courseCode,
    downstreamEdges: [],
    baselineDelivered: input.baselineDelivered,
    predictedSubCompDepths: input.predictedSubCompDepths,
    assumesIncoming: input.aiResult.change.assumesIncoming,
    subCompLabel: input.subCompLabel,
  });
  rippleLines.push(...upstreamLines.filter(l => l.kind === 'upstream_gap'));

  // Append career_fit lines from external computation (computeCareerFit).
  rippleLines.push(...(input.careerFitLines ?? []).filter(l => l.kind === 'career_fit'));

  const scenario = {
    id: input.id,
    courseCode: input.courseCode,
    baselineSnapshotId: input.baselineSnapshotId,
    change: input.aiResult.change,
    predictedDeltas: input.aiResult.predictedDeltas,
    computedRipple: rippleLines,
    agentNotes: null,
    caption: null,
    createdAt: input.createdAt,
  };

  return scenarioSchema.parse(scenario);
}

// ---------------------------------------------------------------------------
// runImpact — DB/AI wrapper (not unit-tested; validated by harness)
// ---------------------------------------------------------------------------

/**
 * Resolve a predicted delta's competency statement to sub-competency depths,
 * using the snapshot_target_coverage rows for the focal course's latest
 * snapshot. The coverage table stores `matchedCompetency` (the profile
 * competency statement the AI matched to each sub-competency) alongside
 * `subCompetencyId` and the scored depths. This is the same linkage the
 * program coverage matrix and the scaffolding analysis use.
 *
 * Resolution logic:
 *   1. Look up all snapshotTargetCoverage rows for the focal snapshot.
 *   2. For each predicted delta, find rows where matchedCompetency === competency
 *      (exact string match; the same statement the AI wrote into both the profile
 *      and the coverage table). If matched, emit PredictedSubCompDepth with the
 *      predicted to.k/u/d depths.
 *   3. If a predicted competency does NOT match any matchedCompetency in the
 *      coverage table, OMIT it from predictedSubCompDepths — it will still appear
 *      in Scenario.predictedDeltas for display, just not in the ripple engine.
 *      NEVER fabricate a sub-competency id.
 *
 * CONCERN NOTE: matchedCompetency in snapshot_target_coverage is populated by
 * the program-score-coverage AI function, which may paraphrase rather than
 * copy verbatim the profile's competency statement. If the scoring AI wrote a
 * paraphrase, exact-string match will miss it; the competency will be omitted
 * from the ripple rather than mismatched. This is the safe direction: false
 * negatives (no ripple for an unresolved competency) vs. false positives
 * (wrong sub-comp in the ripple). A future increment can add fuzzy matching.
 */
async function resolveSubCompetencyDepths(
  snapshotId: string,
  predictedDeltas: LocalDeltaResult['predictedDeltas'],
): Promise<PredictedSubCompDepth[]> {
  if (predictedDeltas.length === 0) return [];

  const coverageRows = await db
    .select({
      subCompetencyId: snapshotTargetCoverage.subCompetencyId,
      matchedCompetency: snapshotTargetCoverage.matchedCompetency,
    })
    .from(snapshotTargetCoverage)
    .where(eq(snapshotTargetCoverage.snapshotId, snapshotId));

  // Build a map: competency statement → [subCompetencyId, ...] (one competency
  // can score against multiple sub-comps; emit one PredictedSubCompDepth per
  // sub-comp, all carrying the same predicted depths).
  // snapshot_target_coverage has a 3-col PK incl. careerTargetId; a course scored
  // against multiple targets yields duplicate rows per subComp with identical depths
  // — dedup by subCompetencyId to match computePrereqGaps.
  const byStatement = new Map<string, string[]>();
  for (const row of coverageRows) {
    if (!row.matchedCompetency) continue;
    const key = normalizeCompetencyKey(row.matchedCompetency);
    const existing = byStatement.get(key) ?? [];
    existing.push(row.subCompetencyId);
    byStatement.set(key, existing);
  }
  // Dedup the subCompetencyId lists (careerTargetId multiplicity can produce duplicates)
  for (const [stmt, ids] of byStatement) {
    byStatement.set(stmt, Array.from(new Set(ids)));
  }

  const out: PredictedSubCompDepth[] = [];
  for (const delta of predictedDeltas) {
    const subIds = byStatement.get(normalizeCompetencyKey(delta.competency));
    if (!subIds || subIds.length === 0) {
      // No coverage row matched this competency statement — omit from ripple.
      continue;
    }
    for (const subCompetencyId of subIds) {
      out.push({
        subCompetencyId,
        k: delta.to.k,
        u: delta.to.u,
        d: delta.to.d,
      });
    }
  }
  return out;
}

/**
 * Build DeliveredAttainment rows for the focal course acting as a prereq —
 * mirrors the logic in computePrereqGaps but for a single focal snapshot.
 * We read snapshotTargetCoverage directly (measured basis) and layer in
 * intended coverage rows the same way the gap engine does.
 */
async function buildBaselineDelivered(
  focalCourseCode: string,
  snapshotId: string,
): Promise<DeliveredAttainment[]> {
  const measuredRows = await db
    .select({
      subCompetencyId: snapshotTargetCoverage.subCompetencyId,
      kDepth: snapshotTargetCoverage.kDepth,
      uDepth: snapshotTargetCoverage.uDepth,
      dDepth: snapshotTargetCoverage.dDepth,
    })
    .from(snapshotTargetCoverage)
    .where(eq(snapshotTargetCoverage.snapshotId, snapshotId));

  // snapshot_target_coverage has a 3-col PK incl. careerTargetId; a course scored
  // against multiple targets yields duplicate rows per subComp with identical depths
  // — dedup by subCompetencyId to match computePrereqGaps.
  const dedupedMeasured = Array.from(
    new Map(measuredRows.map(r => [r.subCompetencyId, r])).values(),
  );

  const delivered: DeliveredAttainment[] = dedupedMeasured.map(r => ({
    prereqCourseCode: focalCourseCode,
    subCompetencyId: r.subCompetencyId,
    k: r.kDepth,
    u: r.uDepth,
    d: r.dDepth,
    basis: 'measured' as const,
  }));

  // Layer in intended coverage (same seam as computePrereqGaps).
  const intendedRows = await getIntendedCoverageForCourses([focalCourseCode]);
  for (const ir of intendedRows) {
    delivered.push({
      prereqCourseCode: focalCourseCode,
      subCompetencyId: ir.subCompetencyId,
      k: ir.intendedK,
      u: ir.intendedU,
      d: ir.intendedD,
      basis: 'intended' as const,
    });
  }

  return delivered;
}

export interface LoadNeighborContextResult {
  context: import('./neighbor-context').NeighborContext;
  focalSnapshot: import('@/lib/db/capture-snapshots-queries').SnapshotRow;
  edgePairs: EdgePair[];
}

/**
 * Load the focal course's neighbor context (focal + upstream + downstream profiles)
 * without running any AI or saving anything. Exported for the agent's
 * `neighbor_context` tool so it can surface the profiles to the model directly.
 *
 * Returns the assembled NeighborContext plus the raw focalSnapshot and edgePairs
 * so callers (e.g. runImpact) can reuse them without a second round of DB fetches.
 */
export async function loadNeighborContext(courseCode: string): Promise<LoadNeighborContextResult> {
  const focalSnapshot = await getLatestSnapshotByCourse(courseCode);
  if (!focalSnapshot) {
    throw new Error(`loadNeighborContext: no snapshot for ${courseCode}`);
  }

  const confirmedPairs = await listConfirmedEdgePairs();
  const edgePairs: EdgePair[] = confirmedPairs.map(p => ({
    relyingCourseCode: p.focal,
    prereqCourseCode: p.prereq,
  }));

  const upstreamCodes = new Set(
    edgePairs.filter(e => e.relyingCourseCode === courseCode).map(e => e.prereqCourseCode),
  );
  const downstreamCodes = new Set(
    edgePairs.filter(e => e.prereqCourseCode === courseCode).map(e => e.relyingCourseCode),
  );
  const neighborCodes = new Set([...upstreamCodes, ...downstreamCodes]);

  const profileMap: Record<string, NeighborProfile> = {};
  profileMap[courseCode] = snapshotToNeighborProfile(courseCode, focalSnapshot.profile);

  await Promise.all(
    [...neighborCodes].map(async (code) => {
      const snap = await getLatestSnapshotByCourse(code);
      if (snap) {
        profileMap[code] = snapshotToNeighborProfile(code, snap.profile);
      }
    }),
  );

  const context = assembleNeighborContext({ focalCourseCode: courseCode, profiles: profileMap, edgePairs });
  return { context, focalSnapshot, edgePairs };
}

/**
 * Full orchestration:
 *  1. Fetch the focal course's latest snapshot.
 *  2. Fetch all confirmed edge pairs; build neighbor profiles from their snapshots.
 *  3. Call estimateLocalDelta to get the AI's change + predicted deltas.
 *  4. Resolve predicted competencies to sub-competency depths via coverage table.
 *  5. Build baseline delivered attainment for the focal course.
 *  6. Group downstream edges by relying course.
 *  7. Build a subCompLabel resolver from the sub_competencies table.
 *  8. Assemble and save the Scenario.
 */
export async function runImpact(
  courseCode: string,
  changeProse: string,
): Promise<Scenario> {
  // Steps 1–3: load focal snapshot, edge pairs, and neighbor context in one call.
  const { context: neighborContext, focalSnapshot } = await loadNeighborContext(courseCode);

  // Call the AI with the assembled neighbor context.
  const { result: aiResult } = await estimateLocalDelta(courseCode, changeProse, neighborContext);

  // Step 4 — resolve competency statements → sub-competency depths
  const predictedSubCompDepths = await resolveSubCompetencyDepths(
    focalSnapshot.id,
    aiResult.predictedDeltas,
  );

  // Step 4b — career-fit lines: does the predicted delta improve a career-target band?
  const matrix = await getMatrixData();
  const careerFitLines = computeCareerFit({ focalSnapshotId: focalSnapshot.id, predictedSubCompDepths, matrix });

  // Step 5 — baseline delivered attainment for focal course (as a prereq)
  const baselineDelivered = await buildBaselineDelivered(courseCode, focalSnapshot.id);

  // Step 6 — group downstream edges (edges where prereqCourseCode === courseCode)
  // We need the full edge rows (with expectedK/U/D) for this — fetch via DB.
  const downstreamEdgeRows = await db
    .select({
      focalCourseCode: prerequisiteEdges.focalCourseCode,
      prereqCourseCode: prerequisiteEdges.prereqCourseCode,
      subCompetencyId: prerequisiteEdges.subCompetencyId,
      expectedK: prerequisiteEdges.expectedK,
      expectedU: prerequisiteEdges.expectedU,
      expectedD: prerequisiteEdges.expectedD,
    })
    .from(prerequisiteEdges)
    .where(
      and(
        eq(prerequisiteEdges.prereqCourseCode, courseCode),
        eq(prerequisiteEdges.confirmed, true),
      ),
    );

  // Group by relying course.
  // NB: prerequisiteEdges.focalCourseCode is the RELYING (downstream) course here —
  // we filtered edges to prereqCourseCode === courseCode, so the relying side is
  // the downstream course that depends on our focal course.
  const downstreamByCourse: Record<string, RelyEdge[]> = {};
  for (const row of downstreamEdgeRows) {
    const edges = downstreamByCourse[row.focalCourseCode] ?? [];
    edges.push({
      prereqCourseCode: row.prereqCourseCode,
      subCompetencyId: row.subCompetencyId,
      expectedK: row.expectedK,
      expectedU: row.expectedU,
      expectedD: row.expectedD,
    });
    downstreamByCourse[row.focalCourseCode] = edges;
  }

  // Step 7 — build subCompLabel from the sub_competencies table
  const allSubComps = await db
    .select({ id: subCompetencies.id, name: subCompetencies.name })
    .from(subCompetencies);
  const subCompNameById = new Map(allSubComps.map(s => [s.id, s.name]));
  const subCompLabel = (id: string) => subCompNameById.get(id) ?? id;

  // Step 8 — assemble and persist
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const scenario = assembleScenario({
    id,
    courseCode,
    baselineSnapshotId: focalSnapshot.id,
    createdAt,
    aiResult,
    predictedSubCompDepths,
    baselineDelivered,
    downstreamByCourse,
    careerFitLines,
    subCompLabel,
  });

  await saveScenario(scenario);
  return scenario;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function snapshotToNeighborProfile(courseCode: string, profile: CaptureProfile): NeighborProfile {
  const competencies = (profile.competencies ?? []).map(c => ({
    statement: c.statement,
    type: c.type,
    k_depth: c.k_depth,
    u_depth: c.u_depth,
    d_depth: c.d_depth,
  }));
  const incoming_expectations = (profile.incoming_expectations ?? []).map(ie => ({
    statement: ie.statement,
    expected_depth: {
      k: ie.expected_depth.k,
      u: ie.expected_depth.u,
      d: ie.expected_depth.d,
    },
  }));
  return { courseCode, competencies, incoming_expectations };
}
