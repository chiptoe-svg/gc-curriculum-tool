#!/usr/bin/env tsx
/**
 * Standing reliability tripwire for the coverage scorer.
 *
 * Re-runs scoreSnapshotAgainstTarget on a FIXED small pair set
 * (GC 3800's latest non-retired snapshot × the first 2 career targets by
 * displayOrder — the same pairs used in A6 Part 2 / Part 2b), measures
 * per-dimension band-agreement, and exits non-zero if any dimension's
 * agreement falls below RELIABILITY_THRESHOLDS.
 *
 * Run:
 *   pnpm reliability:check
 *
 * Full study (N=5, 2 pairs, ~$0.40):  N_RUNS=5 PAIRS=2
 * Smoke test  (N=2, 1 pair,  ~$0.08):  N_RUNS=2 PAIRS=1  (env override)
 *
 * Safety discipline:
 *   - READ-ONLY against all app tables (no cell writes, no profile upserts)
 *   - recordSpend() keeps the cost ledger honest
 *   - checkDailyCap() before EVERY model call — stops gracefully + reports
 *     partial results if capped
 *   - Prints resolved model on the first call — tier drift is exactly what
 *     this check is designed to catch
 */

import { db } from '@/lib/db/client';
import { careerTargets, subCompetencies } from '@/lib/db/schema';
import { eq, asc } from 'drizzle-orm';

import { getLatestSnapshotByCourse } from '@/lib/db/capture-snapshots-queries';
import { scoreSnapshotAgainstTarget } from '@/lib/ai/analyze/program-score-coverage';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import { depthBand } from '@/lib/program/depth-band';
import { resolveModelForFunction } from '@/lib/ai/function-settings';
import {
  RELIABILITY_THRESHOLDS,
  LAST_MEASURED,
} from '@/lib/program/reliability-summary';

// ─── Configuration ────────────────────────────────────────────────────────────

/** Number of re-runs per pair. Default 5 (standing check); override with env. */
const N_RUNS = process.env['N_RUNS'] ? parseInt(process.env['N_RUNS'], 10) : 5;
/** Number of career-target pairs. Default 2; override with env. */
const N_PAIRS = process.env['PAIRS'] ? parseInt(process.env['PAIRS'], 10) : 2;
const STUDY_COURSE_CODE = 'GC 3800';

