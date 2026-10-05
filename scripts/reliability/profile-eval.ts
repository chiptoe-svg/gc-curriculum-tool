#!/usr/bin/env tsx
/**
 * Model evaluation for course-profile writing (capture-scores; 2026-10-05).
 *
 * Production (gpt-5.4, no explicit effort) vs gpt-6.1-sol low / medium / high, on
 * 3 courses × 3 independent runs, interleaved. Same frozen inputs June's study used
 * (assembleSynthesisContext) and the same stability measures (computePart1Metrics):
 * technical-competency count, foundational D-band agreement, matched-competency
 * depth deltas. Adds provenance: share of competencies whose source is 'inferred'
 * (no resolvable citation) — the weakest evidence level.
 *
 * READ-ONLY: profiles are never saved; the only write is recordSpend.
 * Run: pnpm exec tsx --env-file=.env.local scripts/reliability/profile-eval.ts
 */
import { writeFileSync } from 'node:fs';
import { generateCaptureProfileV2 } from '@/lib/ai/analyze/capture-scores';
import { recordSpend } from '@/lib/rate-limit/daily-cap';
import type { CaptureProfile } from '@/lib/ai/capture/schema';
import { assembleSynthesisContext, computePart1Metrics } from '../_one-off/reliability-study';

const N_RUNS = Number(process.env.N_RUNS ?? 3);
const COURSES = ['GC 3460', 'GC 3700', 'GC 3730'];
// Lean rerun (owner, 2026-10-05): the coverage evaluation showed no gain from
// medium/high effort, so only production vs Sol low.
const SETUPS: Array<{ label: string; model: string; effort?: string }> = [
  { label: 'gpt-5.4 (production)', model: 'gpt-5.4' },
  { label: 'gpt-6.1-sol low', model: 'gpt-6.1-sol', effort: 'low' },
];
const CALL_TIMEOUT_MS = Number(process.env.CALL_TIMEOUT_MS ?? 10 * 60_000);
const withTimeout = <T,>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timeout after ${CALL_TIMEOUT_MS / 1000}s`)), CALL_TIMEOUT_MS))]);
const OUT_JSON = `docs/superpowers/audits/${new Date().toISOString().slice(0, 10)}-profile-model-evaluation.json`;

async function main() {
  const contexts = new Map<string, Awaited<ReturnType<typeof assembleSynthesisContext>>['context']>();
  for (const c of COURSES) contexts.set(c, (await assembleSynthesisContext(c)).context);

  const results: Record<string, Record<string, { profiles: CaptureProfile[]; costs: number[]; secs: number[]; failures: string[] }>> = {};
  for (const s of SETUPS) { results[s.label] = {}; for (const c of COURSES) results[s.label]![c] = { profiles: [], costs: [], secs: [], failures: [] }; }

  const t00 = Date.now();
  for (let run = 1; run <= N_RUNS; run++) {
    // Every setup × course in parallel: a pass waits once for its slowest call.
    await Promise.all(COURSES.flatMap(c => SETUPS.map(async s => {
      const ctx = contexts.get(c)!;
      const t0 = Date.now();
      const slot = results[s.label]![c]!;
      try {
        const r = await withTimeout(generateCaptureProfileV2(
          { chatContext: ctx, sessionId: ctx.sessionId, transcript: ctx.transcript } as Parameters<typeof generateCaptureProfileV2>[0],
          { model: s.model, reasoningEffort: s.effort },
        ));
        await recordSpend(r.telemetry.costUsdCents);
        slot.profiles.push(r.profile); slot.costs.push(r.telemetry.costUsdCents / 10_000); slot.secs.push((Date.now() - t0) / 1000);
        console.log(`[call] run ${run} ${c} | ${s.label} | ok ${((Date.now() - t0) / 1000).toFixed(0)}s $${(r.telemetry.costUsdCents / 10_000).toFixed(3)}`);
      } catch (e) {
        slot.failures.push(`run ${run}: ${(e as Error).message.slice(0, 200)}`);
        console.log(`[call] run ${run} ${c} | ${s.label} | FAIL ${((Date.now() - t0) / 1000).toFixed(0)}s ${(e as Error).message.slice(0, 160)}`);
      }
    })));
    console.log(` pass ${run}/${N_RUNS} done at ${((Date.now() - t00) / 60000).toFixed(1)} min`);
    writeFileSync(OUT_JSON.replace('.json', '-checkpoint.json'), JSON.stringify(results, null, 1));
  }

  const report: Record<string, unknown> = {};
  for (const s of SETUPS) {
    const perCourse: Record<string, unknown> = {};
    let cost = 0, secs: number[] = [], inferred = 0, comps = 0, failures = 0;
    for (const c of COURSES) {
      const slot = results[s.label]![c]!;
      cost += slot.costs.reduce((a, b) => a + b, 0); secs = secs.concat(slot.secs); failures += slot.failures.length;
      for (const p of slot.profiles) for (const comp of p.competencies) { comps++; if (comp.source === 'inferred') inferred++; }
      if (slot.profiles.length >= 2) {
        const m = computePart1Metrics(c, slot.profiles, slot.costs, s.model, null).metrics as Record<string, unknown>;
        const fd = m.foundationalDepths as Record<string, { bandAgreement: number }>;
        const fdVals = Object.values(fd).map(v => v.bandAgreement);
        perCourse[c] = {
          technicalCount: (m.technicalCompetencyCount as { perRun: number[] }).perRun,
          foundationalBandAgreement: fdVals.length ? fdVals.reduce((a, b) => a + b, 0) / fdVals.length : null,
          statementStability: (() => {
            const st = m.statementSetStability as { meanPairwiseJaccard: number; matchedPairs: unknown[]; matchedPairDeltaMeanK: number | null; matchedPairDeltaMeanU: number | null; matchedPairDeltaMeanD: number };
            return { meanPairwiseJaccard: st.meanPairwiseJaccard, matchedPairs: st.matchedPairs.length, meanDeltaK: st.matchedPairDeltaMeanK, meanDeltaU: st.matchedPairDeltaMeanU, meanDeltaD: st.matchedPairDeltaMeanD };
          })(),
        };
      } else perCourse[c] = { failures: slot.failures };
    }
    report[s.label] = {
      perCourse, failures, inferredShare: comps ? inferred / comps : null,
      costUsd: cost, secondsPerCall: secs.length ? secs.reduce((a, b) => a + b, 0) / secs.length : null,
    };
  }
  writeFileSync(OUT_JSON, JSON.stringify({ courses: COURSES, setups: SETUPS, report }, null, 1));
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
