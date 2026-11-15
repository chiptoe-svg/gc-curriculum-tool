import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({ db: {} }));

import { nearestNeighbors } from '../relations';
import { parsePlanState } from '../plan-schema';
import { EMPTY_PLAN } from '../types';

describe('nearestNeighbors', () => {
  const items = [
    { id: 'a', stratum: 'technical', vector: [1, 0, 0] },
    { id: 'b', stratum: 'technical', vector: [0.9, 0.1, 0] },
    { id: 'c', stratum: 'technical', vector: [0, 1, 0] },
    { id: 'd', stratum: 'business', vector: [1, 0, 0] },
  ];
  it('keeps only same-stratum items above the floor, nearest first', () => {
    const n = nearestNeighbors(items, { min: 0.5, top: 3 });
    expect(n.get('a')).toEqual(['b']);          // c is orthogonal; d is identical but in another stratum
    expect(n.get('d')).toEqual([]);
  });
  it('caps the list', () => {
    const many = ['x', 'y', 'z', 'w'].map((id, i) => ({ id, stratum: 's', vector: [1, i * 0.01] }));
    expect(nearestNeighbors(many, { min: 0, top: 2 }).get('x')).toHaveLength(2);
  });
});

describe('parsePlanState', () => {
  it('accepts the empty plan and a filled one', () => {
    expect(parsePlanState(EMPTY_PLAN)).toEqual(EMPTY_PLAN);
    const filled = {
      ...EMPTY_PLAN,
      placements: [{ ref: 'GC 1010', act: 1, branch: null }],
      goal: { ...EMPTY_PLAN.goal, targetIds: ['t'], levels: { t: { color: [null, { k: 3, u: 3, d: 3 }, { k: 4, u: null, d: 4 }] } } },
    };
    expect(parsePlanState(filled)).toEqual(filled);
  });
  it('refuses a level outside 0 to 5, an unknown act, and a missing field', () => {
    const bad = (over: object) => parsePlanState({ ...EMPTY_PLAN, ...over });
    expect(bad({ goal: { ...EMPTY_PLAN.goal, levels: { t: { color: [null, null, { k: 6, u: 0, d: 0 }] } } } })).toBeNull();
    expect(bad({ placements: [{ ref: 'GC 1010', act: 4, branch: null }] })).toBeNull();
    const noFade: Record<string, unknown> = { ...EMPTY_PLAN };
    delete noFade.fade;
    expect(parsePlanState(noFade)).toBeNull();
  });
});
