import { describe, it, expect } from 'vitest';
import { buildCatalogSyncRows, buildFullCatalogEntries, catalogYearOf, formatCatalogPrereqs } from '@/lib/catalog/catalog-sync';

const years = new Map([[49, '2026-2027'], [46, '2025-2026']]);
const row = (code: string, prereq: string | null, coreq: string | null = null) => ({
  code, title: `${code} title`, prereq_text: prereq, coreq_text: coreq, last_synced: '2026-06-23',
  source_url: 'https://catalog.clemson.edu/preview_course_nopop.php?catoid=49&coid=1',
});

describe('catalogYearOf', () => {
  it('reads the catalog year from the source URL catoid', () => {
    expect(catalogYearOf(row('GC 3460', null).source_url, years)).toBe('2026-2027');
    expect(catalogYearOf(null, years)).toBe('unknown');
  });
});

describe('buildCatalogSyncRows', () => {
  const out = buildCatalogSyncRows([
    row('GC 3460', 'GC 2070', 'GC 3461'),
    row('GC 4060', 'GC 2070 and GC 3500. Preq or concurrent enrollment: GC 3460', 'GC 4061'),
    row('GC 3700', 'Sophomore standing', 'GC 3701'),
  ], years);
  it('writes one entry per course, with non-course notes', () => {
    expect(out.entries.map(e => e.courseCode)).toEqual(['GC 3460', 'GC 4060', 'GC 3700']);
    expect(out.entries[2]).toMatchObject({ courseCode: 'GC 3700', notes: ['Sophomore standing'], catalogYear: '2026-2027' });
  });
  it('writes prereq, concurrent_ok and coreq edges', () => {
    expect(out.edges.filter(e => e.courseCode === 'GC 4060').map(e => `${e.prereqCode}:${e.kind}`))
      .toEqual(['GC 2070:prereq', 'GC 3500:prereq', 'GC 3460:concurrent_ok', 'GC 4061:coreq']);
    expect(out.edges.filter(e => e.courseCode === 'GC 3460').map(e => `${e.prereqCode}:${e.kind}`))
      .toEqual(['GC 2070:prereq', 'GC 3461:coreq']);
  });
});

describe('buildFullCatalogEntries (access-panel addendum, 2026-10-07)', () => {
  const fullRow = (code: string, title: string | null, credits: string | null, description: string | null) => ({
    code, title, credits, description, last_synced: '2026-10-06',
    source_url: 'https://catalog.clemson.edu/preview_course_nopop.php?catoid=49&coid=2',
  });
  it('maps every row to an entry carrying title/description/credits, with prereq/coreq/notes left empty', () => {
    const out = buildFullCatalogEntries([
      fullRow('ECON 2120', 'Principles of Macroeconomics', '3', 'Continuation of ECON 2110…'),
      fullRow('ENTR 4080', 'Family Business', '1-3', 'Study of family-owned enterprise.'),
    ], years);
    expect(out).toEqual([
      { courseCode: 'ECON 2120', title: 'Principles of Macroeconomics', description: 'Continuation of ECON 2110…', credits: '3', prereqText: null, coreqText: null, notes: [], catalogYear: '2026-2027', sourceUrl: fullRow('x', null, null, null).source_url, catalogLastSynced: '2026-10-06' },
      { courseCode: 'ENTR 4080', title: 'Family Business', description: 'Study of family-owned enterprise.', credits: '1-3', prereqText: null, coreqText: null, notes: [], catalogYear: '2026-2027', sourceUrl: fullRow('x', null, null, null).source_url, catalogLastSynced: '2026-10-06' },
    ]);
  });
  it('is a pure 1:1 map — same row count in and out, every code preserved (idempotence precondition)', () => {
    const rows = [fullRow('A 100', 't', '3', 'd'), fullRow('B 200', 't2', '3', 'd2'), fullRow('C 300', null, null, null)];
    const out = buildFullCatalogEntries(rows, years);
    expect(out).toHaveLength(3);
    expect(out.map(e => e.courseCode)).toEqual(['A 100', 'B 200', 'C 300']);
  });
});

describe('formatCatalogPrereqs', () => {
  it('renders groups and concurrent marks compactly', () => {
    expect(formatCatalogPrereqs([
      { code: 'GC 3500', kind: 'prereq', anyOfGroup: null },
      { code: 'GC 4060', kind: 'prereq', anyOfGroup: 1 },
      { code: 'GC 4400', kind: 'prereq', anyOfGroup: 1 },
      { code: 'COOP 2020', kind: 'concurrent_ok', anyOfGroup: null },
    ])).toBe('GC 3500, (GC 4060 | GC 4400), COOP 2020 (or concurrent)');
  });
});
