import { describe, it, expect } from 'vitest';
import { computeAgreement, sumAgreement, cohenKappa, itemKey, type Pos, type AgreementRow } from '@/lib/catalog/agreement';
import { taskGroupKey } from '@/lib/catalog/shortlist';
import { formatReport } from '@/scripts/catalog/bundle-agreement-report';

const ATTRIBUTION = 'This product includes information from O*NET 31.0 Database by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA). Used under the CC BY 4.0 license.';

function m(entries: Array<[string, Pos]>): Map<string, Pos> { return new Map(entries); }

describe('itemKey', () => {
  it('keys elements by id and tasks by taskGroupKey(label)', () => {
    expect(itemKey('onet_element', '2.C.1.a')).toBe('element:2.C.1.a');
    expect(itemKey('onet_task', 'Prepare proofs.')).toBe(`task:${taskGroupKey('Prepare proofs.')}`);
    expect(itemKey('onet_task', '  prepare   PROOFS ')).toBe(itemKey('onet_task', 'Prepare proofs.'));
  });
});

describe('computeAgreement — core + related only (decision 2026-10-19), hand-worked fixture', () => {
  // AI core+related = {e1 core, e2 related, e3 related}; AI fringe {t1, t2} is excluded.
  // Reviewer = {e1 core, e2 core, t1 related, t3 related}; t1 is an AI-fringe item, so it is reviewer-only here.
  const input = {
    bundleId: 'b1',
    ai: m([['e1', 'core'], ['e2', 'related'], ['e3', 'related'], ['t1', 'fringe'], ['t2', 'fringe']]),
    blind: m([['e1', 'core'], ['e2', 'core'], ['t1', 'related'], ['t3', 'related']]),
  };

  it('excludes AI fringe from precision; position agreement is exact core-vs-related on shared items', () => {
    expect(computeAgreement(input)).toEqual({
      bundleId: 'b1', aiCount: 3, blindCount: 4, both: 2, precision: 2 / 3, recall: 2 / 4, exact: 1,
    });
  });

  it('AI fringe placements do not change the figures at all', () => {
    const noFringe = computeAgreement({ ...input, ai: m([['e1', 'core'], ['e2', 'related'], ['e3', 'related']]) });
    expect(computeAgreement(input)).toEqual(noFringe);
  });

  it('a reviewer fringe pick (not offered by the blind UI) is ignored, not counted', () => {
    const r = computeAgreement({ bundleId: 'b', ai: m([['x', 'core']]), blind: m([['x', 'fringe']]) });
    expect(r).toMatchObject({ blindCount: 0, both: 0, exact: 0, precision: 0, recall: null });
  });

  it('empty AI core/related gives precision null; empty blind gives recall null', () => {
    const noAi = computeAgreement({ ...input, ai: m([['t1', 'fringe']]) });
    expect(noAi.precision).toBeNull();
    expect(noAi.recall).toBe(0);
    const noBlind = computeAgreement({ ...input, blind: new Map() });
    expect(noBlind.recall).toBeNull();
    expect(noBlind.precision).toBe(0);
  });
});

describe('sumAgreement', () => {
  it('recomputes ratios from summed counts, never averages ratios', () => {
    const a: AgreementRow = { bundleId: 'a', aiCount: 1, blindCount: 1, both: 1, precision: 1, recall: 1, exact: 1 };
    const b: AgreementRow = { bundleId: 'b', aiCount: 9, blindCount: 3, both: 0, precision: 0, recall: 0, exact: 0 };
    const s = sumAgreement([a, b]);
    expect(s).toEqual({ bundleId: 'ALL', aiCount: 10, blindCount: 4, both: 1, precision: 0.1, recall: 0.25, exact: 1 });
    expect(s.precision).not.toBe(0.5);
  });

  it('empty input gives null ratios', () => {
    expect(sumAgreement([])).toMatchObject({ bundleId: 'ALL', precision: null, recall: null, aiCount: 0 });
  });
});

describe('cohenKappa', () => {
  it('perfect agreement gives 1', () => {
    const v: Array<Pos | 'none'> = ['core', 'none', 'core', 'none'];
    expect(cohenKappa(v, [...v])).toBe(1);
  });

  it('chance-level agreement gives 0', () => {
    expect(cohenKappa(['core', 'core', 'none', 'none'], ['core', 'none', 'core', 'none'])).toBe(0);
  });

  it('textbook 2-category example: po 0.7, pe 0.5 gives 0.4', () => {
    // a: 5 core / 5 none (so pe = 0.5 whatever b's margins); 7 of 10 agree.
    const a: Array<Pos | 'none'> = ['core', 'core', 'core', 'core', 'core', 'none', 'none', 'none', 'none', 'none'];
    const b: Array<Pos | 'none'> = ['core', 'core', 'core', 'core', 'none', 'none', 'none', 'none', 'core', 'core'];
    expect(cohenKappa(a, b)).toBeCloseTo(0.4, 10);
  });

  it('mismatched or zero lengths give null; expected agreement 1 gives null', () => {
    expect(cohenKappa(['core'], ['core', 'none'])).toBeNull();
    expect(cohenKappa([], [])).toBeNull();
    expect(cohenKappa(['none', 'none'], ['none', 'none'])).toBeNull();
  });
});

describe('formatReport', () => {
  const row = computeAgreement({
    bundleId: 'b1',
    ai: m([['e1', 'core'], ['e2', 'related'], ['e3', 'related'], ['t1', 'fringe'], ['t2', 'fringe']]),
    blind: m([['e1', 'core'], ['e2', 'core'], ['t1', 'related'], ['t3', 'related']]),
  });

  it('prints the header, counts line, ratios, ALL row, κ fallback, no-match list, caveats and attribution', () => {
    const out = formatReport({ rows: [row], kappas: [], noMatch: [{ bundleId: 'b9', note: 'nothing fits' }], notYetMapped: [] });
    expect(out).not.toContain('not yet mapped');
    expect(out).toContain('Bundle agreement report — blind sample (n = 1 bundles; percentages are rough at this size)');
    expect(out).toContain('AI placed 3 (core + related; fringe excluded), reviewer placed 4, both 2, same position 1');
    expect(out).toContain('precision 66.7%, recall 50.0%');
    expect(out).toContain('ALL');
    expect(out).toContain("Cohen's κ: needs a second blind reviewer");
    expect(out).toContain('b9');
    expect(out).toContain('nothing fits');
    expect(out).toContain('shortlist recall: not measured — the blind list is the AI\'s own shortlist (decision 2026-10-19)');
    expect(out).not.toContain('within one');
    expect(out).not.toContain('outside top-');
    expect(out).toContain('Nothing is auto-confirmed in P2, whatever these figures say.');
    expect(out).toContain(ATTRIBUTION);
  });

  it('prints n/a for null ratios and κ per bundle when given', () => {
    const empty = computeAgreement({ bundleId: 'b2', ai: new Map(), blind: new Map() });
    const out = formatReport({ rows: [empty], kappas: [{ bundleId: 'b2', kappa: 0.4 }], noMatch: [], notYetMapped: ['b7', 'b8'] });
    expect(out).toContain('not yet mapped: b7, b8');
    expect(out).toContain('n = 1 bundles');
    expect(out).toContain('precision n/a, recall n/a');
    expect(out).toContain("Cohen's κ b2: 0.40");
    expect(out).not.toContain('needs a second blind reviewer');
  });
});
