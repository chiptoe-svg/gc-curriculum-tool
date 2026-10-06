import { describe, it, expect } from 'vitest';
import { parseCatalogPrereqs, parseCatalogCoreqs } from '@/lib/catalog/catalog-prereq-parser';

describe('parseCatalogPrereqs', () => {
  it('reads a single course prerequisite', () => {
    expect(parseCatalogPrereqs('GC 2070')).toEqual({
      edges: [{ code: 'GC 2070', kind: 'prereq', anyOfGroup: null }],
      notes: [],
    });
  });
  it('splits "and", keeping non-course conditions as notes, not edges', () => {
    expect(parseCatalogPrereqs('Graphic Communications major and GC 1010 and GC 1020 and GC 1040')).toEqual({
      edges: [
        { code: 'GC 1010', kind: 'prereq', anyOfGroup: null },
        { code: 'GC 1020', kind: 'prereq', anyOfGroup: null },
        { code: 'GC 1040', kind: 'prereq', anyOfGroup: null },
      ],
      notes: ['Graphic Communications major'],
    });
  });
  it('marks "Preq or concurrent enrollment:" courses as concurrent_ok', () => {
    expect(parseCatalogPrereqs('GC 2070 and GC 3500. Preq or concurrent enrollment: GC 3460')).toEqual({
      edges: [
        { code: 'GC 2070', kind: 'prereq', anyOfGroup: null },
        { code: 'GC 3500', kind: 'prereq', anyOfGroup: null },
        { code: 'GC 3460', kind: 'concurrent_ok', anyOfGroup: null },
      ],
      notes: [],
    });
  });
  it('groups "either A or B" alternatives under one any-of group', () => {
    expect(parseCatalogPrereqs('GC 3500; and either GC 4060 or GC 4400. Preq or concurrent enrollment: COOP 2020')).toEqual({
      edges: [
        { code: 'GC 3500', kind: 'prereq', anyOfGroup: null },
        { code: 'GC 4060', kind: 'prereq', anyOfGroup: 1 },
        { code: 'GC 4400', kind: 'prereq', anyOfGroup: 1 },
        { code: 'COOP 2020', kind: 'concurrent_ok', anyOfGroup: null },
      ],
      notes: [],
    });
  });
  it('keeps a non-course alternative as a note alongside the group', () => {
    const r = parseCatalogPrereqs('ECON 2000 or ECON 2110 or ECON 2120 or any 2000-level AGRB course; and sophomore standing');
    expect(r.edges).toEqual([
      { code: 'ECON 2000', kind: 'prereq', anyOfGroup: 1 },
      { code: 'ECON 2110', kind: 'prereq', anyOfGroup: 1 },
      { code: 'ECON 2120', kind: 'prereq', anyOfGroup: 1 },
    ]);
    expect(r.notes).toEqual(['one of: ECON 2000 or ECON 2110 or ECON 2120 or any 2000-level AGRB course', 'sophomore standing']);
  });
  it('does not split "C or better" grade qualifiers into alternatives', () => {
    const r = parseCatalogPrereqs('MATH 3020 with a C or better or STAT 2300 with a C or better');
    expect(r.edges).toEqual([
      { code: 'MATH 3020', kind: 'prereq', anyOfGroup: 1 },
      { code: 'STAT 2300', kind: 'prereq', anyOfGroup: 1 },
    ]);
    expect(r.notes).toEqual([]);
  });
  it('restores grade qualifiers in notes', () => {
    expect(parseCatalogPrereqs('MATH 1020 with a C or higher or a score of 620 or higher on the SAT Math section').notes)
      .toEqual(['one of: MATH 1020 with a C or higher or a score of 620 or higher on the SAT Math section']);
  });
  it('dedupes a repeated "Preq:" restatement', () => {
    expect(parseCatalogPrereqs('GC 3700. Preq: GC 3700').edges).toEqual([{ code: 'GC 3700', kind: 'prereq', anyOfGroup: null }]);
  });
  it('treats a text with no course codes as notes only', () => {
    expect(parseCatalogPrereqs('Sophomore standing')).toEqual({ edges: [], notes: ['Sophomore standing'] });
    expect(parseCatalogPrereqs('Junior standing and acceptance of written proposal by and consent of advisor').edges).toEqual([]);
  });
  it('keeps a course code with a trailing condition as an edge plus a note', () => {
    expect(parseCatalogPrereqs('GC 1040 and Graphic Communications major and consent of instructor. Preq or concurrent enrollment: COOP 2010')).toEqual({
      edges: [
        { code: 'GC 1040', kind: 'prereq', anyOfGroup: null },
        { code: 'COOP 2010', kind: 'concurrent_ok', anyOfGroup: null },
      ],
      notes: ['Graphic Communications major', 'consent of instructor'],
    });
  });
  it('handles empty / null input', () => {
    expect(parseCatalogPrereqs(null)).toEqual({ edges: [], notes: [] });
    expect(parseCatalogPrereqs('')).toEqual({ edges: [], notes: [] });
  });
});

describe('parseCatalogCoreqs', () => {
  it('reads lab corequisites as kind coreq, never prereq', () => {
    expect(parseCatalogCoreqs('GC 3461')).toEqual([{ code: 'GC 3461', kind: 'coreq', anyOfGroup: null }]);
    expect(parseCatalogCoreqs(null)).toEqual([]);
  });
});
