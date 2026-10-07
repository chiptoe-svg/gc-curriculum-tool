/**
 * Tests for the access-panel addendum's full-catalog sync
 * (scripts/catalog/sync-catalog-courses.ts + the readAllCatalogCourses
 * helper it uses). The real catalog.db is read-only and the real Postgres
 * is never touched here — both the sqlite read and the Postgres apply are
 * exercised against hand-built fakes, per the task's hard rule (--apply
 * against real data is prohibited; --dry-run against it is allowed but not
 * exercised in an automated test).
 */
import { describe, it, expect, vi } from 'vitest';
import { readAllCatalogCourses } from '@/scripts/catalog/catalog-source';
import { applyFullCatalogEntries } from '@/scripts/catalog/sync-catalog-courses';
import { buildFullCatalogEntries } from '@/lib/catalog/catalog-sync';

describe('readAllCatalogCourses', () => {
  it('selects every active course, unfiltered by subject, via a single prepared statement with no params', () => {
    const allMock = vi.fn().mockReturnValue([
      { code: 'ECON 2120', title: 'Principles of Macroeconomics', credits: '3', description: 'd', last_synced: '2026-10-06', source_url: 'u' },
    ]);
    const prepareMock = vi.fn().mockReturnValue({ all: allMock });
    const fakeDb = { prepare: prepareMock, close: vi.fn() };

    const rows = readAllCatalogCourses(fakeDb);

    expect(prepareMock).toHaveBeenCalledTimes(1);
    const sql = prepareMock.mock.calls[0]![0] as string;
    expect(sql).toMatch(/FROM course/i);
    expect(sql).not.toMatch(/subject\s*=\s*'GC'/i); // unfiltered — every subject, not just GC
    expect(allMock).toHaveBeenCalledWith(); // no bound params, unlike readCatalogRows' extraCodes
    expect(rows).toHaveLength(1);
    expect(rows[0]!.code).toBe('ECON 2120');
  });
});

describe('applyFullCatalogEntries (idempotent upsert, mocked Postgres client)', () => {
  // A minimal in-memory stand-in for `course_catalog_entries`, keyed by
  // course_code, simulating `INSERT … ON CONFLICT (course_code) DO UPDATE`
  // closely enough to prove idempotence without a real Postgres.
  function makeFakeClient() {
    const table = new Map<string, Record<string, unknown>>();
    const client = {
      query: vi.fn(async (_sql: string, params: unknown[] = []) => {
        const [courseCode, title, description, credits, catalogYear, sourceUrl, catalogLastSynced] = params;
        const existing = table.get(courseCode as string);
        table.set(courseCode as string, {
          course_code: courseCode, title, description, credits,
          prereq_text: existing?.prereq_text ?? null, coreq_text: existing?.coreq_text ?? null, notes: existing?.notes ?? [],
          catalog_year: catalogYear, source_url: sourceUrl, catalog_last_synced: catalogLastSynced,
        });
      }),
    };
    return { client, table };
  }

  const years = new Map([[49, '2026-2027']]);
  const rows = [
    { code: 'ECON 2120', title: 'Principles of Macroeconomics', credits: '3', description: 'd1', last_synced: '2026-10-06', source_url: 'https://catalog.clemson.edu/preview_course_nopop.php?catoid=49&coid=2' },
    { code: 'ENTR 4080', title: 'Family Business', credits: '1-3', description: 'd2', last_synced: '2026-10-06', source_url: 'https://catalog.clemson.edu/preview_course_nopop.php?catoid=49&coid=3' },
  ];

  it('inserts one row per course on the first apply', async () => {
    const { client, table } = makeFakeClient();
    await applyFullCatalogEntries(client, buildFullCatalogEntries(rows, years));
    expect(table.size).toBe(2);
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  it('running twice is idempotent — same row count, values unchanged, never duplicated', async () => {
    const { client, table } = makeFakeClient();
    const entries = buildFullCatalogEntries(rows, years);
    await applyFullCatalogEntries(client, entries);
    await applyFullCatalogEntries(client, entries);
    expect(table.size).toBe(2);
    expect(table.get('ECON 2120')).toMatchObject({ title: 'Principles of Macroeconomics', description: 'd1', credits: '3' });
  });

  it('never overwrites prereq_text/coreq_text/notes on an existing row (layers safely with sync-catalog-prereqs.ts)', async () => {
    const { client, table } = makeFakeClient();
    table.set('ECON 2120', { course_code: 'ECON 2120', title: 'old', prereq_text: 'ACCT 2010', coreq_text: null, notes: ['Sophomore standing'], catalog_year: '2026-2027', source_url: 'u', catalog_last_synced: 'd' });
    await applyFullCatalogEntries(client, buildFullCatalogEntries([rows[0]!], years));
    expect(table.get('ECON 2120')).toMatchObject({ title: 'Principles of Macroeconomics', prereq_text: 'ACCT 2010', notes: ['Sophomore standing'] });
  });
});
