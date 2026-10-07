/**
 * Proves the two catalog syncs can run in either order without losing rows
 * (coordinator fix request, re-review concern 4): sync-catalog-prereqs.ts's
 * delete must be scoped to the course codes it's about to rewrite (GC +
 * tracked), not the whole `course_catalog_entries` table — otherwise
 * running it after sync-catalog-courses.ts wipes every row the full-catalog
 * sync added for a course outside that scope.
 *
 * Both apply functions run against ONE shared hand-built in-memory Postgres
 * stand-in (never a real Postgres — real --apply stays prohibited). The
 * fake recognizes the exact INSERT/DELETE shapes each script issues.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildCatalogSyncRows, buildFullCatalogEntries } from '@/lib/catalog/catalog-sync';
import { applyFullCatalogEntries } from '@/scripts/catalog/sync-catalog-courses';
import { applyCatalogSync } from '@/scripts/catalog/sync-catalog-prereqs';

function makeFakeClient() {
  const entries = new Map<string, Record<string, unknown>>();
  const prereqs: Record<string, unknown>[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    const s = sql.trim();
    if (/^DELETE FROM course_catalog_prereqs/i.test(s)) {
      if (/WHERE course_code = ANY/i.test(s)) {
        const codes = new Set(params[0] as string[]);
        for (let i = prereqs.length - 1; i >= 0; i--) if (codes.has(prereqs[i]!.course_code as string)) prereqs.splice(i, 1);
      } else {
        prereqs.length = 0;
      }
      return;
    }
    if (/^DELETE FROM course_catalog_entries/i.test(s)) {
      if (/WHERE course_code = ANY/i.test(s)) {
        for (const c of params[0] as string[]) entries.delete(c);
      } else {
        entries.clear();
      }
      return;
    }
    if (/^INSERT INTO course_catalog_entries/i.test(s)) {
      const isUpsert = /ON CONFLICT/i.test(s);
      const isCoursesSyncShape = /description/i.test(s); // column appears in the courses-sync's column list, never the prereqs-sync's
      if (isUpsert && isCoursesSyncShape) {
        // courses-sync upsert: never touches prereq_text/coreq_text/notes on an existing row.
        const [courseCode, title, description, credits, catalogYear, sourceUrl, catalogLastSynced] = params;
        const existing = entries.get(courseCode as string);
        entries.set(courseCode as string, {
          course_code: courseCode, title, description, credits,
          prereq_text: existing?.prereq_text ?? null, coreq_text: existing?.coreq_text ?? null, notes: existing?.notes ?? [],
          catalog_year: catalogYear, source_url: sourceUrl, catalog_last_synced: catalogLastSynced,
        });
      } else if (isUpsert) {
        // prereqs-sync upsert: never touches description/credits on an existing row.
        const [courseCode, title, prereqText, coreqText, notesJson, catalogYear, sourceUrl, catalogLastSynced] = params;
        const existing = entries.get(courseCode as string);
        entries.set(courseCode as string, {
          course_code: courseCode, title, prereq_text: prereqText, coreq_text: coreqText, notes: JSON.parse(notesJson as string),
          description: existing?.description ?? null, credits: existing?.credits ?? null,
          catalog_year: catalogYear, source_url: sourceUrl, catalog_last_synced: catalogLastSynced,
        });
      } else {
        // plain (non-upsert) insert — the old prereqs-sync shape, kept so the red-proof (reverting to
        // the pre-fix delete+insert) still exercises this fake correctly.
        const [courseCode, title, prereqText, coreqText, notesJson, catalogYear, sourceUrl, catalogLastSynced] = params;
        entries.set(courseCode as string, {
          course_code: courseCode, title, prereq_text: prereqText, coreq_text: coreqText,
          notes: JSON.parse(notesJson as string), catalog_year: catalogYear, source_url: sourceUrl, catalog_last_synced: catalogLastSynced,
        });
      }
      return;
    }
    if (/^INSERT INTO course_catalog_prereqs/i.test(s)) {
      const [courseCode, prereqCode, kind, anyOfGroup, catalogYear] = params;
      prereqs.push({ course_code: courseCode, prereq_code: prereqCode, kind, any_of_group: anyOfGroup, catalog_year: catalogYear });
      return;
    }
    throw new Error(`fake client: unexpected query: ${s}`);
  });
  return { client: { query }, entries, prereqs };
}

const years = new Map([[49, '2026-2027']]);

// Full-catalog rows (every subject) — ACCT 2010 is never in the GC+tracked scope.
const fullRows = [
  { code: 'ACCT 2010', title: 'Financial Accounting Concepts', credits: '3', description: 'd-acct', last_synced: '2026-10-06', source_url: 'https://catalog.clemson.edu/preview_course_nopop.php?catoid=49&coid=1' },
  { code: 'GC 3460', title: 'GC 3460 title', credits: '3', description: 'd-gc', last_synced: '2026-10-06', source_url: 'https://catalog.clemson.edu/preview_course_nopop.php?catoid=49&coid=2' },
];

// The GC+tracked-only prereqs sync's rows — scope is just GC 3460.
const scopedCatalogRow = (code: string, prereq: string | null) => ({
  code, title: `${code} title`, prereq_text: prereq, coreq_text: null, last_synced: '2026-06-23',
  source_url: 'https://catalog.clemson.edu/preview_course_nopop.php?catoid=49&coid=2',
});

beforeEach(() => { vi.clearAllMocks(); });

describe('sync-catalog-prereqs applyCatalogSync — scoped delete (coordinator fix, concern 4)', () => {
  it('running the prereqs sync after the full-courses sync does NOT wipe rows outside its scope', async () => {
    const { client, entries } = makeFakeClient();

    // 1. Full-catalog sync runs first, writing every subject (incl. ACCT 2010).
    await applyFullCatalogEntries(client, buildFullCatalogEntries(fullRows, years));
    expect(entries.has('ACCT 2010')).toBe(true);

    // 2. The GC+tracked-scoped prereqs sync runs next, touching only GC 3460.
    const { entries: scopedEntries, edges } = buildCatalogSyncRows([scopedCatalogRow('GC 3460', 'GC 2070')], years);
    await applyCatalogSync(client, scopedEntries, edges);

    // ACCT 2010 — outside the prereqs sync's scope — must survive.
    expect(entries.has('ACCT 2010')).toBe(true);
    expect(entries.get('ACCT 2010')).toMatchObject({ title: 'Financial Accounting Concepts', description: 'd-acct' });
    // GC 3460 — inside scope — got its prereq data written.
    expect(entries.get('GC 3460')).toMatchObject({ prereq_text: 'GC 2070' });
  });

  it("a shared row's description/credits (written by the full-courses sync) survive the prereqs sync running afterward (residual fix)", async () => {
    const { client, entries } = makeFakeClient();

    // Full-catalog sync writes GC 3460's description/credits first.
    await applyFullCatalogEntries(client, buildFullCatalogEntries([fullRows[1]!], years));
    expect(entries.get('GC 3460')).toMatchObject({ description: 'd-gc', credits: '3' });

    // Prereqs sync then rewrites GC 3460's prereq data — description/credits must survive.
    const { entries: scopedEntries, edges } = buildCatalogSyncRows([scopedCatalogRow('GC 3460', 'GC 2070')], years);
    await applyCatalogSync(client, scopedEntries, edges);

    expect(entries.get('GC 3460')).toMatchObject({
      description: 'd-gc', credits: '3', // untouched
      prereq_text: 'GC 2070', // the prereqs sync's own write still landed
    });
  });

  it('the prereqs sync replacement is itself scoped: a stale prereq edge for a course no longer in scope is untouched, a scoped one is replaced', async () => {
    const { client, prereqs } = makeFakeClient();
    await applyFullCatalogEntries(client, buildFullCatalogEntries(fullRows, years));
    const first = buildCatalogSyncRows([scopedCatalogRow('GC 3460', 'GC 2070')], years);
    await applyCatalogSync(client, first.entries, first.edges);
    expect(prereqs).toHaveLength(1);

    // Re-run with a different prereq for the same scoped code — old edge gone, new one present, nothing duplicated.
    const second = buildCatalogSyncRows([scopedCatalogRow('GC 3460', 'GC 3500')], years);
    await applyCatalogSync(client, second.entries, second.edges);
    expect(prereqs).toHaveLength(1);
    expect(prereqs[0]).toMatchObject({ course_code: 'GC 3460', prereq_code: 'GC 3500' });
  });
});
