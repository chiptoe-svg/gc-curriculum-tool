/**
 * READ-ONLY report: the GC course sheet's prerequisite line vs the Clemson
 * catalog, per course in our `courses` table — so the owner can fix the sheet.
 * Reads our Postgres (courses.prerequisites) and the clemson-advising
 * catalog.db directly (read-only), so it works before migration 0053 / a sync.
 *
 * Usage (from the repo root):
 *   tsx scripts/catalog/prereq-discrepancies.ts [--db /path/to/catalog.db] [--all]
 *   --all  include non-GC courses (default: GC courses only)
 */
import { Pool } from 'pg';
import { catalogEdgesOf, catalogYearOf, formatCatalogPrereqs } from '@/lib/catalog/catalog-sync';
import { DEFAULT_CATALOG_DB, loadAppEnv, openCatalogReadOnly, readCatalogRows, readCatalogYears, argValue } from './catalog-source';

const CODE_RE = /\b([A-Z]{2,4})\s*(\d{4})\b/gi;
const sheetCodes = (text: string, self: string) =>
  [...new Set([...text.matchAll(CODE_RE)].map(m => `${m[1]!.toUpperCase()} ${m[2]}`))].filter(c => c !== self.toUpperCase());

async function main() {
  const dbPath = argValue('--db') ?? DEFAULT_CATALOG_DB;
  const all = process.argv.includes('--all');
  loadAppEnv();
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error('DATABASE_URL not set (.env.local)');
  const pool = new Pool({ connectionString: url });
  let ours: Array<{ code: string; prerequisites: string }>;
  try {
    const client = await pool.connect();
    try {
      await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
      ours = (await client.query<{ code: string; prerequisites: string }>('SELECT code, prerequisites FROM courses ORDER BY code')).rows;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
  const scope = ours.filter(c => all || c.code.startsWith('GC '));

  const cat = openCatalogReadOnly(dbPath);
  const rows = readCatalogRows(cat, ours.map(c => c.code).filter(c => !c.startsWith('GC ')));
  const years = readCatalogYears(cat);
  cat.close();
  const byCode = new Map(rows.map(r => [r.code, r]));

  let match = 0, differ = 0, noRow = 0;
  const lines: string[] = [];
  for (const c of scope) {
    const row = byCode.get(c.code);
    const sheet = sheetCodes(c.prerequisites ?? '', c.code);
    if (!row) {
      noRow++;
      lines.push(`NO CATALOG ROW  ${c.code}\n    sheet:   ${c.prerequisites || '(blank)'}\n    (the app keeps using the sheet line for this course)`);
      continue;
    }
    const parsed = catalogEdgesOf(row);
    const catalogCodes = parsed.edges.filter(e => e.kind !== 'coreq').map(e => e.code);
    const missing = catalogCodes.filter(x => !sheet.includes(x));
    const extra = sheet.filter(x => !catalogCodes.includes(x) && !parsed.edges.some(e => e.code === x && e.kind === 'coreq'));
    const same = missing.length === 0 && extra.length === 0;
    if (same) match++; else differ++;
    const detail = [
      `    sheet:   ${c.prerequisites || '(blank)'}`,
      `    catalog: ${formatCatalogPrereqs(parsed.edges) || '(no course prerequisites)'}${parsed.notes.length ? ` — notes: ${parsed.notes.join('; ')}` : ''}  [${row.prereq_text ?? ''}]`,
    ];
    if (missing.length) detail.push(`    sheet is missing: ${missing.join(', ')}`);
    if (extra.length) detail.push(`    sheet lists but catalog does not: ${extra.join(', ')}`);
    lines.push(`${same ? 'MATCH         ' : 'DIFFERS       '}  ${c.code}\n${detail.join('\n')}`);
  }

  const year = rows[0] ? catalogYearOf(rows[0].source_url, years) : 'unknown';
  console.log(`Prerequisites: GC course sheet vs Clemson catalog ${year} (${dbPath}, read-only)`);
  console.log(`Compared on course codes (prerequisite + "or concurrent"); lab corequisites ignored; non-course conditions shown as notes.\n`);
  console.log(lines.join('\n\n'));
  console.log(`\nSummary: ${scope.length} courses — ${match} match, ${differ} differ, ${noRow} have no catalog row.`);
}

main().catch(err => { console.error(err); process.exit(1); });
