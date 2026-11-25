#!/usr/bin/env tsx
/** Compare bloom-drift.ts outputs: tsx scripts/reliability/bloom-drift-compare.ts <old.json> <new.json> */
import { readFileSync } from 'node:fs';
import { compareRuns, type DriftRun } from './bloom-drift-lib';

const [oldPath, newPath] = process.argv.slice(2);
if (!oldPath || !newPath) { console.error('usage: bloom-drift-compare <old.json> <new.json>'); process.exit(2); }
const load = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as DriftRun[];
const report = compareRuns(load(oldPath), load(newPath));
console.log(JSON.stringify(report, null, 2));
const MIN_COURSES = 3, MIN_RUNS_PER_SIDE = 6;
if (report.compared.courses < MIN_COURSES || report.compared.oldRuns < MIN_RUNS_PER_SIDE || report.compared.newRuns < MIN_RUNS_PER_SIDE) {
  console.log(`INCONCLUSIVE: too little data (${report.compared.courses} courses, ${report.compared.oldRuns} old / ${report.compared.newRuns} new runs; need ${MIN_COURSES} courses and ${MIN_RUNS_PER_SIDE} runs per side)`);
  process.exit(1);
}
const fails = (['k', 'u', 'd'] as const).filter(d => report.meanShift[d] > Math.max(report.withinNoise[d], 0) || report.meanShift[d] > 0.25);
console.log(fails.length ? `FAIL: upward drift beyond threshold on ${fails.join(', ')}` : 'PASS: no upward drift beyond threshold');
