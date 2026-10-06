import { getTargetDemand } from '@/lib/db/career-target-demand-queries';
import { getMatrixData } from '@/lib/db/program-coverage-queries';
import {
  computeSufficiency,
  type DemandContribution,
  type AttainmentContribution,
  type SubCompetencySufficiency,
} from '@/lib/program/sufficiency';

export interface TargetSufficiencyRow extends SubCompetencySufficiency {
  subCompetencyName: string;
}

/**
 * Compose the demand→coverage sufficiency view for one career target:
 * stored partner-weighted demand (career_target_demand) vs current attainment
 * (latest-snapshot-per-course coverage cells, ordinal-MAX in the engine).
 *
 * GATED: reads career_target_demand, whose migration (0032) is unapplied — call
 * only behind DEMAND_COVERAGE_SEAM. Spec:
 * docs/superpowers/specs/2026-06-07-demand-coverage-sufficiency-seam-design.md
 */
export async function getTargetSufficiency(targetId: string): Promise<TargetSufficiencyRow[]> {
  const [demandRows, matrix] = await Promise.all([getTargetDemand(targetId), getMatrixData()]);

  // Stored demand is already partner-weighted per sub-competency — feed each as a
  // single weight-1 contribution so the engine passes it through unchanged.
  // Only the target's current sub-competencies: the matrix already omits
  // retired ones, so stored demand on a retired id is history, not a gap.
  const currentIds = new Set(matrix.subCompetencies.filter(s => s.careerTargetId === targetId).map(s => s.id));
  const demand: DemandContribution[] = demandRows.filter(r => currentIds.has(r.subCompetencyId)).map(r => ({
    subCompetencyId: r.subCompetencyId,
    weight: 1,
    k: r.kDemand,
    u: r.uDemand,
    d: r.dDemand,
  }));

  // Attainment: every current coverage cell for this target; the engine takes
  // the ordinal MAX across contributing course snapshots per sub-competency.
  const attainment: AttainmentContribution[] = matrix.cells
    .filter(c => c.careerTargetId === targetId)
    .map(c => ({ subCompetencyId: c.subCompetencyId, k: c.kDepth, u: c.uDepth, d: c.dDepth }));

  const names = new Map(matrix.subCompetencies.map(s => [s.id, s.name]));
  return computeSufficiency(demand, attainment).map(r => ({
    ...r,
    subCompetencyName: names.get(r.subCompetencyId) ?? r.subCompetencyId,
  }));
}
