#!/usr/bin/env tsx
/**
 * Bloom-language drift check (plan 2026-11-25-bloom-language-skill, Task 5).
 * Runs capture-scores on frozen inputs with a FREE campus model and writes the K/U/D levels
 * and statements to JSON. Run once from a checkout on the old prompts and once on the new,
 * then compare with bloom-drift-compare.ts.
 *
 * READ-ONLY: profiles are never saved; no spend is recorded (campus models cost nothing).
 * Usage: pnpm exec tsx --env-file=<main>/.env.local scripts/reliability/bloom-drift.ts \
 *          --model qwen3.8-27b-fp8 --runs 2 --label old --out /path/out.json [--courses "GC 3460,GC 1040"]
 */
import { writeFileSync } from 'node:fs';
import { generateCaptureProfileV2 } from '@/lib/ai/analyze/capture-scores';
import { isCampusModel } from '@/lib/ai/models';
import { assembleSynthesisContext } from '../_one-off/reliability-study';
import type { DriftRun } from './bloom-drift-lib';

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const model = arg('model')!;
const runs = Number(arg('runs', '2'));
const label = arg('label', 'run')!;
const out = arg('out')!;
const courses = (arg('courses', 'GC 3460,GC 3700,GC 3730,GC 1040')!).split(',').map(s => s.trim());

async function main() {
  if (!model || !out) throw new Error('--model and --out are required');
  if (!isCampusModel(model)) throw new Error(`refusing non-campus model "${model}": this check must cost nothing`);
  const results: DriftRun[] = [];
  for (const course of courses) {
    const ctx = (await assembleSynthesisContext(course)).context;
    for (let run = 1; run <= runs; run++) {
      const t0 = Date.now();
      try {
        const r = await generateCaptureProfileV2(
          { chatContext: ctx, sessionId: ctx.sessionId, transcript: ctx.transcript } as Parameters<typeof generateCaptureProfileV2>[0],
          { model },
        );
        const comps = r.profile.competencies;
        results.push({
          course, run, label,
          cells: comps.map(c => ({ competency: c.statement, k: c.k_depth, u: c.u_depth, d: c.d_depth })),
          statements: comps.map(c => c.statement),
        });
        console.log(`[ok] ${label} ${course} run ${run} ${((Date.now() - t0) / 1000).toFixed(0)}s, ${comps.length} competencies`);
      } catch (e) {
        console.log(`[FAIL] ${label} ${course} run ${run}: ${(e as Error).message.slice(0, 200)}`);
      }
      writeFileSync(out, JSON.stringify(results, null, 1));
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
