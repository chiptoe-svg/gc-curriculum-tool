#!/usr/bin/env tsx
/**
 * Unblinds judge verdicts and applies the pre-committed decision rule. Reads files only.
 *
 *   tsx scripts/bench/tally-blind.ts --pairs <out>/judge/pairs.json --key <out>/blind-key.json \
 *     --verdicts <out>/judge/verdicts.json [--second <out>/judge/verdicts-second.json] [--summary <summary.json>]
 *
 * --second defaults to verdicts-second.json beside --verdicts (if it exists). --summary defaults to
 * summary.json beside --key. Stability for an agent arm is compared with the same model's single arm (ruling R8).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { renderTally, tallyBlind, type BlindKey, type SummaryRow, type Verdict } from './lib/blind';

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

function main() {
  const argv = process.argv.slice(2);
  const arg = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const pairsPath = arg('--pairs'), keyPath = arg('--key'), verdictsPath = arg('--verdicts');
  if (!pairsPath || !keyPath || !verdictsPath) throw new Error('--pairs, --key and --verdicts are required');
  const summaryPath = arg('--summary') ?? join(dirname(keyPath), 'summary.json');
  const secondPath = arg('--second') ?? join(dirname(verdictsPath), 'verdicts-second.json');

  const { key } = readJson<{ key: BlindKey }>(keyPath);
  const pairIds = new Set(readJson<{ pairs: Array<{ id: string }> }>(pairsPath).pairs.map(p => p.id));
  const verdicts = readJson<Verdict[]>(verdictsPath);
  const second = existsSync(secondPath) ? readJson<Verdict[]>(secondPath) : undefined;
  for (const v of [...verdicts, ...(second ?? [])]) {
    if (!pairIds.has(v.id)) throw new Error(`verdict ${v.id} is not a pair in ${pairsPath}`);
  }
  const summary = readJson<{ rows: SummaryRow[] }>(summaryPath).rows;

  const tallies = tallyBlind({ key, verdicts, summary, second });
  console.log(renderTally(tallies, { verdictCount: verdicts.length, aPositionRate: tallies[0]?.aPositionRate ?? null, secondCount: second?.length }));
}

if (process.argv[1]?.endsWith('tally-blind.ts')) {
  try { main(); } catch (e) { console.error(e); process.exit(1); }
}
