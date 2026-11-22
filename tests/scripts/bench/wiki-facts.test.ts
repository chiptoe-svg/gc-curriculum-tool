import { describe, it, expect } from 'vitest';
import { factualErrors, factualCheck, type PageFacts } from '@/scripts/bench/lib/wiki-facts';

const facts: PageFacts = {
  pageId: 'competencies/problem-solving',
  counts: {
    'open ended problems.present': 11, 'open ended problems.partial': 7, 'open ended problems.absent': 1, 'open ended problems.unassessed': 0,
    'captured courses': 18,
  },
  courseLists: { 'Significant evidence': ['gc-3400', 'gc-3460'] },
  targets: ['brand-strategy', 'account-management'],
};

const table = (p: number, q: number) =>
  `| Condition | Present | Partial | Absent | Not assessed |\n| --- | --- | --- | --- | --- |\n| Open-ended problems | ${p} | ${q} | 1 | 0 |\n`;

describe('factualErrors', () => {
  it('catches "10 of 18" when the facts say 11 of 18 (the 2026-11 problem-solving case, 10/8 vs 11/7)', () => {
    const errs = factualErrors(`Open-ended problems are present in 10 of 18 courses.\n\n${table(10, 8)}`, facts);
    expect(errs.filter(e => e.kind === 'count').length).toBeGreaterThanOrEqual(2);
    expect(errs.some(e => /10 of 18/.test(e.detail))).toBe(true);
    expect(errs.some(e => /open ended problems/i.test(e.detail) && /11/.test(e.detail))).toBe(true);
  });

  it('catches a course missing from a stated course list', () => {
    const errs = factualErrors('- **Significant evidence** (2): [[gc-3400]]\n', facts);
    expect(errs).toEqual([expect.objectContaining({ kind: 'course-list', detail: expect.stringContaining('gc-3460') })]);
  });

  it('catches a course that is not in the facts', () => {
    const errs = factualErrors('- **Significant evidence** (2): [[gc-3400]], [[gc-3460]], [[gc-1010]]\n', facts);
    expect(errs.some(e => e.kind === 'course-list' && e.detail.includes('gc-1010'))).toBe(true);
  });

  it('catches a stale or unknown target', () => {
    const errs = factualErrors('See [[targets/print-operations]] and [[targets/brand-strategy]].', facts);
    expect(errs).toEqual([expect.objectContaining({ kind: 'stale-target', detail: expect.stringContaining('print-operations') })]);
  });

  it('passes a page that matches its facts', () => {
    const md = `18 captured courses carry data; open-ended problems are present in 11 of 18.\n\n- **Significant evidence** (2): [[gc-3400]], [[gc-3460]]\n\n${table(11, 7)}\nSee [[targets/brand-strategy]].`;
    expect(factualErrors(md, facts)).toEqual([]);
  });
});

const real: PageFacts = {
  pageId: 'competencies/problem-solving',
  counts: {
    'generate then consolidate.present': 7, 'generate then consolidate.partial': 11, 'generate then consolidate.absent': 1, 'generate then consolidate.unassessed': 0,
    'open ended problems.present': 11, 'open ended problems.partial': 7, 'open ended problems.absent': 1, 'open ended problems.unassessed': 0,
    'revision cycles.present': 8, 'revision cycles.partial': 7, 'revision cycles.absent': 4, 'revision cycles.unassessed': 0,
    'captured courses': 19,
  },
  courseLists: { 'Significant evidence': ['gc-3400'], 'Moderate evidence': ['gc-1010', 'gc-2070'] },
  targets: ['brand-strategy'],
};

describe('factualErrors ties counts to their group', () => {
  it('a correct "N of M label" passes', () => {
    expect(factualCheck('11 of 19 captured courses carry open-ended problems.', real)).toEqual({ errors: [], unverifiable: [] });
  });
  it('a wrong "X of Y" fails even when X equals another fact', () => {
    // 10 is not an open-ended count, but 8 is (revision cycles present) and 7, 11 are: use 8.
    expect(factualErrors('Open-ended problems are present in 8 of 19 courses.', real).some(e => e.kind === 'count')).toBe(true);
    expect(factualErrors('Open-ended problems are present in 11 of 17 courses.', real).some(e => /17/.test(e.detail))).toBe(true);
    expect(factualErrors('Open-ended problems are present in 11 of 19 courses.', real)).toEqual([]);
  });
  it('an "X of Y" with an unknown group is unverifiable, not passed', () => {
    const r = factualCheck('Students complete 3 of 5 studios.', real);
    expect(r.errors).toEqual([]);
    expect(r.unverifiable).toHaveLength(1);
  });
  it('checks a table row whose name carries a qualifier like "(all)"', () => {
    const md = '| Condition | Present | Partial | Absent | Not assessed |\n| --- | --- | --- | --- | --- |\n| Open-ended problems (all) | 10 | 8 | 1 | 0 |\n';
    expect(factualErrors(md, real).some(e => e.kind === 'count')).toBe(true);
  });
  it('parses a "11 (61%)" cell by its leading number', () => {
    const md = '| Condition | Present | Partial | Absent | Not assessed |\n| --- | --- | --- | --- | --- |\n| Open-ended problems | 11 (58%) | 7 (37%) | 1 | 0 |\n';
    expect(factualErrors(md, real)).toEqual([]);
  });
  it('checks each line that states a course list on its own', () => {
    const md = 'Moderate evidence: [[gc-1010]], [[gc-2070]]\nSee also Moderate evidence in [[gc-3400]].\n';
    const errs = factualErrors(md, real);
    expect(errs.some(e => /Moderate evidence/.test(e.detail) && e.detail.includes('gc-3400'))).toBe(true);
  });
});
