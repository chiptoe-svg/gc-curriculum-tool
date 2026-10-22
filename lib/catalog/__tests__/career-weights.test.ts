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

import { employerWeight, captureInputFromRow } from '@/lib/catalog/career-weights';

describe('employerWeight', () => {
  const cap = (id: string, rated: Array<[string | null, unknown]>, named: string[] = []) =>
    ({ id, ratedItems: rated.map(([competencyId, rating]) => ({ competencyId, rating })), namedCompetencyIds: named });

  it('per capture takes the highest rating tagged with the competency, rescaled (r − 1)/6, then averages captures', () => {
    const r = employerWeight([cap('p1', [['c', 4], ['c', 7], ['x', 1]]), cap('p2', [['c', 1]])], 'c');
    expect(r.weight).toBeCloseTo((1 + 0) / 2);
    expect(r.ratedBy).toEqual(['p1', 'p2']);
    expect(r.namedOnlyBy).toEqual([]);
  });

  it('a capture that only names the competency is named-unrated and adds no number', () => {
    const r = employerWeight([cap('p1', [['x', 7]], ['c'])], 'c');
    expect(r).toEqual({ weight: null, ratedBy: [], namedOnlyBy: ['p1'] });
  });

  it('a competency nobody mentions is no data, never 0', () => {
    expect(employerWeight([cap('p1', [['x', 7]])], 'c')).toEqual({ weight: null, ratedBy: [], namedOnlyBy: [] });
  });

  it('ignores ratings outside 1–7, non-integers outside range, and non-numbers', () => {
    const r = employerWeight([cap('p1', [['c', 0], ['c', 8], ['c', '7'], ['c', null], ['c', Number.NaN]])], 'c');
    expect(r).toEqual({ weight: null, ratedBy: [], namedOnlyBy: [] });
  });
});

describe('captureInputFromRow', () => {
  it('reads rated_skills items and qualifying competency ids, tolerating missing pieces', () => {
    const c = captureInputFromRow({
      id: 'p1',
      ratedSkills: { items: [{ name: 'a', sub_competency_id: 'c', rating: 6 }, { name: 'b', rating: 3 }], generatedAt: 'x' },
      profile: { qualifying_competencies: [{ name: 'n', sub_competency_id: 'd' }, { name: 'm', sub_competency_id: null }] },
    });
    expect(c).toEqual({ id: 'p1', ratedItems: [{ competencyId: 'c', rating: 6 }, { competencyId: null, rating: 3 }], namedCompetencyIds: ['d'] });
    expect(captureInputFromRow({ id: 'p2', ratedSkills: null, profile: null })).toEqual({ id: 'p2', ratedItems: [], namedCompetencyIds: [] });
  });

describe('effectiveWeight with an AI draft (addendum 3)', () => {
  const base = { onet: 0.9, employer: 0.2, n: 2, facultyOverride: null, facultyDraft: null };
  it('a faculty override beats the AI draft', () => {
    expect(effectiveWeight({ ...base, ai: 0.4, facultyOverride: 0.1 })).toMatchObject({ weight: 0.1, basis: 'faculty_override' });
  });
  it('the AI draft beats blend, O*NET and employer', () => {
    expect(effectiveWeight({ ...base, ai: 0.4 })).toMatchObject({ weight: 0.4, basis: 'ai' });
    expect(effectiveWeight({ onet: null, employer: 0.9, n: 1, facultyOverride: null, facultyDraft: null, ai: 0 })).toMatchObject({ weight: 0, basis: 'ai' });
  });
  it('without an AI draft nothing changes', () => {
    expect(effectiveWeight(base).basis).toBe('blend');
  });
});
});
