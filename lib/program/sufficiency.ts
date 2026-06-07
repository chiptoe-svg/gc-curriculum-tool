/**
 * Demand → Coverage sufficiency engine (pure; no DB).
 *
 * For each career-target sub-competency, compares employer-evidenced DEMAND
 * (partner-weighted average of position K/U/D, per the 2026-06-07 design) against
 * curriculum ATTAINMENT (ordinal MAX of snapshot_target_coverage cells), per
 * dimension. The aggregation asymmetry is deliberate: demand is "typical market
 * expectation" (weighted mean), attainment is "the deepest a course actually
 * reached" (ordinal MAX — must never be averaged, like prereq-gaps).
 *
 * No-data discipline (load-bearing, mirrors prereq-gaps + evidence-above-zero):
 *   - no contributing positions for a dim   → 'no_demand'  (never 0-demand=met)
 *   - demanded but attainment dim is null    → 'no_coverage' (no phantom gap)
 *   - both present                           → gap = max(0, demand − attainment)
 *
 * Spec: docs/superpowers/specs/2026-06-07-demand-coverage-sufficiency-seam-design.md
 */

export interface DemandContribution {
  subCompetencyId: string;
  /** partner.weight (>= 0; defaults to 1 upstream). */
  weight: number;
  k: number | null;
  u: number | null;
  d: number | null;
}

export interface AttainmentContribution {
  subCompetencyId: string;
  k: number | null;
  u: number | null;
  d: number; // d_depth is non-null in snapshot_target_coverage
}

export type SufficiencyStatus = 'met' | 'gap' | 'no_coverage' | 'no_demand';

export interface DimSufficiency {
  /** Partner-weighted demand average (fractional), or null when nothing demanded. */
  demand: number | null;
  /** Ordinal-MAX attainment, or null when no coverage data for this dim. */
  attainment: number | null;
  /** max(0, demand − attainment); null unless BOTH demand and attainment are present. */
  gap: number | null;
  status: SufficiencyStatus;
}

export interface SubCompetencySufficiency {
  subCompetencyId: string;
  k: DimSufficiency;
  u: DimSufficiency;
  d: DimSufficiency;
  status: SufficiencyStatus;
}

type Dim = 'k' | 'u' | 'd';

/** Partner-weighted average over non-null contributions; null if none. Falls back
 *  to unweighted mean when the contributing weights sum to 0 (never divides by 0). */
function weightedDemand(contribs: DemandContribution[], dim: Dim): number | null {
  const present = contribs.filter(c => c[dim] != null);
  if (present.length === 0) return null;
  const sumW = present.reduce((s, c) => s + (c.weight ?? 0), 0);
  if (sumW <= 0) {
    return present.reduce((s, c) => s + (c[dim] as number), 0) / present.length;
  }
  return present.reduce((s, c) => s + (c.weight ?? 0) * (c[dim] as number), 0) / sumW;
}

/** Ordinal MAX over non-null contributions; null if none. */
function maxAttainment(contribs: AttainmentContribution[], dim: Dim): number | null {
  let max: number | null = null;
  for (const c of contribs) {
    const v = c[dim];
    if (v == null) continue;
    max = max == null ? v : Math.max(max, v);
  }
  return max;
}

function dimSufficiency(demand: number | null, attainment: number | null): DimSufficiency {
  if (demand == null) return { demand: null, attainment, gap: null, status: 'no_demand' };
  if (attainment == null) return { demand, attainment: null, gap: null, status: 'no_coverage' };
  const gap = Math.max(0, demand - attainment);
  return { demand, attainment, gap, status: gap > 0 ? 'gap' : 'met' };
}

/** Priority: gap > no_coverage > met > no_demand. */
function rollupStatus(dims: DimSufficiency[]): SufficiencyStatus {
  if (dims.some(d => d.status === 'gap')) return 'gap';
  if (dims.some(d => d.status === 'no_coverage')) return 'no_coverage';
  if (dims.some(d => d.status === 'met')) return 'met';
  return 'no_demand';
}

export function computeSufficiency(
  demand: DemandContribution[],
  attainment: AttainmentContribution[],
): SubCompetencySufficiency[] {
  const ids = new Set<string>();
  for (const d of demand) ids.add(d.subCompetencyId);
  for (const a of attainment) ids.add(a.subCompetencyId);

  const out: SubCompetencySufficiency[] = [];
  for (const subCompetencyId of [...ids].sort()) {
    const dContribs = demand.filter(d => d.subCompetencyId === subCompetencyId);
    const aContribs = attainment.filter(a => a.subCompetencyId === subCompetencyId);
    const k = dimSufficiency(weightedDemand(dContribs, 'k'), maxAttainment(aContribs, 'k'));
    const u = dimSufficiency(weightedDemand(dContribs, 'u'), maxAttainment(aContribs, 'u'));
    const d = dimSufficiency(weightedDemand(dContribs, 'd'), maxAttainment(aContribs, 'd'));
    out.push({ subCompetencyId, k, u, d, status: rollupStatus([k, u, d]) });
  }
  return out;
}
