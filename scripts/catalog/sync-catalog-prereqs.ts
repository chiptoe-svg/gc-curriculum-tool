/**
 * Copy Clemson catalog prerequisites from the clemson-advising project's
 * catalog.db (opened READ-ONLY) into our Postgres tables
 * course_catalog_entries + course_catalog_prereqs (migration 0053).
 *
 * Scope: every active GC course in the catalog, plus the non-GC courses our
 * `courses` table holds (when the catalog has them). SCOPED to that set of
 * course codes (2026-10-07 fix, then hardened further the same day):
 *   - `course_catalog_prereqs` edges are still a scoped delete-then-insert
 *     (`WHERE course_code = ANY(<codes this run is about to rewrite>)`) —
 *     there is nothing on an edge row worth preserving across a re-sync.
 *   - `course_catalog_entries` is an UPSERT (`ON CONFLICT (course_code) DO
 *     UPDATE`), not a delete-then-insert, and only ever SETs the columns
 *     this sync owns (title, prereq_text, coreq_text, notes, catalog_year,
 *     source_url, catalog_last_synced, synced_at) — never `description`/
 *     `credits`, which scripts/catalog/sync-catalog-courses.ts owns. The two
 *     syncs can therefore run in either order without either one resetting
 *     the other's columns on a row they both touch (e.g. any GC course), or
 *     losing a row outside its own scope — see applyCatalogSync below and
 *     tests/catalog/sync-order-independence.test.ts.
 *
 * Usage (from the repo root):
 *   tsx scripts/catalog/sync-catalog-prereqs.ts            # dry run (default): print, write nothing
 *   tsx scripts/catalog/sync-catalog-prereqs.ts --apply    # write (needs migration 0053 applied)
 *   ... --db /path/to/catalog.db                            # override the catalog DB path
 *
 * Re-sync is manual for now: run after the advising project re-ingests the catalog.
 */
import { Pool } from 'pg';
import { buildCatalogSyncRows, formatCatalogPrereqs, type CatalogEntryInsert, type CatalogEdgeInsert } from '@/lib/catalog/catalog-sync';
import { DEFAULT_CATALOG_DB, loadAppEnv, openCatalogReadOnly, readCatalogRows, readCatalogYears, argValue } from './catalog-source';

export interface QueryClient { query(sql: string, params?: unknown[]): Promise<unknown> }

/**
 * Replaces edges for exactly the course codes in `entries` (edges have
 * nothing worth preserving across a re-sync, so a scoped delete-then-insert
 * is fine there), and UPSERTs entries — never deletes them. The upsert only
 * SETs the columns this sync owns, so a row sync-catalog-courses.ts also
 * wrote (any GC course, since GC is always in this sync's scope) keeps its
 * `description`/`credits` regardless of which sync ran more recently.
 * `edges` is always a subset of `entries`' codes (buildCatalogSyncRows only
 * ever produces an edge whose `courseCode` is one of `entries`' codes), so
 * scoping the edges delete to `entries`' codes is correct.
 */
export async function applyCatalogSync(
  client: QueryClient,
  entries: ReadonlyArray<CatalogEntryInsert>,
  edges: ReadonlyArray<CatalogEdgeInsert>,
): Promise<void> {
  const codes = entries.map((e) => e.courseCode);
  await client.query('DELETE FROM course_catalog_prereqs WHERE course_code = ANY($1)', [codes]);
  for (const e of entries) {
    await client.query(
      `INSERT INTO course_catalog_entries (course_code, title, prereq_text, coreq_text, notes, catalog_year, source_url, catalog_last_synced)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
       ON CONFLICT (course_code) DO UPDATE SET
         title = EXCLUDED.title,
         prereq_text = EXCLUDED.prereq_text,
         coreq_text = EXCLUDED.coreq_text,
         notes = EXCLUDED.notes,
         catalog_year = EXCLUDED.catalog_year,
         source_url = EXCLUDED.source_url,
         catalog_last_synced = EXCLUDED.catalog_last_synced,
         synced_at = now()`,
      [e.courseCode, e.title, e.prereqText, e.coreqText, JSON.stringify(e.notes), e.catalogYear, e.sourceUrl, e.catalogLastSynced],
    );
  }
  for (const x of edges) {
    await client.query(
      `INSERT INTO course_catalog_prereqs (course_code, prereq_code, kind, any_of_group, catalog_year)
       VALUES ($1, $2, $3, $4, $5)`,
      [x.courseCode, x.prereqCode, x.kind, x.anyOfGroup, x.catalogYear],
    );
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  const dbPath = argValue('--db') ?? DEFAULT_CATALOG_DB;
  loadAppEnv();
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error('DATABASE_URL not set (.env.local)');
  const pool = new Pool({ connectionString: url });

  try {
    const ours = (await pool.query<{ code: string }>('SELECT code FROM courses ORDER BY code')).rows.map(r => r.code);
    const extra = ours.filter(c => !c.startsWith('GC '));
    const cat = openCatalogReadOnly(dbPath);
    const rows = readCatalogRows(cat, extra);
    const years = readCatalogYears(cat);
    cat.close();

    const { entries, edges } = buildCatalogSyncRows(rows, years);
    const yearCounts = new Map<string, number>();
    for (const e of entries) yearCounts.set(e.catalogYear, (yearCounts.get(e.catalogYear) ?? 0) + 1);
    const kindCounts = new Map<string, number>();
    for (const e of edges) kindCounts.set(e.kind, (kindCounts.get(e.kind) ?? 0) + 1);
    const tracked = new Set(ours);

    console.log(`catalog DB: ${dbPath} (read-only)`);
    console.log(`catalog year(s): ${[...yearCounts].map(([y, n]) => `${y} ×${n}`).join(', ')}`);
    console.log(`entries: ${entries.length} (${entries.filter(e => e.courseCode.startsWith('GC ')).length} GC, ${entries.filter(e => !e.courseCode.startsWith('GC ')).length} non-GC)`);
    console.log(`  of which tracked in our courses table: ${entries.filter(e => tracked.has(e.courseCode)).length}`);
    console.log(`edges: ${edges.length} (${[...kindCounts].map(([k, n]) => `${k} ${n}`).join(', ')})`);
    console.log(`tracked courses with no catalog row (sheet fallback): ${ours.filter(c => !entries.some(e => e.courseCode === c)).join(', ') || '(none)'}`);
    console.log('');
    for (const e of entries) {
      const own = edges.filter(x => x.courseCode === e.courseCode);
      const pre = formatCatalogPrereqs(own.map(x => ({ code: x.prereqCode, kind: x.kind, anyOfGroup: x.anyOfGroup })));
      const co = own.filter(x => x.kind === 'coreq').map(x => x.prereqCode).join(', ');
      const bits = [pre && `prereq: ${pre}`, co && `coreq: ${co}`, e.notes.length > 0 && `notes: ${e.notes.join('; ')}`].filter(Boolean);
      console.log(`${tracked.has(e.courseCode) ? '*' : ' '} ${e.courseCode.padEnd(10)} ${bits.join(' | ') || '(no prerequisites)'}`);
    }
    console.log('\n* = in our courses table');

    if (!apply) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply to write (migration 0053 must be applied first).');
      return;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await applyCatalogSync(client, entries, edges);
      await client.query('COMMIT');
      console.log(`\nAPPLIED: ${entries.length} entries, ${edges.length} edges.`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err); process.exit(1); });
}