// ─── Math helpers ─────────────────────────────────────────────────────────────

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function bandAgreement(values: (number | null)[]): number {
  const nonNull = values.filter((v): v is number => v !== null);
  if (nonNull.length < 2) return 1;
  const bands = nonNull.map(v => depthBand(v)?.key ?? 'none');
  return bands.every(b => b === bands[0]) ? 1 : 0;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

// ─── Per-run cell map ─────────────────────────────────────────────────────────

interface CoverageRunCells {
  [subCompetencyId: string]: {
    k_depth: number | null;
    u_depth: number | null;
    d_depth: number;
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`\n=== reliability:check — ${startedAt.slice(0, 19)} ===`);
  console.log(`Config: N_RUNS=${N_RUNS}, N_PAIRS=${N_PAIRS}, course=${STUDY_COURSE_CODE}\n`);

  // ── Verify model tier BEFORE burning runs ─────────────────────────────────
  const resolvedModel = await resolveModelForFunction('program-score-coverage');
  console.log(`[model-check] program-score-coverage resolves to: ${resolvedModel}`);

  if (!(resolvedModel in LAST_MEASURED)) {
    console.warn(
      `[model-check] WARNING: "${resolvedModel}" has no entry in LAST_MEASURED. ` +
      `Reliability thresholds exist but no baseline to compare against. ` +
      `Run will proceed — add an entry to lib/program/reliability-summary.ts after completing a full N=5 study.`,
    );
  } else {
    const entry = LAST_MEASURED[resolvedModel]!;
    console.log(
      `[model-check] Baseline on file: K=${pct(entry.k)} U=${pct(entry.u)} D=${pct(entry.d)} (${entry.date})`,
    );
  }

  // ── Load snapshot ──────────────────────────────────────────────────────────
  const snap = await getLatestSnapshotByCourse(STUDY_COURSE_CODE);
  if (!snap) {
    console.error(`FATAL: No snapshot found for ${STUDY_COURSE_CODE}. Cannot run check.`);
    process.exit(1);
  }
  console.log(`[snapshot] Using ${snap.id.slice(0, 8)} (${STUDY_COURSE_CODE})\n`);

  // ── Load first N career targets by displayOrder ────────────────────────────
  const allTargets = await db
    .select({
      id: careerTargets.id,
      name: careerTargets.name,
      displayOrder: careerTargets.displayOrder,
      shortDefinition: careerTargets.shortDefinition,
      knowDescriptors: careerTargets.knowDescriptors,
      understandDescriptors: careerTargets.understandDescriptors,
      doDescriptors: careerTargets.doDescriptors,
    })
    .from(careerTargets)
    .orderBy(asc(careerTargets.displayOrder));

  const targets = allTargets.slice(0, N_PAIRS);
  console.log(`[targets] ${targets.map(t => t.name).join(', ')}\n`);

  // ── Run pairs ─────────────────────────────────────────────────────────────

  type PairResult = {
    name: string;
    subCount: number;
    kBandAgree: number;
    uBandAgree: number;
    dBandAgree: number;
    truncated: boolean;
    runsCompleted: number;
    actualModel: string | null;
  };

  const pairResults: PairResult[] = [];
  let truncatedGlobally = false;
  let totalCostCents = 0;

  for (const target of targets) {
    if (truncatedGlobally) {
      console.log(`[skip] "${target.name}" — daily cap hit earlier\n`);
      continue;
    }

    const subs = await db
      .select({
        id: subCompetencies.id,
        name: subCompetencies.name,
        knowDescriptor: subCompetencies.knowDescriptor,
        understandDescriptor: subCompetencies.understandDescriptor,
        doDescriptor: subCompetencies.doDescriptor,
        displayOrder: subCompetencies.displayOrder,
        retired: subCompetencies.retired,
      })
      .from(subCompetencies)
      .where(eq(subCompetencies.careerTargetId, target.id))
      .orderBy(asc(subCompetencies.displayOrder));

    const activeSubs = subs.filter(s => !s.retired);
    console.log(`[pair] "${target.name}" (${activeSubs.length} active sub-comps, ${N_RUNS} runs)`);

    const coverageRuns: CoverageRunCells[] = [];
    let truncatedAtRun = false;
    let actualModel: string | null = null;

    for (let i = 0; i < N_RUNS; i++) {
      const cap = await checkDailyCap();
      if (!cap.ok) {
        console.log(`  ⚠ Daily cap hit before run ${i + 1} (spent: ${cap.spentCents} 1/100¢). Stopping gracefully.`);
        truncatedAtRun = true;
        truncatedGlobally = true;
        break;
      }

      process.stdout.write(`  run ${i + 1}/${N_RUNS}... `);
      const t0 = Date.now();

      try {
        const { result, model, costUsdCents } = await scoreSnapshotAgainstTarget({
          snapshotId: snap.id,
          courseCode: STUDY_COURSE_CODE,
          snapshotProfile: snap.profile,
          careerTarget: {
            id: target.id,
            name: target.name,
            shortDefinition: target.shortDefinition,
            knowDescriptors: target.knowDescriptors as string[],
            understandDescriptors: target.understandDescriptors as string[],
            doDescriptors: target.doDescriptors as string[],
          },
          subCompetencies: activeSubs.map(s => ({
            id: s.id,
            name: s.name,
            knowDescriptor: s.knowDescriptor,
            understandDescriptor: s.understandDescriptor,
            doDescriptor: s.doDescriptor,
            displayOrder: s.displayOrder,
          })),
        });

        await recordSpend(costUsdCents);
        totalCostCents += costUsdCents;

        // Print + verify model on first actual call
        if (i === 0) {
          actualModel = model;
          console.log(`\n  [model-verify run-1] actual model: ${model}`);
          if (model !== resolvedModel) {
            console.warn(
              `  [model-verify] WARNING: resolveModelForFunction returned "${resolvedModel}" ` +
              `but first call used "${model}". Check for routing discrepancy.`,
            );
          }
        }

        const cellMap: CoverageRunCells = {};
        for (const cell of result.cells) {
          cellMap[cell.sub_competency_id] = {
            k_depth: cell.k_depth,
            u_depth: cell.u_depth,
            d_depth: cell.d_depth,
          };
        }
        coverageRuns.push(cellMap);

        const elapsed = Date.now() - t0;
        if (i > 0) process.stdout.write(`  run ${i + 1}/${N_RUNS}... `);
        console.log(`done (${elapsed}ms, ${costUsdCents} 1/100¢, cells=${result.cells.length})`);
      } catch (err) {
        console.error(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (coverageRuns.length < 2) {
      console.log(`  [skip] Fewer than 2 runs completed — cannot compute band-agreement.\n`);
      continue;
    }

    // Compute per-dimension band-agreement over runs
    const subIds = activeSubs.map(s => s.id);
    const kAgreements: number[] = [];
    const uAgreements: number[] = [];
    const dAgreements: number[] = [];

    for (const subId of subIds) {
      const kVals = coverageRuns.map(r => r[subId]?.k_depth ?? null);
      const uVals = coverageRuns.map(r => r[subId]?.u_depth ?? null);
      const dVals = coverageRuns.map(r => r[subId]?.d_depth ?? 0);

      const kNonNull = kVals.filter((v): v is number => v !== null);
      const uNonNull = uVals.filter((v): v is number => v !== null);

      if (kNonNull.length >= 2) kAgreements.push(bandAgreement(kNonNull));
      if (uNonNull.length >= 2) uAgreements.push(bandAgreement(uNonNull));
      dAgreements.push(bandAgreement(dVals));
    }

    const kBandAgree = kAgreements.length > 0 ? mean(kAgreements) : 1;
    const uBandAgree = uAgreements.length > 0 ? mean(uAgreements) : 1;
    const dBandAgree = dAgreements.length > 0 ? mean(dAgreements) : 1;

    pairResults.push({
      name: target.name,
      subCount: activeSubs.length,
      kBandAgree,
      uBandAgree,
      dBandAgree,
      truncated: truncatedAtRun,
      runsCompleted: coverageRuns.length,
      actualModel,
    });

    console.log(`  Band-agree: K=${pct(kBandAgree)} U=${pct(uBandAgree)} D=${pct(dBandAgree)} (${coverageRuns.length}/${N_RUNS} runs)\n`);
  }

  const totalCostUsd = (totalCostCents / 10000).toFixed(4);
  console.log(`Total cost this run: $${totalCostUsd} (${totalCostCents} 1/100¢)\n`);

  if (pairResults.length === 0) {
    console.error('ERROR: No pairs completed (all truncated or no snapshot). Cannot evaluate thresholds.');
    process.exit(1);
  }

  // ── Aggregate and print table ──────────────────────────────────────────────

  const meanK = mean(pairResults.map(r => r.kBandAgree));
  const meanU = mean(pairResults.map(r => r.uBandAgree));
  const meanD = mean(pairResults.map(r => r.dBandAgree));

  console.log('=== Band-agreement table ===');
  console.log('');
  console.log('  Pair                        | Runs | K band-agree | U band-agree | D band-agree');
  console.log('  ----------------------------|------|--------------|--------------|-------------');
  for (const r of pairResults) {
    const name = r.name.padEnd(28);
    console.log(
      `  ${name} | ${String(r.runsCompleted).padStart(4)} | ${pct(r.kBandAgree).padStart(12)} | ${pct(r.uBandAgree).padStart(12)} | ${pct(r.dBandAgree).padStart(12)}${r.truncated ? '  (truncated)' : ''}`,
    );
  }
  console.log('  ----------------------------|------|--------------|--------------|-------------');
  console.log(
    `  ${'MEAN'.padEnd(28)} |      | ${pct(meanK).padStart(12)} | ${pct(meanU).padStart(12)} | ${pct(meanD).padStart(12)}`,
  );
  console.log('');
  console.log('  Thresholds (RELIABILITY_THRESHOLDS):');
  console.log(
    `    K ≥ ${pct(RELIABILITY_THRESHOLDS.k)}   U ≥ ${pct(RELIABILITY_THRESHOLDS.u)}   D ≥ ${pct(RELIABILITY_THRESHOLDS.d)}`,
  );
  console.log('');

  // ── Compare to thresholds ─────────────────────────────────────────────────

  const failures: string[] = [];
  if (meanK < RELIABILITY_THRESHOLDS.k)
    failures.push(`K band-agree ${pct(meanK)} < threshold ${pct(RELIABILITY_THRESHOLDS.k)}`);
  if (meanU < RELIABILITY_THRESHOLDS.u)
    failures.push(`U band-agree ${pct(meanU)} < threshold ${pct(RELIABILITY_THRESHOLDS.u)}`);
  if (meanD < RELIABILITY_THRESHOLDS.d)
    failures.push(`D band-agree ${pct(meanD)} < threshold ${pct(RELIABILITY_THRESHOLDS.d)}`);

  if (failures.length > 0) {
    console.error('✗ RELIABILITY CHECK FAILED — band-agreement below threshold:');
    for (const f of failures) console.error(`  · ${f}`);
    console.error('');
    console.error(
      'This may indicate model/tier drift or a scoring prompt regression. ' +
      'Check lib/ai/function-settings.ts and lib/ai/prompts/program-score-coverage.md. ' +
      'See docs/superpowers/audits/2026-06-12-reliability-study.md for the baseline study.',
    );
    console.error('');
    process.exit(1);
  }

  console.log('✓ within thresholds — if establishing a new baseline, update LAST_MEASURED in lib/program/reliability-summary.ts');
  console.log('');
  process.exit(0);
}

main().catch(e => {
  console.error('FATAL:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
