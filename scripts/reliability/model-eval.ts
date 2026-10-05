#!/usr/bin/env tsx
/**
 * Model evaluation for coverage scoring (2026-10-05, owner-approved plan).
 *
 * Compares the production setting (gpt-5.5, no explicit effort) with
 * gpt-6.1-sol at low / medium / high reasoning effort on 5 course × target pairs,
 * 5 independent runs each, interleaved (every pass runs all setups on all pairs).
 *
 * Metric (unchanged from the 2026-06-12 study, scripts/reliability/check.ts):
 * per sub-competency, "full band agreement" = all runs land in the same depth
 * band (none 0 / low 1–2 / working 3 / high 4–5); reported per dimension.
 *
 * Automated checks (instead of human reviewers):
 *   - evidence rule: K>1, U>0 or D>0 must carry a non-empty evidence excerpt
 *   - excerpt grounding: the excerpt must appear in the snapshot profile text
 *     (whitespace/quote-normalised substring; long excerpts checked on a 60-char window)
 *   - upward drift: a candidate's modal band ABOVE the baseline's modal band
 *   - failures, latency, cost per call
 *
 * READ-ONLY: scores are never written; the only write is recordSpend (cost ledger).
 * Run: pnpm exec tsx --env-file=.env.local scripts/reliability/model-eval.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { careerTargets, subCompetencies } from '@/lib/db/schema';
import { getLatestSnapshotByCourse } from '@/lib/db/capture-snapshots-queries';
import { scoreSnapshotAgainstTarget } from '@/lib/ai/analyze/program-score-coverage';
import { recordSpend } from '@/lib/rate-limit/daily-cap';
import { depthBand } from '@/lib/program/depth-band';
import { grounded, normText as norm } from './grounding';

const N_RUNS = Number(process.env.N_RUNS ?? 5);
const ALL_PAIRS: Array<{ course: string; target: string }> = [
  { course: 'GC 3460', target: 'production-operations' },
  { course: 'GC 3700', target: 'brand-strategy' },
  { course: 'GC 3730', target: 'account-management' },
  { course: 'GC 1050', target: 'creative-generalist' },
  { course: 'GC 3400', target: 'creative-generalist' },
];
const PAIRS = ALL_PAIRS.slice(0, Number(process.env.PAIR_LIMIT ?? ALL_PAIRS.length));
const SETUPS: Array<{ label: string; model: string; effort?: string }> = [
  { label: 'gpt-5.5 (production)', model: 'gpt-5.5' },
  { label: 'gpt-6.1-sol low', model: 'gpt-6.1-sol', effort: 'low' },
  { label: 'gpt-6.1-sol medium', model: 'gpt-6.1-sol', effort: 'medium' },
  { label: 'gpt-6.1-sol high', model: 'gpt-6.1-sol', effort: 'high' },
];
const OUT_DIR = 'docs/superpowers/audits';
const STAMP = new Date().toISOString().slice(0, 10);
const OUT_JSON = `${OUT_DIR}/${STAMP}-model-evaluation${process.env.PAIR_LIMIT ? '-smoke' : ''}.json`;

type Dim = 'k' | 'u' | 'd';
interface Cell { sub: string; k: number | null; u: number | null; d: number; excerpt: string }
interface Call { setup: string; pair: string; run: number; ok: boolean; ms: number; costCents: number; error?: string; cells: Cell[] }

const band = (v: number | null) => depthBand(v)?.key ?? 'none';
const ORDER = { none: 0, low: 1, working: 2, high: 3 } as const;
function mode<T>(xs: T[]): T | undefined {
  const c = new Map<T, number>(); for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

async function main() {
  // Load the five pairs once (frozen inputs for every run).
  const targets = await db.select().from(careerTargets);
  const pairs = [];
  for (const p of PAIRS) {
    const snap = await getLatestSnapshotByCourse(p.course);
    if (!snap) throw new Error(`no snapshot for ${p.course}`);
    const t = targets.find(x => x.id === p.target);
    if (!t) throw new Error(`no target ${p.target}`);
    const subs = (await db.select().from(subCompetencies).where(eq(subCompetencies.careerTargetId, t.id)).orderBy(asc(subCompetencies.displayOrder))).filter(s => !s.retired);
    pairs.push({ key: `${p.course} × ${t.name}`, snap, t, subs, haystack: norm(JSON.stringify(snap.profile)) });
  }
  console.log(`pairs: ${pairs.map(p => p.key).join(' | ')}\nsetups: ${SETUPS.map(s => s.label).join(' | ')}\nruns: ${N_RUNS}`);

  const calls: Call[] = [];
  for (let run = 1; run <= N_RUNS; run++) {
    for (const p of pairs) {
      // All setups for this pair+run in parallel (interleaved, fresh requests).
      await Promise.all(SETUPS.map(async s => {
        const t0 = Date.now();
        try {
          const result = await scoreSnapshotAgainstTarget({
            snapshotId: p.snap.id, courseCode: p.snap.courseCode, snapshotProfile: p.snap.profile,
            careerTarget: { id: p.t.id, name: p.t.name, shortDefinition: p.t.shortDefinition, knowDescriptors: p.t.knowDescriptors, understandDescriptors: p.t.understandDescriptors, doDescriptors: p.t.doDescriptors },
            subCompetencies: p.subs.map(x => ({ id: x.id, name: x.name, knowDescriptor: x.knowDescriptor, understandDescriptor: x.understandDescriptor, doDescriptor: x.doDescriptor, displayOrder: x.displayOrder })),
            modelOverride: s.model,
            reasoningEffortOverride: s.effort,
          });
          await recordSpend(result.costUsdCents);
          calls.push({ setup: s.label, pair: p.key, run, ok: true, ms: Date.now() - t0, costCents: result.costUsdCents,
            cells: result.result.cells.map(c => ({ sub: c.sub_competency_id, k: c.k_depth ?? null, u: c.u_depth ?? null, d: c.d_depth, excerpt: c.evidence_excerpt ?? '' })) });
          process.stdout.write('.');
        } catch (e) {
          calls.push({ setup: s.label, pair: p.key, run, ok: false, ms: Date.now() - t0, costCents: 0, error: (e as Error).message.slice(0, 300), cells: [] });
          process.stdout.write('x');
        }
      }));
    }
    console.log(` pass ${run}/${N_RUNS} done`);
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(OUT_JSON, JSON.stringify({ stamp: STAMP, pairs: PAIRS, setups: SETUPS, calls }, null, 1)); // checkpoint
  }

  // ---- Analysis ----
  const report: Record<string, unknown> = {};
  const baseline = SETUPS[0]!.label;
  for (const s of SETUPS) {
    const mine = calls.filter(c => c.setup === s.label);
    const ok = mine.filter(c => c.ok);
    const agree: Record<Dim, number[]> = { k: [], u: [], d: [] };
    let cellsScored = 0, ruleViolations = 0, ungrounded = 0, scoredAboveFloor = 0, up = 0, down = 0, compared = 0;
    for (const p of pairs) {
      const runs = ok.filter(c => c.pair === p.key);
      const baseRuns = calls.filter(c => c.setup === baseline && c.ok && c.pair === p.key);
      for (const sub of p.subs) {
        const vals = runs.map(r => r.cells.find(c => c.sub === sub.id)).filter((c): c is Cell => !!c);
        // Evidence checks apply to every scored cell, repeats or not.
        for (const v of vals) {
          cellsScored++;
          const above = (v.k ?? 0) > 1 || (v.u ?? 0) > 0 || v.d > 0;
          if (above) { scoredAboveFloor++; if (!v.excerpt.trim()) ruleViolations++; else if (!grounded(v.excerpt, p.haystack)) ungrounded++; }
        }
        if (vals.length < 2) continue;
        for (const dim of ['k', 'u', 'd'] as Dim[]) {
          const bands = vals.map(v => band(v[dim]));
          agree[dim].push(bands.every(b => b === bands[0]) ? 1 : 0);
          const baseVals = baseRuns.map(r => r.cells.find(c => c.sub === sub.id)?.[dim]).filter(v => v !== undefined) as (number | null)[];
          if (s.label !== baseline && baseVals.length) {
            const mb = ORDER[mode(bands)!], bb = ORDER[mode(baseVals.map(band))!];
            compared++; if (mb > bb) up++; if (mb < bb) down++;
          }
        }
      }
    }
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
    const costs = ok.map(c => c.costCents / 10_000), ms = ok.map(c => c.ms / 1000);
    report[s.label] = {
      calls: mine.length, succeeded: ok.length, failures: mine.filter(c => !c.ok).map(c => `${c.pair} run ${c.run}: ${c.error}`),
      fullBandAgreement: { k: avg(agree.k), u: avg(agree.u), d: avg(agree.d), cells: agree.d.length },
      evidence: { cellsScored, scoredAboveFloor, missingExcerpt: ruleViolations, excerptNotFoundInProfile: ungrounded },
      vsBaseline: s.label === baseline ? null : { comparedCellDims: compared, modalBandHigher: up, modalBandLower: down },
      costUsd: { total: costs.reduce((a, b) => a + b, 0), perCall: avg(costs) },
      secondsPerCall: { mean: avg(ms), max: Math.max(...ms) },
    };
  }
  writeFileSync(OUT_JSON, JSON.stringify({ stamp: STAMP, pairs: PAIRS, setups: SETUPS, report, calls }, null, 1));
  console.log('\n' + JSON.stringify(report, null, 2));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
