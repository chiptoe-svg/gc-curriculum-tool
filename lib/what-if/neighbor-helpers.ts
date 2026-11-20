/**
 * Neighbor profiles and baseline helpers shared by the what-if code (moved from the
 * retired lib/ai/explore). Kept apart from neighbors.ts so tests can mock the
 * loader there without hiding these.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { competencyLevels } from '@/lib/db/schema';
import { getIntendedCoverageForCourses } from '@/lib/db/courses-queries';
import type { CaptureProfile } from '@/lib/ai/capture/schema';
import type { DeliveredAttainment } from '@/lib/program/prereq-gaps';

export interface NeighborCompetency { statement: string; type: 'technical' | 'foundational'; k_depth: number | null; u_depth: number | null; d_depth: number; }
export interface NeighborIncoming { statement: string; expected_depth: { k: number | null; u: number | null; d: number }; }
export interface NeighborProfile { courseCode: string; competencies: NeighborCompetency[]; incoming_expectations: NeighborIncoming[]; }
export interface EdgePair { relyingCourseCode: string; prereqCourseCode: string; }

export interface NeighborContext {
  focal: NeighborProfile;
  upstream: NeighborProfile[];   // courses the focal relies on
  downstream: NeighborProfile[]; // courses that rely on the focal
}

export function assembleNeighborContext(input: {
  focalCourseCode: string;
  profiles: Record<string, NeighborProfile>;
  edgePairs: EdgePair[];
}): NeighborContext {
  const focal = input.profiles[input.focalCourseCode];
  if (!focal) throw new Error(`no profile for focal course ${input.focalCourseCode}`);
  const upstreamCodes = new Set(input.edgePairs.filter(e => e.relyingCourseCode === input.focalCourseCode).map(e => e.prereqCourseCode));
  const downstreamCodes = new Set(input.edgePairs.filter(e => e.prereqCourseCode === input.focalCourseCode).map(e => e.relyingCourseCode));
  const pick = (codes: Set<string>) => [...codes].map(c => input.profiles[c]).filter((p): p is NeighborProfile => !!p);
  return { focal, upstream: pick(upstreamCodes), downstream: pick(downstreamCodes) };
}

export interface PredictedSubCompDepth { subCompetencyId: string; k: number | null; u: number | null; d: number | null; }

/** Normalize a competency statement for matching: trim, lowercase, collapse internal whitespace.
 *  Tolerates the formatting/casing drift between the local-delta AI's competency wording and
 *  snapshot_competency_coverage.matched_competency (which the scoring AI may have re-cased/spaced). */
export function normalizeCompetencyKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Resolve a predicted delta's competency statement to sub-competency depths,
 * using the competencyLevels rows for the focal course's latest
 * snapshot. The coverage table stores `matchedCompetency` (the profile
 * competency statement the AI matched to each sub-competency) alongside
 * `subCompetencyId` and the scored depths. This is the same linkage the
 * program coverage matrix and the scaffolding analysis use.
 *
 * Resolution logic:
 *   1. Look up all competencyLevels rows for the focal snapshot.
 *   2. For each predicted delta, find rows where matchedCompetency === competency
 *      (exact string match; the same statement the AI wrote into both the profile
 *      and the coverage table). If matched, emit PredictedSubCompDepth with the
 *      predicted to.k/u/d depths.
 *   3. If a predicted competency does NOT match any matchedCompetency in the
 *      coverage table, OMIT it from predictedSubCompDepths — it will still appear
 *      in Scenario.predictedDeltas for display, just not in the ripple engine.
 *      NEVER fabricate a sub-competency id.
 *
 * CONCERN NOTE: matchedCompetency in competencyLevels is populated by
 * the program-score-coverage AI function, which may paraphrase rather than
 * copy verbatim the profile's competency statement. If the scoring AI wrote a
 * paraphrase, exact-string match will miss it; the competency will be omitted
 * from the ripple rather than mismatched. This is the safe direction: false
 * negatives (no ripple for an unresolved competency) vs. false positives
 * (wrong sub-comp in the ripple). A future increment can add fuzzy matching.
 */
export async function resolveSubCompetencyDepths(
  snapshotId: string,
  predictedDeltas: Array<{ competency: string; to: { k: number | null; u: number | null; d: number } }>,
): Promise<PredictedSubCompDepth[]> {
  if (predictedDeltas.length === 0) return [];

  const coverageRows = await db
    .select({
      subCompetencyId: competencyLevels.competencyId,
      matchedCompetency: competencyLevels.matchedCompetency,
    })
    .from(competencyLevels)
    .where(eq(competencyLevels.snapshotId, snapshotId));

  // Build a map: competency statement → [subCompetencyId, ...] (one competency
  // can score against multiple sub-comps; emit one PredictedSubCompDepth per
  // sub-comp, all carrying the same predicted depths).
  // snapshot_target_coverage has a 3-col PK incl. careerTargetId; a course scored
  // against multiple targets yields duplicate rows per subComp with identical depths
  // — dedup by subCompetencyId to match computePrereqGaps. (one row per competency
  // since P0a; kept as a guard)
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
 * We read competencyLevels directly (measured basis) and layer in
 * intended coverage rows the same way the gap engine does.
 */
export async function buildBaselineDelivered(
  focalCourseCode: string,
  snapshotId: string,
): Promise<DeliveredAttainment[]> {
  const measuredRows = await db
    .select({
      subCompetencyId: competencyLevels.competencyId,
      kDepth: competencyLevels.kDepth,
      uDepth: competencyLevels.uDepth,
      dDepth: competencyLevels.dDepth,
    })
    .from(competencyLevels)
    .where(eq(competencyLevels.snapshotId, snapshotId));

  // snapshot_target_coverage has a 3-col PK incl. careerTargetId; a course scored
  // against multiple targets yields duplicate rows per subComp with identical depths
  // — dedup by subCompetencyId to match computePrereqGaps. (one row per competency
  // since P0a; kept as a guard)
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

export function snapshotToNeighborProfile(courseCode: string, profile: CaptureProfile): NeighborProfile {
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
