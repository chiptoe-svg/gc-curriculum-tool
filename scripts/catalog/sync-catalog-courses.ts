/**
 * Full-catalog course sync (access-panel addendum, 2026-10-07 — see
 * docs/superpowers/specs/2026-10-07-access-panel-add-course-addendum.md).
 * Sibling to sync-catalog-prereqs.ts rather than an extension of it: this
 * upserts title/description/credits for EVERY course in the clemson-advising
 * catalog.db (~4,085 rows, opened READ-ONLY), not just GC + our tracked
 * courses. Prerequisite text/edges stay sync-catalog-prereqs.ts's job —
 * this sync never writes prereq_text/coreq_text/notes on an existing row,
 * only on first insert (as null/empty), so the two layer safely.
 *
 * IMPORTANT run-order note: sync-catalog-prereqs.ts does an UNSCOPED
 * `DELETE FROM course_catalog_entries` before its scoped re-insert. Running
 * it AFTER this sync would wipe every row this sync added that isn't GC or
 * tracked. Always run this sync AFTER sync-catalog-prereqs.ts (or re-run
 * this one again afterward) — see STATE.md.
 *
 * Usage (from the repo root):
 *   tsx scripts/catalog/sync-catalog-courses.ts            # dry run (default): print counts, write nothing
 *   tsx scripts/catalog/sync-catalog-courses.ts --apply    # write (needs migration 0055 applied)
 *   ... --db /path/to/catalog.db                            # override the catalog DB path
 *
 * Idempotent: `INSERT … ON CONFLICT (course_code) DO UPDATE` — re-running
 * updates existing rows in place, never duplicates, same final row count.
 */
import { Pool } from 'pg';
import { buildFullCatalogEntries, type CatalogEntryInsert } from '@/lib/catalog/catalog-sync';
import { DEFAULT_CATALOG_DB, loadAppEnv, openCatalogReadOnly, readAllCatalogCourses, readCatalogYears, argValue } from './catalog-source';

export interface QueryClient { query(sql: string, params?: unknown[]): Promise<unknown> }

/** One upsert per entry — never touches prereq_text/coreq_text/notes on an
 * existing row, so a prior sync-catalog-prereqs.ts write for a GC/tracked
 * course survives this sync running afterward. */
export async function applyFullCatalogEntries(client: QueryClient, entries: ReadonlyArray<CatalogEntryInsert>): Promise<void> {
  for (const e of entries) {
    await client.query(
      `INSERT INTO course_catalog_entries
         (course_code, title, description, credits, prereq_text, coreq_text, notes, catalog_year, source_url, catalog_last_synced)
       VALUES ($1, $2, $3, $4, NULL, NULL, '[]'::jsonb, $5, $6, $7)
       ON CONFLICT (course_code) DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         credits = EXCLUDED.credits,
         catalog_year = EXCLUDED.catalog_year,
         source_url = EXCLUDED.source_url,
         catalog_last_synced = EXCLUDED.catalog_last_synced,
         synced_at = now()`,
      [e.courseCode, e.title, e.description, e.credits, e.catalogYear, e.sourceUrl, e.catalogLastSynced],
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
    const cat = openCatalogReadOnly(dbPath);
    const rows = readAllCatalogCourses(cat);
    const years = readCatalogYears(cat);
    cat.close();

    const entries = buildFullCatalogEntries(rows, years);
    console.log(`catalog DB: ${dbPath} (read-only)`);
    console.log(`courses read: ${entries.length}`);
    console.log(`with a title: ${entries.filter(e => e.title).length}`);
    console.log(`with a description: ${entries.filter(e => e.description).length}`);
    console.log(`with credits: ${entries.filter(e => e.credits).length}`);

    if (!apply) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply to write (migration 0055 must be applied first).');
      return;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await applyFullCatalogEntries(client, entries);
      await client.query('COMMIT');
      console.log(`\nAPPLIED: upserted ${entries.length} rows.`);
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
