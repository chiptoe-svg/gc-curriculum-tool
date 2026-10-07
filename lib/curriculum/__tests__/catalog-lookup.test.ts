/**
 * Tests for lib/curriculum/catalog-lookup.ts (access-panel addendum,
 * 2026-10-07 — "Add a course from the Clemson catalog"). DB mock follows
 * the same select().from().where().limit(n) convention as grant-admin.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let selectResult: unknown[] = [];
let selectWhereArg: unknown = null;

function selectChain(result: unknown[]) {
  const chain = {
    from: () => chain,
    where: (arg: unknown) => { selectWhereArg = arg; return chain; },
    limit: (_n: number) => Promise.resolve(result),
  };
  return chain;
}

vi.mock('@/lib/db/client', () => ({ db: { select: () => selectChain(selectResult) } }));

import { lookupCatalogCourse, validateCourseTitle, levelFromCode, baseCodeOf } from '@/lib/curriculum/catalog-lookup';

beforeEach(() => { vi.clearAllMocks(); selectResult = []; selectWhereArg = null; });

describe('lookupCatalogCourse', () => {
  it('returns null when the catalog has no row for the code', async () => {
    selectResult = [];
    expect(await lookupCatalogCourse('ECON 2120')).toBeNull();
  });

  it('returns code/title/description/credits, normalizing the input code', async () => {
    selectResult = [{ courseCode: 'ECON 2120', title: 'Principles of Macroeconomics', description: 'd', credits: '3' }];
    const r = await lookupCatalogCourse('econ%202120');
    expect(r).toEqual({ code: 'ECON 2120', title: 'Principles of Macroeconomics', description: 'd', credits: '3' });
    expect(selectWhereArg).not.toBeNull();
  });
});

describe('validateCourseTitle', () => {
  it('trims and accepts 1-120 chars', () => {
    expect(validateCourseTitle('  Family Business  ')).toEqual({ title: 'Family Business' });
  });
  it('rejects empty, non-string, over-120, and control characters', () => {
    expect(validateCourseTitle('')).toHaveProperty('error');
    expect(validateCourseTitle(42)).toHaveProperty('error');
    expect(validateCourseTitle('x'.repeat(121))).toHaveProperty('error');
    expect(validateCourseTitle('A\u0000B')).toHaveProperty('error');
  });
});

describe('levelFromCode', () => {
  it('is the first digit of the course number', () => {
    expect(levelFromCode('ENTR 4080')).toBe(4);
    expect(levelFromCode('ECON 2120')).toBe(2);
    expect(levelFromCode('GC 1010')).toBe(1);
    expect(levelFromCode('GC 4900ap')).toBe(4);
  });
  it('is null when there is no parseable number', () => {
    expect(levelFromCode('nonsense')).toBeNull();
  });
});

describe('baseCodeOf', () => {
  it('strips a section suffix', () => {
    expect(baseCodeOf('GC 4900ap')).toBe('GC 4900');
    expect(baseCodeOf('GC 4990ta')).toBe('GC 4990');
  });
  it('returns null when there is no suffix to strip, or no number', () => {
    expect(baseCodeOf('GC 4900')).toBeNull();
    expect(baseCodeOf('nonsense')).toBeNull();
  });
});
