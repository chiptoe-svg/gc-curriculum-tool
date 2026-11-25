#!/usr/bin/env tsx
/**
 * Bloom-language drift check (plan 2026-11-25-bloom-language-skill, Task 5).
 * Runs capture-scores on frozen inputs and writes the K/U/D levels and statements to JSON.
 * Run once from a checkout on the old prompts and once on the new, then compare with
 * bloom-drift-compare.ts.
 *
 * READ-ONLY: profiles are never saved. Campus models cost nothing. A paid model needs
 * --max-usd (an owner-approved hard cap); the cap is checked before every call and the
 * spend of each call is recorded.
 * Usage: pnpm exec tsx --env-file=<main>/.env.local scripts/reliability/bloom-drift.ts \
 *          --model gpt-6.1-sol --effort low --max-usd 1.75 --runs 2 --label old --out /path/out.json \
 *          [--courses "GC 3460,GC 1040"]
 */
import { writeFileSync } from 'node:fs';
import { generateCaptureProfileV2 } from '@/lib/ai/analyze/capture-scores';
import { isCampusModel } from '@/lib/ai/models';
import { recordSpend } from '@/lib/rate-limit/daily-cap';
import { assembleSynthesisContext } from '../_one-off/reliability-study';
import { mayCall, type DriftRun } from './bloom-drift-lib';

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const model = arg('model')!;
const effort = arg('effort');
const maxUsdArg = arg('max-usd');
const maxUsd = maxUsdArg ? Number(maxUsdArg) : null;
const runs = Number(arg('runs', '2'));
const label = arg('label', 'run')!;
const out = arg('out')!;
const courses = (arg('courses', 'GC 3460,GC 3700,GC 3730,GC 1040')!).split(',').map(s => s.trim());
const usd = (n: number) => '$' + n.toFixed(3);

async function main() {
  if (!model || !out) throw new Error('--model and --out are required');
  const paid = !isCampusModel(model);
  if (paid && !(maxUsd !== null && maxUsd > 0)) throw new Error(`paid model "${model}" needs --max-usd (owner-approved hard cap)`);
  const cap = paid ? maxUsd : null;
  let spent = 0, largest = 0;
  const results: DriftRun[] = [];
  for (const course of courses) {
    const ctx = (await assembleSynthesisContext(course)).context;
    for (let run = 1; run <= runs; run++) {
      if (!mayCall(spent, cap, largest)) {
        console.log(`[STOP] ceiling: spent ${usd(spent)} of ${usd(cap ?? 0)}, largest call ${usd(largest)}`);
        writeFileSync(out, JSON.stringify(results, null, 1));
        process.exit(0);
      }
      const t0 = Date.now();
      try {
        const r = await generateCaptureProfileV2(
          { chatContext: ctx, sessionId: ctx.sessionId, transcript: ctx.transcript } as Parameters<typeof generateCaptureProfileV2>[0],
          { model, ...(effort ? { reasoningEffort: effort } : {}) },
        );
        const callUsd = r.telemetry.costUsdCents / 10_000; // daily_cost units are 1/100 cent
        if (paid) await recordSpend(r.telemetry.costUsdCents);
        spent += callUsd; largest = Math.max(largest, callUsd);
        const comps = r.profile.competencies;
        results.push({
          course, run, label,
          cells: comps.map(c => ({ competency: c.statement, k: c.k_depth, u: c.u_depth, d: c.d_depth })),
          statements: comps.map(c => c.statement),
        });
        console.log(`[ok] ${label} ${course} run ${run} ${((Date.now() - t0) / 1000).toFixed(0)}s, ${comps.length} competencies, ${usd(callUsd)} (total ${usd(spent)})`);
      } catch (e) {
        console.log(`[FAIL] ${label} ${course} run ${run}: ${(e as Error).message.slice(0, 200)}`);
      }
      writeFileSync(out, JSON.stringify(results, null, 1));
    }
  }
  console.log(`[done] ${label}: ${results.length} runs, spent ${usd(spent)}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
