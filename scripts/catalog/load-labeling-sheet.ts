/**
 * Load the owner's labeled spike pairs as decisions (source 'labeling_sheet').
 *
 *   pnpm tsx scripts/catalog/load-labeling-sheet.ts --labels "<1F 2P 3N ...>" --pairs <match-spike.json> --by "<name>" --expect-db <name> [--apply]
 *
 * The pairs file holds records { i, later, required, need, earlier, supplies, sim, pFully, pPartly }: `later` and
 * `earlier` are course codes, `need` the required skill text, `supplies` the supplied skill text (as written; no
 * snapshot ids), pFully/pPartly the spike judge's P with qwen3.8-27b-fp8 and prompt m1. F -> fully, P -> partly, N -> not.
 * Dry run by default (prints what it would write); --apply inserts the decisions.
 */
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { loadAppEnv, isMainModule, argValue } from './catalog-source';

loadAppEnv();

type SpikePair = { i: number; later: string; need: string; earlier: string; supplies: string; pFully?: number | null; pPartly?: number | null };

async function main(): Promise<number> {
  const { db } = await import('@/lib/db/client');
  const { insertDecision } = await import('@/lib/db/match-queries');
  const { parseLabels } = await import('@/lib/db/match-labels');
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
    rows.push({
      requiredHash: textHash(normalizeStatement(p.need)), suppliedHash: textHash(normalizeStatement(p.supplies)),
      requiredText: p.need, suppliedText: p.supplies,
      requiredCourse: p.later, requiredCourseTitle: titles.get(p.later) ?? null, suppliedCourse: p.earlier, suppliedCourseTitle: titles.get(p.earlier) ?? null,
      label, draft: false, source: 'labeling_sheet', decidedBy: by,
      judgeModel: 'qwen3.8-27b-fp8', promptVersion: 'm1', judgePFully: p.pFully ?? null, judgePPartly: p.pPartly ?? null,
    });
  }
  const tally = (l: string) => rows.filter(r => r.label === l).length;
  console.log(`${rows.length} labeled pairs: ${tally('fully')} fully, ${tally('partly')} partly, ${tally('not')} not`);
  if (!apply) { console.log('DRY RUN: nothing written.'); return 0; }
  for (const r of rows) await insertDecision(r);
  console.log(`wrote ${rows.length} decisions as ${by}`);
  return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) main().then(code => process.exit(code), err => { console.error(err); process.exit(1); });
