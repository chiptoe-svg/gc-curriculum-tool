#!/usr/bin/env tsx
/**
 * Unblinds judge verdicts and applies the pre-committed decision rule. Reads files only.
 *
 *   tsx scripts/bench/tally-blind.ts --pairs <blind-pairs.json> --key <blind-key.json> \
 *     --verdicts <verdicts.json> [--second <verdicts-2.json>] [--summary <summary.json>]
 *
 * --summary defaults to summary.json beside --pairs (written by agent-judge.ts).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tallyBlind, type ArmTally, type SummaryRow, type Verdict } from './lib/blind';

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;
const pct = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
const num = (x: number | null, d = 2) => (x === null ? 'n/a' : x.toFixed(d));

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
  const lines = [
    `# Blind tally`, '',
    `Verdicts: ${verdicts.length}${second ? `; second judge: ${second.length}` : ''}.`,
    `A-position win rate (non-tie): ${pct(tallies[0]?.aPositionRate ?? null)} (bias check: near 50% is expected).`, '',
    '| arm / model | wins | losses | ties | pref ex-ties | agreement w/ 2nd judge | breaks (baseline) | stability (baseline) | decision |',
    '|---|---|---|---|---|---|---|---|---|',
    ...tallies.filter(t => t.label !== 'baseline').map(t =>
      `| ${t.label} | ${t.wins} | ${t.losses} | ${t.ties} | ${pct(t.prefExTies)} | ${pct(t.agreement)} | ${t.breaks ?? 'n/a'} (${t.baselineBreaks ?? 'n/a'}) | ${num(t.stability)} (${num(t.baselineStability)}) | ${t.adopt ? 'ADOPT' : 'NOT ADOPTED'}: ${t.reasons.join('; ')} |`),
    '',
  ];
  console.log(lines.join('\n'));
}

if (process.argv[1]?.endsWith('tally-blind.ts')) {
  try { main(); } catch (e) { console.error(e); process.exit(1); }
}
