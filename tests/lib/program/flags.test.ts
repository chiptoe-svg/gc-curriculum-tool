import { describe, it, expect } from 'vitest';
import {
  openFlagsForCell,
  flagDrift,
  type FlagLike,
} from '@/lib/program/flags';

function f(o: Partial<FlagLike>): FlagLike {
  return {
    id: o.id ?? 'f1',
    targetKind: o.targetKind ?? 'coverage_cell',
    courseCode: o.courseCode ?? 'GC 1010',
    careerTargetId: o.careerTargetId ?? 'brand-strategist',
    subCompetencyId: o.subCompetencyId ?? 'color-management',
    competencyStatement: o.competencyStatement ?? null,
    status: o.status ?? 'open',
    flaggedContext: o.flaggedContext ?? null,
    ...o, // spread last so partial-key overrides in o always win
  };
}

describe('openFlagsForCell', () => {
  it('matches open cell flags on the stable triple and ignores resolved ones', () => {
    const flags = [
      f({ id: 'a' }),
      f({ id: 'b', status: 'resolved' }),
      f({ id: 'c', subCompetencyId: 'other-sub' }),
      f({ id: 'd', targetKind: 'profile_competency', careerTargetId: null, subCompetencyId: null, competencyStatement: 'x' }),
    ];
    const hits = openFlagsForCell(flags, 'GC 1010', 'brand-strategist', 'color-management');
    expect(hits.map(h => h.id)).toEqual(['a']);
  });
});

describe('flagDrift', () => {
  it('reports per-dimension was/now deltas', () => {
    const drift = flagDrift({ k: 3, u: 2, d: 4 }, { k: 3, u: 2, d: 2 });
    expect(drift).toEqual([{ dim: 'd', was: 4, now: 2 }]);
  });
  it('reports null→value and value→null transitions', () => {
    const drift = flagDrift({ k: null, u: 1, d: 3 }, { k: 2, u: 1, d: 3 });
    expect(drift).toEqual([{ dim: 'k', was: null, now: 2 }]);
  });
  it('returns null when nothing changed', () => {
    expect(flagDrift({ k: 1, u: 1, d: 1 }, { k: 1, u: 1, d: 1 })).toBeNull();
  });
  it('returns null when context or current cell is missing', () => {
    expect(flagDrift(null, { k: 1, u: 1, d: 1 })).toBeNull();
    expect(flagDrift({ k: 1, u: 1, d: 1 }, null)).toBeNull();
  });
});
