import { describe, it, expect, vi, beforeEach } from 'vitest';
import { courses as coursesTable, courseCatalogEntries, courseCatalogPrereqs } from '@/lib/db/schema';

const state = vi.hoisted(() => ({
  courses: [] as Array<{ code: string; prerequisites: string }>,
  entries: [] as unknown[] | Error,
  edges: [] as unknown[] | Error,
}));
vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({
      from: async (t: unknown) => {
        const r = t === coursesTable ? state.courses : t === courseCatalogEntries ? state.entries : t === courseCatalogPrereqs ? state.edges : [];
        if (r instanceof Error) throw r;
        return r;
      },
    }),
  },
}));

import { buildPrereqMap, loadPrereqMap, prereqEdgesOf, dependentEdgesOf, prereqSourceLabel, prereqCodesFor } from '@/lib/curriculum/prereq-map';
import { prereqsOf, dependentsOf } from '@/lib/curriculum/sheet-prereq-graph';

const sheet = [
  { code: 'GC 1040', prerequisites: '' },
  { code: 'GC 2070', prerequisites: 'GC 1040' },
  { code: 'GC 3460', prerequisites: 'GC 1040' },            // sheet is wrong: catalog says GC 2070
  { code: 'GC 3500', prerequisites: '' },
  { code: 'GC 3700', prerequisites: 'Sophomore standing' },
  { code: 'GC 4060', prerequisites: 'GC 3460' },
  { code: 'GC 4900ap', prerequisites: 'GC 3460' },           // no catalog row -> sheet fallback
];
const entries = ['GC 1040', 'GC 2070', 'GC 3460', 'GC 3500', 'GC 3700', 'GC 4060'].map(c => ({ courseCode: c, catalogYear: '2026-2027' }));
const catalogEdges = [
  { courseCode: 'GC 2070', prereqCode: 'GC 1040', kind: 'prereq', anyOfGroup: null, catalogYear: '2026-2027' },
  { courseCode: 'GC 3460', prereqCode: 'GC 2070', kind: 'prereq', anyOfGroup: null, catalogYear: '2026-2027' },
  { courseCode: 'GC 3460', prereqCode: 'GC 3461', kind: 'coreq', anyOfGroup: null, catalogYear: '2026-2027' },
  { courseCode: 'GC 4060', prereqCode: 'GC 2070', kind: 'prereq', anyOfGroup: null, catalogYear: '2026-2027' },
  { courseCode: 'GC 4060', prereqCode: 'GC 3500', kind: 'prereq', anyOfGroup: null, catalogYear: '2026-2027' },
  { courseCode: 'GC 4060', prereqCode: 'GC 3460', kind: 'concurrent_ok', anyOfGroup: null, catalogYear: '2026-2027' },
  { courseCode: 'GC 3500', prereqCode: 'COOP 2010', kind: 'concurrent_ok', anyOfGroup: null, catalogYear: '2026-2027' },
] as const;

describe('buildPrereqMap precedence', () => {
  const map = buildPrereqMap({ courses: sheet, catalogEntries: entries, catalogEdges: [...catalogEdges] });
  it('uses catalog edges over the sheet for a course with a catalog row', () => {
    expect(prereqsOf(map.edges, 'GC 3460')).toEqual(['GC 2070']);
    expect(prereqEdgesOf(map, 'GC 3460')).toEqual([{ focal: 'GC 3460', prereq: 'GC 2070', kind: 'prereq', source: 'catalog', anyOfGroup: null }]);
  });
  it('keeps "before or alongside" as concurrent_ok and drops lab corequisites', () => {
    expect(prereqEdgesOf(map, 'GC 4060').map(e => `${e.prereq}:${e.kind}`)).toEqual(['GC 2070:prereq', 'GC 3460:concurrent_ok', 'GC 3500:prereq']);
    expect(map.edges.some(e => e.prereq === 'GC 3461')).toBe(false);
  });
  it('does not fall back to the sheet when the catalog row lists no course prerequisites', () => {
    expect(prereqsOf(map.edges, 'GC 3700')).toEqual([]);
    expect(prereqsOf(map.edges, 'GC 1040')).toEqual([]);
  });
  it('falls back to the sheet for a course with no catalog row, labelled as such', () => {
    expect(prereqEdgesOf(map, 'GC 4900ap')).toEqual([{ focal: 'GC 4900ap', prereq: 'GC 3460', kind: 'prereq', source: 'sheet', anyOfGroup: null }]);
  });
  it('only links courses the program tracks', () => {
    expect(prereqsOf(map.edges, 'GC 3500')).toEqual([]);   // COOP 2010 is not in courses
  });
  it('derives dependents across both sources', () => {
    expect(dependentsOf(map.edges, 'GC 3460')).toEqual(['GC 4060', 'GC 4900ap']);
    expect(dependentEdgesOf(map, 'GC 2070').map(e => e.focal)).toEqual(['GC 3460', 'GC 4060']);
  });
  it('labels the source per edge', () => {
    expect(map.catalogYear).toBe('2026-2027');
    expect(prereqSourceLabel(map, 'catalog')).toBe('Clemson catalog 2026–27');
    expect(prereqSourceLabel(map, 'sheet')).toBe('course sheet');
  });
});

describe('loadPrereqMap', () => {
  beforeEach(() => {
    state.courses = sheet;
    state.entries = entries;
    state.edges = [...catalogEdges];
  });
  it('reads the catalog tables when present', async () => {
    const map = await loadPrereqMap();
    expect(prereqsOf(map.edges, 'GC 3460')).toEqual(['GC 2070']);
    expect(await prereqCodesFor('GC 4060')).toEqual(['GC 2070', 'GC 3460', 'GC 3500']);
  });
  it('falls back to the sheet for every course when the catalog tables do not exist yet (migration 0053 unapplied)', async () => {
    const missing = Object.assign(new Error('Failed query'), { cause: Object.assign(new Error('relation "course_catalog_entries" does not exist'), { code: '42P01' }) });
    state.entries = missing;
    state.edges = missing;
    const map = await loadPrereqMap();
    expect(map.catalogYear).toBeNull();
    expect(prereqEdgesOf(map, 'GC 3460')).toEqual([{ focal: 'GC 3460', prereq: 'GC 1040', kind: 'prereq', source: 'sheet', anyOfGroup: null }]);
  });
  it('does not swallow other database errors', async () => {
    state.entries = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
    await expect(loadPrereqMap()).rejects.toThrow('connection refused');
  });
});
