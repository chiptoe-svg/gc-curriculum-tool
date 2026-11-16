/**
 * Export the skill-match decisions (the labeled-pair dataset) to a file.
 *
 *   pnpm tsx scripts/catalog/export-match-decisions.ts --out <file> [--csv] [--latest] --expect-db <database name>
 *
 * JSON Lines by default, CSV with --csv; --latest keeps the decision that counts for each pair (newest non-draft,
 * plus draft decisions as their own rows). Read-only.
 */
import { writeFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { loadAppEnv, isMainModule, argValue } from './catalog-source';

loadAppEnv();

async function main(): Promise<number> {
  const { db } = await import('@/lib/db/client');
  const { exportDecisions } = await import('@/lib/db/match-queries');
  const { toCsv, toJsonl, toRecords } = await import('@/lib/db/match-export');
  const expect = argValue('--expect-db');
  const out = argValue('--out');
  if (!expect || !out) { console.error('usage: --out <file> [--csv] [--latest] --expect-db <database name>'); return 2; }
  const current = ((await db.execute(sql`SELECT current_database() AS d`)).rows[0] as { d: string }).d;
  if (current !== expect) { console.error(`refusing: connected to ${current}, expected ${expect}`); return 2; }
  const recs = toRecords(await exportDecisions({ latestOnly: process.argv.includes('--latest') }));
  writeFileSync(out, process.argv.includes('--csv') ? toCsv(recs) : toJsonl(recs));
  console.log(`wrote ${recs.length} decisions to ${out}`);
  return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) main().then(code => process.exit(code), err => { console.error(err); process.exit(1); });
