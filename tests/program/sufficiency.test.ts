import { describe, it, expect } from 'vitest';
import {
  computeSufficiency,
  type DemandContribution,
  type AttainmentContribution,
} from '@/lib/program/sufficiency';

// helpers
const dem = (subCompetencyId: string, weight: number, k: number | null, u: number | null, d: number | null): DemandContribution =>
  ({ subCompetencyId, weight, k, u, d });
const att = (subCompetencyId: string, k: number | null, u: number | null, d: number): AttainmentContribution =>
  ({ subCompetencyId, k, u, d });

function forSub(rows: ReturnType<typeof computeSufficiency>, id: string) {
  const r = rows.find(x => x.subCompetencyId === id);
  if (!r) throw new Error(`no sufficiency row for ${id}`);
  return r;
}

describe('computeSufficiency', () => {
  it('partner-weighted demand average vs ordinal-MAX attainment → fractional gap', () => {
    // two employers demand D: weight 1 → D2, weight 3 → D5  ⇒ (1*2 + 3*5)/4 = 4.25
    // attainment from two snapshots: D3 and D4 ⇒ MAX = 4
    const demand = [dem('X', 1, null, null, 2), dem('X', 3, null, null, 5)];
    const attainment = [att('X', null, null, 3), att('X', null, null, 4)];
    const r = forSub(computeSufficiency(demand, attainment), 'X');
    expect(r.d.demand).toBeCloseTo(4.25, 5);
    expect(r.d.attainment).toBe(4);          // ordinal MAX, not averaged
    expect(r.d.gap).toBeCloseTo(0.25, 5);    // 4.25 - 4
    expect(r.d.status).toBe('gap');
  });

  it('met when attainment >= weighted demand', () => {
    const r = forSub(computeSufficiency([dem('X', 2, null, null, 3)], [att('X', null, null, 4)]), 'X');
    expect(r.d.gap).toBe(0);
    expect(r.d.status).toBe('met');
  });

  it('no_demand when a dimension has no contributing positions (never 0-demand=sufficient)', () => {
    const r = forSub(computeSufficiency([dem('X', 1, null, null, 3)], [att('X', 2, 2, 4)]), 'X');
    expect(r.k.status).toBe('no_demand');
    expect(r.k.demand).toBeNull();
    expect(r.k.gap).toBeNull();
  });

  it('no_coverage when demanded but attainment dimension is null (no phantom full gap)', () => {
    // employers demand K3, but coverage has no K data for this sub-comp
    const r = forSub(computeSufficiency([dem('X', 1, 3, null, null)], [att('X', null, null, 2)]), 'X');
    expect(r.k.status).toBe('no_coverage');
    expect(r.k.demand).toBe(3);
    expect(r.k.attainment).toBeNull();
    expect(r.k.gap).toBeNull();
  });

  it('falls back to unweighted mean when all weights are zero (no divide-by-zero)', () => {
    const r = forSub(computeSufficiency([dem('X', 0, null, null, 2), dem('X', 0, null, null, 4)], [att('X', null, null, 1)]), 'X');
    expect(r.d.demand).toBeCloseTo(3, 5); // unweighted mean of 2,4
    expect(r.d.status).toBe('gap');
  });

  it('only averages non-null contributions per dimension', () => {
    // D: weight1→null, weight3→4  ⇒ only the second counts ⇒ 4
    const r = forSub(computeSufficiency([dem('X', 1, null, null, null), dem('X', 3, null, null, 4)], [att('X', null, null, 2)]), 'X');
    expect(r.d.demand).toBe(4);
    expect(r.d.gap).toBe(2);
  });

  it('rolls sub-competency status: gap > no_coverage > met > no_demand', () => {
    // K demanded+covered & met, U demanded but no coverage, D no demand
    const r = forSub(computeSufficiency([dem('X', 1, 2, 3, null)], [att('X', 3, null, 5)]), 'X');
    expect(r.k.status).toBe('met');
    expect(r.u.status).toBe('no_coverage');
    expect(r.d.status).toBe('no_demand');
    expect(r.status).toBe('no_coverage'); // no gap, but a no_coverage caution outranks met
  });

  it('reports the union of sub-competencies present in demand or attainment', () => {
    const rows = computeSufficiency([dem('A', 1, null, null, 3)], [att('B', null, null, 2)]);
    expect(rows.map(r => r.subCompetencyId).sort()).toEqual(['A', 'B']);
    expect(forSub(rows, 'B').status).toBe('no_demand'); // attainment only, nothing demanded
  });
});
