import { describe, it, expect } from 'vitest';
import { factualErrors, type PageFacts } from '@/scripts/bench/lib/wiki-facts';

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
