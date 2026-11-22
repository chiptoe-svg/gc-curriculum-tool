#!/usr/bin/env tsx
/**
 * Unblinds judge verdicts and applies the pre-committed decision rule. Reads files only.
 *
 *   tsx scripts/bench/tally-blind.ts --pairs <blind-pairs.json> --key <blind-key.json> \
 *     --verdicts <verdicts.json> [--second <verdicts-2.json>] [--summary <summary.json>]
 *
 * Stability for an agent arm is compared with the same model's single arm (ruling R8).
 * --summary defaults to summary.json beside --pairs (written by agent-judge.ts).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { renderTally, tallyBlind, type ArmTally, type SummaryRow, type Verdict } from './lib/blind';

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

function main() {
  const argv = process.argv.slice(2);
  const arg = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const pairsPath = arg('--pairs'), keyPath = arg('--key'), verdictsPath = arg('--verdicts');
  if (!pairsPath || !keyPath || !verdictsPath) throw new Error('--pairs, --key and --verdicts are required');
  const summaryPath = arg('--summary') ?? join(dirname(pairsPath), 'summary.json');

  const { key } = readJson<{ key: Parameters<typeof tallyBlind>[0]['key'] }>(keyPath);
  const verdicts = readJson<Verdict[]>(verdictsPath);
  const second = arg('--second') ? readJson<Verdict[]>(arg('--second')!) : undefined;
  const summary = readJson<{ rows: SummaryRow[] }>(summaryPath).rows;

  const tallies: ArmTally[] = tallyBlind({ key, verdicts, summary, second });
  console.log(renderTally(tallies, { verdictCount: verdicts.length, aPositionRate: tallies.length ? tallies[0]!.aPositionRate : null, secondCount: second?.length }));
}

if (process.argv[1]?.endsWith('tally-blind.ts')) {
  try { main(); } catch (e) { console.error(e); process.exit(1); }
}
