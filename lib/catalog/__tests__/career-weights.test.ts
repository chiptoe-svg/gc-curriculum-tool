import { describe, it, expect } from 'vitest';
import { onetWeight, effectiveWeight, rescaleImportance, type WeightItem } from '@/lib/catalog/career-weights';

const occ = [{ soc: 'A', share: 0.75 }, { soc: 'B', share: 0.25 }];

describe('onetWeight', () => {
  it('rescales Importance (IM − 1) / 4', () => {
    expect(rescaleImportance(1)).toBe(0);
    expect(rescaleImportance(5)).toBe(1);
    expect(rescaleImportance(4)).toBeCloseTo(0.75);
  });

  it('takes the highest core item per occupation, weighted by share', () => {
    const items: WeightItem[] = [
      { position: 'core', importanceBySoc: { A: 5, B: 3 } },
      { position: 'core', importanceBySoc: { A: 3, B: 4 } },
    ];
    // A: max(1, .5) = 1 → .75 ; B: max(.5, .75) = .75 → .1875
    expect(onetWeight(items, occ)).toBeCloseTo(0.9375);
  });

  it('ignores related items at the default discount 0 and fringe always', () => {
    const items: WeightItem[] = [
      { position: 'core', importanceBySoc: { A: 3 } },
      { position: 'related', importanceBySoc: { A: 5 } },
      { position: 'fringe', importanceBySoc: { A: 5, B: 5 } },
    ];
    expect(onetWeight(items, occ)).toBeCloseTo(0.75 * 0.5);
  });

  it('counts related items at the given discount', () => {
    const items: WeightItem[] = [{ position: 'related', importanceBySoc: { A: 5 } }];
    expect(onetWeight(items, occ, 0.5)).toBeCloseTo(0.75 * 0.5);
  });

  it('an occupation with no rated counting item contributes 0 without nulling the weight', () => {
    const items: WeightItem[] = [{ position: 'core', importanceBySoc: { A: 5 } }];
    expect(onetWeight(items, occ)).toBeCloseTo(0.75);
  });

  it('returns null, not 0, when no counting item is rated in any target occupation', () => {
    expect(onetWeight([], occ)).toBeNull();
    expect(onetWeight([{ position: 'related', importanceBySoc: { A: 5 } }], occ)).toBeNull();
    expect(onetWeight([{ position: 'core', importanceBySoc: { Z: 5 } }], occ)).toBeNull();
  });
});

describe('effectiveWeight', () => {
  const none = { onet: null, employer: null, n: 0, facultyOverride: null, facultyDraft: null };

  it('a faculty override always wins', () => {
    expect(effectiveWeight({ ...none, onet: 0.9, employer: 0.1, n: 5, facultyOverride: 0.3 })).toEqual({ weight: 0.3, basis: 'faculty_override', disagreement: true });
  });

  it('with no employer ratings the weight is the O*NET weight', () => {
    expect(effectiveWeight({ ...none, onet: 0.8 })).toEqual({ weight: 0.8, basis: 'onet', disagreement: false });
  });

  it('blends (k·onet + n·employer)/(k + n) with k = 3', () => {
    const r = effectiveWeight({ ...none, onet: 0.8, employer: 0.4, n: 1 });
    expect(r.basis).toBe('blend');
    expect(r.weight).toBeCloseTo((3 * 0.8 + 1 * 0.4) / 4);
  });

  it('uses the employer weight when there is no O*NET weight', () => {
    expect(effectiveWeight({ ...none, employer: 0.6, n: 2 })).toEqual({ weight: 0.6, basis: 'employer', disagreement: false });
  });

  it('falls back to the faculty draft, then to none', () => {
    expect(effectiveWeight({ ...none, facultyDraft: 0.5 })).toEqual({ weight: 0.5, basis: 'faculty_draft', disagreement: false });
    expect(effectiveWeight(none)).toEqual({ weight: null, basis: 'none', disagreement: false });
  });

  it('flags disagreement only at a gap of 0.25 or more with n ≥ 2', () => {
    expect(effectiveWeight({ ...none, onet: 0.8, employer: 0.55, n: 2 }).disagreement).toBe(true);
    expect(effectiveWeight({ ...none, onet: 0.8, employer: 0.56, n: 2 }).disagreement).toBe(false);
    expect(effectiveWeight({ ...none, onet: 0.8, employer: 0.1, n: 1 }).disagreement).toBe(false);
  });

  it('ignores an employer weight with n = 0 (named-unrated rows carry weight null)', () => {
    expect(effectiveWeight({ ...none, onet: 0.7, employer: null, n: 0 })).toEqual({ weight: 0.7, basis: 'onet', disagreement: false });
  });
});
