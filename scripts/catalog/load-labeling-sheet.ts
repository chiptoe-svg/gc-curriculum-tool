/**
 * Load the owner's labeled spike pairs as decisions (source 'labeling_sheet').
 *
 *   pnpm tsx scripts/catalog/load-labeling-sheet.ts --labels "<1F 2P 3N ...>" --pairs <match-spike.json> --by "<name>" --expect-db <name> [--apply]
 *
 * The pairs file holds records { i, later, required, need, earlier, supplies, kud, sim, pFully, pPartly }: `later` and
 * `earlier` are course codes, `required` the required skill text, `need` its levels, `supplies` the supplied skill text (as written; no
 * snapshot ids), pFully/pPartly the spike judge's P with qwen3.8-27b-fp8 and prompt m1. F -> fully, P -> partly, N -> not.
 * Dry run by default (prints what it would write); --apply inserts the decisions.
 */
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { loadAppEnv, isMainModule, argValue } from './catalog-source';

import type { SpikePair } from '@/lib/db/match-labels';

loadAppEnv();


async function main(): Promise<number> {
  const { db } = await import('@/lib/db/client');
  const { insertDecision } = await import('@/lib/db/match-queries');
  const { parseLabels, spikeDecision } = await import('@/lib/db/match-labels');
  const { textHash } = await import('@/lib/catalog/bundles');
  const { normalizeStatement } = await import('@/lib/catalog/project-trail');
  const expect = argValue('--expect-db'), labelsArg = argValue('--labels'), pairsPath = argValue('--pairs'), by = argValue('--by');
  const apply = process.argv.includes('--apply');
  if (!expect || !labelsArg || !pairsPath || !by) { console.error('usage: --labels "<1F 2P 3N ...>" --pairs <match-spike.json> --by "<name>" --expect-db <name> [--apply]'); return 2; }
  const current = ((await db.execute(sql`SELECT current_database() AS d`)).rows[0] as { d: string }).d;
  if (current !== expect) { console.error(`refusing: connected to ${current}, expected ${expect}`); return 2; }

  const labels = parseLabels(labelsArg);
  const file = JSON.parse(readFileSync(pairsPath, 'utf8')) as SpikePair[] | { pairs: SpikePair[] };
  const pairs = new Map((Array.isArray(file) ? file : file.pairs).map(p => [p.i, p]));
  const titles = new Map(((await db.execute(sql`SELECT code, title FROM courses`)).rows as Array<{ code: string; title: string }>).map(r => [r.code, r.title]));

  const rows: Array<Parameters<typeof insertDecision>[0]> = [];
  for (const [i, label] of labels) {
    const p = pairs.get(i);
    if (!p) { console.error(`pair ${i} is not in ${pairsPath}`); return 2; }
    for (const code of [p.later, p.earlier]) if (!titles.has(code)) { console.error(`pair ${i}: "${code}" is not a course code in the courses table (is the pairs file shaped as expected?)`); return 2; }
    rows.push(spikeDecision(p, label, by, titles, (t) => textHash(normalizeStatement(t))));
  }
  const tally = (l: string) => rows.filter(r => r.label === l).length;
  console.log(`${rows.length} labeled pairs: ${tally('fully')} fully, ${tally('partly')} partly, ${tally('not')} not`);
  if (!apply) { console.log('DRY RUN: nothing written.'); return 0; }
  for (const r of rows) await insertDecision(r);
  console.log(`wrote ${rows.length} decisions as ${by}`);
  return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) main().then(code => process.exit(code), err => { console.error(err); process.exit(1); });
