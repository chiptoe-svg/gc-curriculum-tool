#!/usr/bin/env tsx
/**
 * Judge-role benchmark for campus models (spec
 * docs/superpowers/specs/2026-11-01-local-models-and-role-benchmark-design.md).
 *
 * Re-scores the competencies Sol (low) scored on 2026-10-19 for five courses,
 * with each campus setup, N runs each, and compares against Sol's stored cells.
 * Same metrics as scripts/reliability/model-eval.ts: full band agreement across
 * runs, evidence rule, excerpt grounding, modal band vs the baseline.
 *
 * Campus models only, and it never writes scores. Run against the bench copy,
 * never live, with no OpenAI key so a paid call cannot happen:
 *   env -u OPENAI_API_KEY -u CAMPUS_LLM_DEFAULT_MODEL DATABASE_URL=<bench> AI_PROVIDER=campus \
 *     CAMPUS_LLM_BASE_URL=… CAMPUS_LLM_API_KEY=… \
 *     BENCH_SETUPS='deepseek-v4.1-flash-1017:low,glm-5.3:medium' OUT=… pnpm exec tsx scripts/bench/role-judge.ts
 */
import { writeFileSync } from 'node:fs';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseCaptureSnapshots, snapshotCompetencyCoverage, subCompetencies } from '@/lib/db/schema';
import { getScoringFlags, flagsFor } from '@/lib/db/scoring-flags';
import { scoreSnapshotCompetencies } from '@/lib/ai/analyze/program-score-coverage';
import { depthBand } from '@/lib/program/depth-band';
import { grounded, normText as norm } from '../reliability/grounding';

if (process.env.OPENAI_API_KEY) throw new Error('Unset OPENAI_API_KEY: this benchmark must not reach a paid model');
if (process.env.AI_PROVIDER !== 'campus') throw new Error('Set AI_PROVIDER=campus');
if (!/gc_curriculum_bench/.test(process.env.DATABASE_URL ?? '')) throw new Error('DATABASE_URL must be the gc_curriculum_bench copy');

const COURSES = (process.env.BENCH_COURSES ?? 'GC 3460,GC 3700,GC 3730,GC 1050,GC 3400').split(',');
const N_RUNS = Number(process.env.N_RUNS ?? 5);
const SINCE = new Date('2026-10-19T16:33:55Z'); // the scorer fix 253ff3bb; Sol re-scored after it
const SETUPS = (process.env.BENCH_SETUPS ?? '').split(',').filter(Boolean).map(s => {
  const [model, level] = s.split(':');
  return { label: `${model} ${level ?? 'default'}`, model: model!, level };
});
if (!SETUPS.length) throw new Error('Set BENCH_SETUPS, e.g. deepseek-v4.1-flash-1017:low');
const OUT = process.env.OUT ?? 'role-judge.json';

type Dim = 'k' | 'u' | 'd';
interface Cell { sub: string; k: number | null; u: number | null; d: number; excerpt: string }
interface Call { setup: string; course: string; run: number; ok: boolean; ms: number; error?: string; cells: Cell[] }

const band = (v: number | null) => depthBand(v)?.key ?? 'none';
const ORDER = { none: 0, low: 1, working: 2, high: 3 } as const;
function mode<T>(xs: T[]): T | undefined {
  const c = new Map<T, number>(); for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** Retry gateway errors (5xx, connection) twice with a pause, so a cluster
 *  hiccup is not scored as a model failure. Model errors fail at once. */
async function withBackoff<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); } catch (e) {
      const status = (e as { status?: number }).status;
      const gateway = (typeof status === 'number' && status >= 500) || /ECONNRESET|ETIMEDOUT|ECONNREFUSED|fetch failed|Connection error|timed out/i.test((e as Error).message);
      if (!gateway || attempt >= 2) throw e;
      await new Promise(r => setTimeout(r, 30_000 * (attempt + 1)));
    }
  }
}

