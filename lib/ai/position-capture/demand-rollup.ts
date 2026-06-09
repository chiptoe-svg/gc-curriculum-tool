import { listSubmittedPositionsForTarget } from '@/lib/db/position-capture-queries';
import { listPartners } from '@/lib/partners/queries';
import { upsertTargetDemand } from '@/lib/db/career-target-demand-queries';
import { aggregateDemandBySubCompetency, type DemandContribution } from '@/lib/program/sufficiency';
import type { PositionProfileType } from './schema';

/**
 * Recompute the partner-weighted employer demand for a career target and persist
 * it to career_target_demand (demand-measurement side of the Q1 sufficiency
 * seam). Deterministic, no AI.
 *
 * Contributing signal: each interviewed, submitted, non-superseded position's
 * `qualifying_competencies` whose `sub_competency_id` is set; weighted by the
 * partner's `weight`. Unmapped competencies (null sub_competency_id) are excluded
 * in v1. The weighting + no-data handling live in the pure engine
 * (aggregateDemandBySubCompetency), which is unit-tested.
 *
 * GATED: career_target_demand ships via migration 0032 (not yet applied) — only
 * call this once the migration is applied and DEMAND_COVERAGE_SEAM is on. Spec:
 * docs/superpowers/specs/2026-06-07-demand-coverage-sufficiency-seam-design.md
 */
export async function regenerateTargetDemand(targetId: string): Promise<{ subCompetencies: number }> {
  const positions = (await listSubmittedPositionsForTarget(targetId))
    .filter(p => p.completeness === 'interviewed' && p.profile);

  const partners = await listPartners();
  const weightById = new Map(partners.map(p => [p.id, p.weight ?? 1]));

  const contribs: DemandContribution[] = [];
  const positionIdsBySub = new Map<string, Set<string>>();

  for (const pos of positions) {
    const weight = weightById.get(pos.partnerId) ?? 1;
    const profile = pos.profile as PositionProfileType;
    for (const c of profile.qualifying_competencies) {
      if (!c.sub_competency_id) continue; // unmapped employer competency — excluded in v1
      contribs.push({
        subCompetencyId: c.sub_competency_id,
        weight,
        k: c.required_for_success.k_depth,
        u: c.required_for_success.u_depth,
        d: c.required_for_success.d_depth,
      });
      if (!positionIdsBySub.has(c.sub_competency_id)) positionIdsBySub.set(c.sub_competency_id, new Set());
      positionIdsBySub.get(c.sub_competency_id)!.add(pos.id);
    }
  }

  const aggregated = aggregateDemandBySubCompetency(contribs);
  await upsertTargetDemand(
    targetId,
    aggregated.map(a => ({
      subCompetencyId: a.subCompetencyId,
      k: a.k,
      u: a.u,
      d: a.d,
      contributingPositionIds: [...(positionIdsBySub.get(a.subCompetencyId) ?? [])],
    })),
  );

  return { subCompetencies: aggregated.length };
}