async function main() {
  const inputs = [];
  for (const course of COURSES) {
    const base = await db.select({ c: snapshotCompetencyCoverage, s: courseCaptureSnapshots })
      .from(snapshotCompetencyCoverage)
      .innerJoin(courseCaptureSnapshots, eq(courseCaptureSnapshots.id, snapshotCompetencyCoverage.snapshotId))
      .where(and(eq(courseCaptureSnapshots.courseCode, course), gte(snapshotCompetencyCoverage.generatedAt, SINCE)));
    if (!base.length) throw new Error(`no post-fix Sol cells for ${course}`);
    // A course re-scored on several snapshots: use its newest one.
    const snap = base.map(b => b.s).sort((a, b) => +b.createdAt - +a.createdAt)[0]!;
    const own = base.filter(b => b.s.id === snap.id);
    const ids = own.map(b => b.c.competencyId);
    const subs = await db.select().from(subCompetencies).where(inArray(subCompetencies.id, ids));
    inputs.push({
      course, snap, subs, flags: await getScoringFlags(ids), haystack: norm(JSON.stringify(snap.profile)),
      baseline: own.map(b => ({ sub: b.c.competencyId, k: b.c.kDepth, u: b.c.uDepth, d: b.c.dDepth, excerpt: b.c.evidenceExcerpt ?? '' })),
    });
  }
  console.log(`courses: ${inputs.map(i => `${i.course} (${i.subs.length})`).join(' | ')}\nsetups: ${SETUPS.map(s => s.label).join(' | ')}\nruns: ${N_RUNS}`);

  const calls: Call[] = [];
  // One model at a time (shared cluster); the five courses of a run in parallel.
  for (const s of SETUPS) {
    for (let run = 1; run <= N_RUNS; run++) {
      await Promise.all(inputs.map(async p => {
        const t0 = Date.now();
        try {
          const result = await withBackoff(() => scoreSnapshotCompetencies({
            snapshotId: p.snap.id, courseCode: p.snap.courseCode, snapshotProfile: p.snap.profile,
            competencies: p.subs.map(x => ({ id: x.id, name: x.name, knowDescriptor: x.knowDescriptor, understandDescriptor: x.understandDescriptor, doDescriptor: x.doDescriptor, ...flagsFor(p.flags, x.id) })),
            modelOverride: s.model,
            reasoningEffortOverride: s.level,
          }));
          calls.push({ setup: s.label, course: p.course, run, ok: true, ms: Date.now() - t0,
            cells: result.result.cells.map(c => ({ sub: c.competency_id, k: c.k_depth ?? null, u: c.u_depth ?? null, d: c.d_depth, excerpt: c.evidence_excerpt ?? '' })) });
          process.stdout.write('.');
        } catch (e) {
          calls.push({ setup: s.label, course: p.course, run, ok: false, ms: Date.now() - t0, error: (e as Error).message.slice(0, 300), cells: [] });
          process.stdout.write('x');
        }
      }));
      writeFileSync(OUT, JSON.stringify({ setups: SETUPS, courses: COURSES, calls }, null, 1)); // checkpoint
    }
    console.log(` ${s.label} done`);
  }

  const report: Record<string, unknown> = {};
  const disagreements: unknown[] = [];
  for (const s of [{ label: 'sol-low (stored 2026-10-19)' }, ...SETUPS]) {
    const isBase = !('model' in s);
    const agree: Record<Dim, number[]> = { k: [], u: [], d: [] };
    let cellsScored = 0, aboveFloor = 0, missingExcerpt = 0, ungrounded = 0, up = 0, down = 0, compared = 0;
    const mine = calls.filter(c => c.setup === s.label);
    for (const p of inputs) {
      const runs: Cell[][] = isBase ? [p.baseline] : mine.filter(c => c.ok && c.course === p.course).map(c => c.cells);
      for (const sub of p.subs) {
        const vals = runs.map(r => r.find(c => c.sub === sub.id)).filter((c): c is Cell => !!c);
        for (const v of vals) {
          cellsScored++;
          if ((v.k ?? 0) > 1 || (v.u ?? 0) > 0 || v.d > 0) { aboveFloor++; if (!v.excerpt.trim()) missingExcerpt++; else if (!grounded(v.excerpt, p.haystack)) ungrounded++; }
        }
        if (isBase || !vals.length) continue;
        const b = p.baseline.find(c => c.sub === sub.id)!;
        for (const dim of ['k', 'u', 'd'] as Dim[]) {
          const bands = vals.map(v => band(v[dim]));
          if (vals.length >= 2) agree[dim].push(bands.every(x => x === bands[0]) ? 1 : 0);
          const mb = mode(bands)!, bb = band(b[dim]);
          compared++;
          if (ORDER[mb] > ORDER[bb]) up++;
          if (ORDER[mb] < ORDER[bb]) down++;
          if (mb !== bb) disagreements.push({ setup: s.label, course: p.course, competencyId: sub.id, competency: sub.name, dim, candidateBand: mb, solBand: bb,
            candidateCell: vals[bands.indexOf(mb)], solCell: b });
        }
      }
    }
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, c) => a + c, 0) / xs.length : NaN);
    const ms = mine.filter(c => c.ok).map(c => c.ms / 1000);
    report[s.label] = {
      calls: mine.length, failures: mine.filter(c => !c.ok).map(c => `${c.course} run ${c.run}: ${c.error}`),
      fullBandAgreement: isBase ? null : { k: avg(agree.k), u: avg(agree.u), d: avg(agree.d) },
      evidence: { cellsScored, aboveFloor, missingExcerpt, excerptNotFoundInProfile: ungrounded },
      vsSol: isBase ? null : { comparedCellDims: compared, modalBandHigher: up, modalBandLower: down },
      secondsPerCall: isBase ? null : { mean: avg(ms), max: ms.length ? Math.max(...ms) : NaN },
    };
  }
  writeFileSync(OUT, JSON.stringify({ setups: SETUPS, courses: COURSES, report, disagreements, calls }, null, 1));
  console.log('\n' + JSON.stringify(report, null, 2));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
