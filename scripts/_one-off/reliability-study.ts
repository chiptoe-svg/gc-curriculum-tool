#!/usr/bin/env tsx
/**
 * A6 Reliability Study — synthesis + coverage scorer variance measurement
 *
 * Run:
 *   pnpm exec tsx --env-file=.env.local scripts/_one-off/reliability-study.ts
 *
 * Safety discipline:
 *   - READ-ONLY against all app tables (no upsertCaptureProfile, no cell writes)
 *   - ONLY permitted write: recordSpend (cost ledger)
 *   - checkDailyCap() before EVERY model call; graceful truncation on cap hit
 *   - Sequential calls (no parallel fan-out)
 *
 * Outputs:
 *   docs/superpowers/audits/2026-06-12-reliability-study.json
 *   docs/superpowers/audits/2026-06-12-reliability-study.md
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { db } from '@/lib/db/client';
import { courses, careerTargets, subCompetencies } from '@/lib/db/schema';
import { eq, asc, isNull } from 'drizzle-orm';

import { getCourseByCode } from '@/lib/db/courses-queries';
import { getCourseProfile } from '@/lib/db/course-profile-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { getCaptureProfileByCourse } from '@/lib/db/course-capture-profiles-queries';
import { getLatestSnapshotByCourse } from '@/lib/db/capture-snapshots-queries';
import { getLatestSessionId, getSessionMessages } from '@/lib/db/capture-messages-queries';
import { getSnapshotById } from '@/lib/db/capture-snapshots-queries';

import { generateCaptureProfileV2 } from '@/lib/ai/analyze/capture-scores';
import { scoreSnapshotAgainstTarget } from '@/lib/ai/analyze/program-score-coverage';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import { depthBand } from '@/lib/program/depth-band';

import type { CaptureProfile } from '@/lib/ai/capture/schema';
import type { CaptureChatContext } from '@/lib/ai/analyze/capture-chat';

// ─── Configuration ───────────────────────────────────────────────────────────

const N_RUNS = 5;
const SYNTHESIS_COURSES = ['GC 3800', 'GC 4060', 'GC 3460'] as const;
const BASELINE_FOUNDATIONALS = [
  'Agency',
  'Attention to Detail',
  'Resilience',
  'Curiosity',
  'Communication',
];
const OUTPUT_DIR = 'docs/superpowers/audits';
const OUTPUT_JSON = path.join(OUTPUT_DIR, '2026-06-12-reliability-study.json');
const OUTPUT_MD = path.join(OUTPUT_DIR, '2026-06-12-reliability-study.md');

// ─── Math helpers ────────────────────────────────────────────────────────────

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : ((sorted[mid - 1]! + sorted[mid]!) / 2);
}

// Tokenize a statement into a set of lowercase alphanumeric tokens
function tokenize(s: string): Set<string> {
  const tokens = s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 2);
  return new Set(tokens);
}

// Jaccard similarity between two token sets
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = [...a].filter(t => b.has(t)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

// Pairwise Jaccard over an array of statements (treat statements as token-set fingerprints)
function pairwiseJaccard(statements: string[]): number {
  if (statements.length < 2) return 1;
  const tokenSets = statements.map(tokenize);
  const pairs: number[] = [];
  for (let i = 0; i < tokenSets.length; i++) {
    for (let j = i + 1; j < tokenSets.length; j++) {
      pairs.push(jaccard(tokenSets[i]!, tokenSets[j]!));
    }
  }
  return mean(pairs);
}

// Match statements across runs using Jaccard > 0.6 threshold
// Returns: for each matched pair, the average delta per dimension
interface MatchedPair {
  statement_a: string;
  statement_b: string;
  jaccard: number;
  runA: number;
  runB: number;
  delta_k: number | null;
  delta_u: number | null;
  delta_d: number;
}

function matchStatements(
  runsProfiles: CaptureProfile[],
  type: 'technical' | 'foundational',
): MatchedPair[] {
  const pairs: MatchedPair[] = [];
  for (let i = 0; i < runsProfiles.length; i++) {
    for (let j = i + 1; j < runsProfiles.length; j++) {
      const compsA = runsProfiles[i]!.competencies.filter(c => c.type === type);
      const compsB = runsProfiles[j]!.competencies.filter(c => c.type === type);
      for (const a of compsA) {
        const tokA = tokenize(a.statement);
        for (const b of compsB) {
          const tokB = tokenize(b.statement);
          const jac = jaccard(tokA, tokB);
          if (jac > 0.6) {
            pairs.push({
              statement_a: a.statement,
              statement_b: b.statement,
              jaccard: jac,
              runA: i,
              runB: j,
              delta_k: (a.k_depth !== null && b.k_depth !== null) ? Math.abs(a.k_depth - b.k_depth) : null,
              delta_u: (a.u_depth !== null && b.u_depth !== null) ? Math.abs(a.u_depth - b.u_depth) : null,
              delta_d: Math.abs(a.d_depth - b.d_depth),
            });
          }
        }
      }
    }
  }
  return pairs;
}

// Band agreement: what % of a set of values all land in the same band
function bandAgreement(values: (number | null)[]): number {
  const nonNull = values.filter((v): v is number => v !== null);
  if (nonNull.length < 2) return 1;
  const bands = nonNull.map(v => depthBand(v)?.key ?? 'none');
  const allSame = bands.every(b => b === bands[0]);
  return allSame ? 1 : 0;
}

function bandAgreementRate(valuesPerRun: (number | null)[][]): number {
  // valuesPerRun: array of runs, each is an array of values
  // We want: per item position, do all runs agree?
  // Actually here: per item index, collect across runs
  if (valuesPerRun.length === 0) return 0;
  const itemCount = valuesPerRun[0]!.length;
  let agree = 0;
  for (let i = 0; i < itemCount; i++) {
    const vals = valuesPerRun.map(run => run[i] ?? null);
    if (bandAgreement(vals) === 1) agree++;
  }
  return itemCount > 0 ? agree / itemCount : 0;
}

// ─── Part 1: Context assembly (mirrors scores route exactly) ─────────────────

async function assembleSynthesisContext(courseCode: string): Promise<{
  context: CaptureChatContext & { sessionId: string; transcript: Awaited<ReturnType<typeof getSessionMessages>> };
  sessionId: string;
}> {
  const course = await getCourseByCode(courseCode);
  if (!course) throw new Error(`Course not found: ${courseCode}`);

  const [builderProfile, materials, priorCapture] = await Promise.all([
    getCourseProfile(courseCode),
    listMaterialsByCourse(courseCode),
    getCaptureProfileByCourse(courseCode),
  ]);

  // Extract prereq codes (same regex as route)
  const COURSE_CODE_RE = /GC\s+\d{4}[a-z]{0,2}/gi;
  function extractPrereqCodes(prerequisites: string, selfCode: string): string[] {
    const codes = (prerequisites.match(COURSE_CODE_RE) ?? [])
      .map((c: string) => c.replace(/\s+/, ' ').toUpperCase().replace(/GC (\d)/, 'GC $1'));
    return Array.from(new Set(codes)).filter(c => c !== selfCode);
  }

  const prereqCodes = extractPrereqCodes(course.prerequisites ?? '', courseCode);
  const prereqProfilesRaw = await Promise.all(
    prereqCodes.map(async (code: string) => {
      const c = await getCourseByCode(code);
      if (!c) return null;
      const snapshot = await getLatestSnapshotByCourse(code);
      if (snapshot) {
        return { code: c.code, title: c.title, profile: snapshot.profile, reviewerStatus: `snapshot ${snapshot.caption ?? snapshot.createdAt.toISOString().slice(0, 10)}` };
      }
      const draft = await getCaptureProfileByCourse(code);
      if (draft) {
        return { code: c.code, title: c.title, profile: draft.profile, reviewerStatus: `draft (${draft.reviewerStatus})` };
      }
      return null;
    }),
  );
  const prerequisiteCaptureProfiles = prereqProfilesRaw.flatMap(p => (p ? [p] : []));

  const context: CaptureChatContext = {
    course: {
      code: course.code,
      title: course.title,
      description: course.description ?? '',
      prerequisites: course.prerequisites ?? '',
      learningObjectives: course.learningObjectives as string[],
      majorProjects: course.majorProjects as string[],
      skillsRequired: course.skillsRequired as string[],
    },
    builderProfile: builderProfile
      ? {
          summary: builderProfile.summary,
          learningObjectives: builderProfile.learningObjectives,
          skills: builderProfile.skills,
          competencies: builderProfile.competencies,
        }
      : null,
    materials: materials
      .filter(m => !m.ignored)
      .map(m => ({
        id: m.id,
        fileName: m.fileName,
        extractionStatus: m.extractionStatus,
        extractedText: m.extractedText,
        digest: m.digest,
        useDigest: m.useDigest,
        ignoredItems: m.ignoredItems,
      })),
    priorCaptureProfile: priorCapture?.profile ?? null,
    prerequisiteCaptureProfiles,
  };

  const sessionId = await getLatestSessionId(courseCode) ?? '';
  const transcript = sessionId ? await getSessionMessages(courseCode, sessionId) : [];

  return { context: { ...context, sessionId, transcript }, sessionId };
}

// ─── Part 1 metrics ──────────────────────────────────────────────────────────

interface Part1CourseResult {
  courseCode: string;
  runs: CaptureProfile[];
  runCosts: number[];
  model: string;
  truncatedAtRun: number | null;
  metrics: {
    technicalCompetencyCount: { perRun: number[]; mean: number; min: number; max: number };
    foundationalDepths: {
      [name: string]: {
        dValues: (number)[];
        mean: number;
        sd: number;
        min: number;
        max: number;
        bandAgreement: number;
      };
    };
    dimensionDepthDistribution: {
      perRun: Array<{ meanK: number; meanU: number; meanD: number }>;
      sdMeanK: number;
      sdMeanU: number;
      sdMeanD: number;
    };
    statementSetStability: {
      meanPairwiseJaccard: number;
      matchedPairs: MatchedPair[];
      matchedPairDeltaMeanK: number | null;
      matchedPairDeltaMeanU: number | null;
      matchedPairDeltaMeanD: number;
      matchedPairDeltaMaxK: number | null;
      matchedPairDeltaMaxU: number | null;
      matchedPairDeltaMaxD: number;
    };
    incomingExpectationsCount: { perRun: number[]; mean: number; min: number; max: number };
  };
}

function computePart1Metrics(courseCode: string, runs: CaptureProfile[], runCosts: number[], model: string, truncatedAtRun: number | null): Part1CourseResult {
  // (a) Technical competency count
  const techCounts = runs.map(r => r.competencies.filter(c => c.type === 'technical').length);

  // (b) Five baseline foundationals — find by name match (case-insensitive prefix)
  const foundationalDepths: Part1CourseResult['metrics']['foundationalDepths'] = {};
  for (const name of BASELINE_FOUNDATIONALS) {
    const dValues: number[] = [];
    for (const run of runs) {
      const comp = run.competencies.find(c =>
        c.type === 'foundational' &&
        c.statement.toLowerCase().includes(name.toLowerCase())
      );
      if (comp) dValues.push(comp.d_depth);
    }
    if (dValues.length > 0) {
      foundationalDepths[name] = {
        dValues,
        mean: mean(dValues),
        sd: sd(dValues),
        min: Math.min(...dValues),
        max: Math.max(...dValues),
        bandAgreement: bandAgreement(dValues),
      };
    } else {
      foundationalDepths[name] = {
        dValues: [],
        mean: 0,
        sd: 0,
        min: 0,
        max: 0,
        bandAgreement: 1,
      };
    }
  }

  // (c) Overall per-dimension depth distribution (mean K/U/D over technical comps)
  const perRunDims = runs.map(run => {
    const techComps = run.competencies.filter(c => c.type === 'technical');
    const kVals = techComps.map(c => c.k_depth).filter((v): v is number => v !== null);
    const uVals = techComps.map(c => c.u_depth).filter((v): v is number => v !== null);
    const dVals = techComps.map(c => c.d_depth);
    return {
      meanK: mean(kVals),
      meanU: mean(uVals),
      meanD: mean(dVals),
    };
  });

  const kMeans = perRunDims.map(d => d.meanK);
  const uMeans = perRunDims.map(d => d.meanU);
  const dMeans = perRunDims.map(d => d.meanD);

  // (d) Statement-set stability
  const allTechStatements = runs.map(r => r.competencies.filter(c => c.type === 'technical').map(c => c.statement));
  const flatAll = allTechStatements.flat();
  const meanPairwiseJaccard = pairwiseJaccard(flatAll);
  const matchedPairs = matchStatements(runs, 'technical');

  const kDeltas = matchedPairs.map(p => p.delta_k).filter((v): v is number => v !== null);
  const uDeltas = matchedPairs.map(p => p.delta_u).filter((v): v is number => v !== null);
  const dDeltas = matchedPairs.map(p => p.delta_d);

  // (e) Incoming expectations count
  const expectCounts = runs.map(r => (r.incoming_expectations ?? []).length);

  return {
    courseCode,
    runs,
    runCosts,
    model,
    truncatedAtRun,
    metrics: {
      technicalCompetencyCount: {
        perRun: techCounts,
        mean: mean(techCounts),
        min: Math.min(...techCounts),
        max: Math.max(...techCounts),
      },
      foundationalDepths,
      dimensionDepthDistribution: {
        perRun: perRunDims,
        sdMeanK: sd(kMeans),
        sdMeanU: sd(uMeans),
        sdMeanD: sd(dMeans),
      },
      statementSetStability: {
        meanPairwiseJaccard,
        matchedPairs,
        matchedPairDeltaMeanK: kDeltas.length > 0 ? mean(kDeltas) : null,
        matchedPairDeltaMeanU: uDeltas.length > 0 ? mean(uDeltas) : null,
        matchedPairDeltaMeanD: mean(dDeltas),
        matchedPairDeltaMaxK: kDeltas.length > 0 ? Math.max(...kDeltas) : null,
        matchedPairDeltaMaxU: uDeltas.length > 0 ? Math.max(...uDeltas) : null,
        matchedPairDeltaMaxD: dDeltas.length > 0 ? Math.max(...dDeltas) : 0,
      },
      incomingExpectationsCount: {
        perRun: expectCounts,
        mean: mean(expectCounts),
        min: Math.min(...expectCounts),
        max: Math.max(...expectCounts),
      },
    },
  };
}

// ─── Part 2: Coverage scorer ──────────────────────────────────────────────────

interface CoverageRunCells {
  [subCompetencyId: string]: {
    k_depth: number | null;
    u_depth: number | null;
    d_depth: number;
  };
}

interface Part2PairResult {
  snapshotId: string;
  courseCode: string;
  careerTargetId: string;
  careerTargetName: string;
  runs: CoverageRunCells[];
  runCosts: number[];
  model: string;
  truncatedAtRun: number | null;
  subCompetencyIds: string[];
  metrics: {
    perCell: {
      [subId: string]: {
        kSd: number | null;
        uSd: number | null;
        dSd: number;
        kMeanAbsDelta: number | null;
        uMeanAbsDelta: number | null;
        dMeanAbsDelta: number;
        kMaxSpread: number | null;
        uMaxSpread: number | null;
        dMaxSpread: number;
        kBandAgreement: number | null;
        uBandAgreement: number;
        dBandAgreement: number;
      };
    };
    pairLevel: {
      kFullBandAgreementPct: number;
      uFullBandAgreementPct: number;
      dFullBandAgreementPct: number;
      kWithin1IntPct: number | null;
      uWithin1IntPct: number | null;
      dWithin1IntPct: number;
    };
  };
}

function computePart2Metrics(
  snapshotId: string,
  courseCode: string,
  careerTargetId: string,
  careerTargetName: string,
  runs: CoverageRunCells[],
  runCosts: number[],
  model: string,
  truncatedAtRun: number | null,
  subIds: string[],
): Part2PairResult {
  const perCell: Part2PairResult['metrics']['perCell'] = {};

  let kBandAgreeCount = 0, uBandAgreeCount = 0, dBandAgreeCount = 0;
  let kWithin1Count = 0, uWithin1Count = 0, dWithin1Count = 0;
  let kNonNullCells = 0, uNonNullCells = 0;
  const totalCells = subIds.length;

  for (const subId of subIds) {
    const kVals = runs.map(r => r[subId]?.k_depth ?? null);
    const uVals = runs.map(r => r[subId]?.u_depth ?? null);
    const dVals = runs.map(r => r[subId]?.d_depth ?? 0);

    const kNonNull = kVals.filter((v): v is number => v !== null);
    const uNonNull = uVals.filter((v): v is number => v !== null);

    // K
    let kSd: number | null = null, kMad: number | null = null, kSpread: number | null = null, kBandAgree: number | null = null;
    if (kNonNull.length >= 2) {
      kSd = sd(kNonNull);
      const kMed = median(kNonNull);
      kMad = mean(kNonNull.map(v => Math.abs(v - kMed)));
      kSpread = Math.max(...kNonNull) - Math.min(...kNonNull);
      kBandAgree = bandAgreement(kNonNull);
      kNonNullCells++;
      if (kBandAgree === 1) kBandAgreeCount++;
      if (kSpread <= 1) kWithin1Count++;
    } else if (kNonNull.length === 1) {
      kSd = 0; kMad = 0; kSpread = 0; kBandAgree = 1;
      kNonNullCells++;
      kBandAgreeCount++;
      kWithin1Count++;
    }

    // U
    let uSd: number | null = null, uMad: number | null = null, uSpread: number | null = null;
    let uBandAgree = 0;
    if (uNonNull.length >= 2) {
      uSd = sd(uNonNull);
      const uMed = median(uNonNull);
      uMad = mean(uNonNull.map(v => Math.abs(v - uMed)));
      uSpread = Math.max(...uNonNull) - Math.min(...uNonNull);
      uBandAgree = bandAgreement(uNonNull);
      uNonNullCells++;
      if (uBandAgree === 1) uBandAgreeCount++;
      if (uSpread <= 1) uWithin1Count++;
    } else if (uNonNull.length === 1) {
      uSd = 0; uMad = 0; uSpread = 0; uBandAgree = 1;
      uNonNullCells++;
      uBandAgreeCount++;
      uWithin1Count++;
    }

    // D (never null)
    const dSd = sd(dVals);
    const dMed = median(dVals);
    const dMad = mean(dVals.map(v => Math.abs(v - dMed)));
    const dSpread = Math.max(...dVals) - Math.min(...dVals);
    const dBandAgree = bandAgreement(dVals);
    if (dBandAgree === 1) dBandAgreeCount++;
    if (dSpread <= 1) dWithin1Count++;

    perCell[subId] = {
      kSd,
      uSd,
      dSd,
      kMeanAbsDelta: kMad,
      uMeanAbsDelta: uMad,
      dMeanAbsDelta: dMad,
      kMaxSpread: kSpread,
      uMaxSpread: uSpread,
      dMaxSpread: dSpread,
      kBandAgreement: kBandAgree,
      uBandAgreement: uBandAgree,
      dBandAgreement: dBandAgree,
    };
  }

  return {
    snapshotId,
    courseCode,
    careerTargetId,
    careerTargetName,
    runs,
    runCosts,
    model,
    truncatedAtRun,
    subCompetencyIds: subIds,
    metrics: {
      perCell,
      pairLevel: {
        kFullBandAgreementPct: kNonNullCells > 0 ? kBandAgreeCount / kNonNullCells : 1,
        uFullBandAgreementPct: uNonNullCells > 0 ? uBandAgreeCount / uNonNullCells : 1,
        dFullBandAgreementPct: totalCells > 0 ? dBandAgreeCount / totalCells : 1,
        kWithin1IntPct: kNonNullCells > 0 ? kWithin1Count / kNonNullCells : null,
        uWithin1IntPct: uNonNullCells > 0 ? uWithin1Count / uNonNullCells : null,
        dWithin1IntPct: totalCells > 0 ? dWithin1Count / totalCells : 1,
      },
    },
  };
}

// ─── Markdown report builder ─────────────────────────────────────────────────

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmt(n: number | null, decimals = 2): string {
  if (n === null) return '—';
  return n.toFixed(decimals);
}

function buildReport(
  part1Results: Part1CourseResult[],
  part2Results: Part2PairResult[],
  totalCostCents: number,
  startedAt: string,
  completedAt: string,
  truncated: boolean,
): string {
  const totalCostUsd = (totalCostCents / 10000).toFixed(4);
  const lines: string[] = [];

  lines.push(`# A6 Reliability Study — Parts i + ii`);
  lines.push(`*Run ${startedAt.slice(0, 10)} | Completed ${completedAt.slice(0, 10)}*`);
  lines.push('');

  if (truncated) {
    lines.push(`> **WARNING: Study was truncated at the daily cost cap.** Not all runs completed. Results below are partial.`);
    lines.push('');
  }

  lines.push(`## Methods`);
  lines.push('');
  lines.push(`**What was held fixed across runs:** identical context object (course catalog row, materials text, prior capture profile, prerequisite capture profiles, latest session ID + full transcript). The only variable is the model's sampling temperature (which the provider does not override — OpenAI default applies).`);
  lines.push('');
  lines.push(`**Read-only discipline:** the script called \`generateCaptureProfileV2\` and \`scoreSnapshotAgainstTarget\` directly (same functions the routes call), but did NOT call \`upsertCaptureProfile\` or \`upsertCoverageCell\`. The only write was \`recordSpend\` to keep the cost ledger honest.`);
  lines.push('');
  lines.push(`**N:** ${N_RUNS} runs per course / per pair.`);
  lines.push('');
  lines.push(`**Courses (Part 1 — synthesis):** ${SYNTHESIS_COURSES.join(', ')}.`);
  lines.push('');

  const p2CoursePairs = part2Results.map(r => `${r.courseCode} × ${r.careerTargetName}`).join(', ');
  lines.push(`**Pairs (Part 2 — coverage scorer):** ${p2CoursePairs || 'none completed'}.`);
  lines.push('');
  lines.push(`**Model:** OpenAI (function-routed via \`AI_PROVIDER=openai\`).`);
  lines.push('');
  lines.push(`**Limitations:** N=5, 3 courses, same-model runs measure *stability* not *validity*. Human-rater Part iii still pending.`);
  lines.push('');
  lines.push(`**Total cost:** \$${totalCostUsd} (${totalCostCents} 1/100-cent units).`);
  lines.push('');

  // ── Part 1 ──
  lines.push(`## Part 1 — Synthesis Stability (N=${N_RUNS} per course)`);
  lines.push('');

  for (const r of part1Results) {
    lines.push(`### ${r.courseCode}${r.truncatedAtRun !== null ? ` *(truncated at run ${r.truncatedAtRun})*` : ''}`);
    lines.push('');
    lines.push(`**Model:** ${r.model}`);
    lines.push('');

    // (a) Technical competency count
    const tc = r.metrics.technicalCompetencyCount;
    lines.push(`**(a) Technical competency count**`);
    lines.push(`| Run | Count |`);
    lines.push(`|-----|-------|`);
    tc.perRun.forEach((n, i) => lines.push(`| ${i + 1} | ${n} |`));
    lines.push(`| **Mean** | **${fmt(tc.mean)}** |`);
    lines.push(`| Range | ${tc.min}–${tc.max} |`);
    lines.push('');

    // (b) Baseline foundationals
    lines.push(`**(b) Baseline foundational competencies — D-depth per run**`);
    lines.push(`| Foundational | Run 1 | Run 2 | Run 3 | Run 4 | Run 5 | Mean | SD | Band Agree |`);
    lines.push(`|---|---|---|---|---|---|---|---|---|`);
    for (const [name, f] of Object.entries(r.metrics.foundationalDepths)) {
      const dRow = Array.from({ length: N_RUNS }, (_, i) => f.dValues[i] !== undefined ? String(f.dValues[i]) : '—').join(' | ');
      lines.push(`| ${name} | ${dRow} | ${fmt(f.mean)} | ${fmt(f.sd)} | ${pct(f.bandAgreement)} |`);
    }
    lines.push('');

    // (c) Per-dimension depth distribution
    lines.push(`**(c) Per-dimension depth distribution (mean K/U/D over technical competencies)**`);
    lines.push(`| Run | Mean K | Mean U | Mean D |`);
    lines.push(`|-----|--------|--------|--------|`);
    r.metrics.dimensionDepthDistribution.perRun.forEach((d, i) =>
      lines.push(`| ${i + 1} | ${fmt(d.meanK)} | ${fmt(d.meanU)} | ${fmt(d.meanD)} |`)
    );
    lines.push(`| **Across-run SD** | **${fmt(r.metrics.dimensionDepthDistribution.sdMeanK)}** | **${fmt(r.metrics.dimensionDepthDistribution.sdMeanU)}** | **${fmt(r.metrics.dimensionDepthDistribution.sdMeanD)}** |`);
    lines.push('');

    // (d) Statement-set stability
    const ss = r.metrics.statementSetStability;
    lines.push(`**(d) Statement-set stability**`);
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Mean pairwise Jaccard (all tech statements) | ${fmt(ss.meanPairwiseJaccard)} |`);
    lines.push(`| Matched pairs (Jaccard > 0.6) | ${ss.matchedPairs.length} |`);
    lines.push(`| Mean \|ΔK\| on matched pairs | ${fmt(ss.matchedPairDeltaMeanK)} |`);
    lines.push(`| Mean \|ΔU\| on matched pairs | ${fmt(ss.matchedPairDeltaMeanU)} |`);
    lines.push(`| Mean \|ΔD\| on matched pairs | ${fmt(ss.matchedPairDeltaMeanD)} |`);
    lines.push(`| Max \|ΔK\| on matched pairs | ${fmt(ss.matchedPairDeltaMaxK)} |`);
    lines.push(`| Max \|ΔU\| on matched pairs | ${fmt(ss.matchedPairDeltaMaxU)} |`);
    lines.push(`| Max \|ΔD\| on matched pairs | ${fmt(ss.matchedPairDeltaMaxD)} |`);
    lines.push('');

    // (e) Incoming expectations count
    const ie = r.metrics.incomingExpectationsCount;
    lines.push(`**(e) Incoming expectations count**`);
    lines.push(`| Run | Count |`);
    lines.push(`|-----|-------|`);
    ie.perRun.forEach((n, i) => lines.push(`| ${i + 1} | ${n} |`));
    lines.push(`| **Mean** | **${fmt(ie.mean)}** | Range ${ie.min}–${ie.max} |`);
    lines.push('');
  }

  // ── Part 2 ──
  lines.push(`## Part 2 — Coverage Scorer Stability (N=${N_RUNS} per pair)`);
  lines.push('');

  if (part2Results.length === 0) {
    lines.push('*No pairs completed (all runs were truncated at the daily cap or no snapshots available).*');
    lines.push('');
  }

  for (const r of part2Results) {
    lines.push(`### ${r.courseCode} × ${r.careerTargetName}${r.truncatedAtRun !== null ? ` *(truncated at run ${r.truncatedAtRun})*` : ''}`);
    lines.push('');
    lines.push(`**Snapshot:** \`${r.snapshotId.slice(0, 8)}\` | **Model:** ${r.model}`);
    lines.push('');

    // Pair-level summary
    const pl = r.metrics.pairLevel;
    lines.push(`**Pair-level summary (${r.subCompetencyIds.length} sub-competencies)**`);
    lines.push(`| Metric | K | U | D |`);
    lines.push(`|--------|---|---|---|`);
    lines.push(`| Full band agreement (all 5 runs same band) | ${pct(pl.kFullBandAgreementPct)} | ${pct(pl.uFullBandAgreementPct)} | ${pct(pl.dFullBandAgreementPct)} |`);
    lines.push(`| Within ±1 integer | ${pl.kWithin1IntPct !== null ? pct(pl.kWithin1IntPct) : '—'} | ${pl.uWithin1IntPct !== null ? pct(pl.uWithin1IntPct) : '—'} | ${pct(pl.dWithin1IntPct)} |`);
    lines.push('');

    // Per-cell table
    lines.push(`**Per sub-competency breakdown**`);
    lines.push(`| Sub-competency ID | K SD | U SD | D SD | K MeanΔ | U MeanΔ | D MeanΔ | K MaxSpread | U MaxSpread | D MaxSpread | K Band% | U Band% | D Band% |`);
    lines.push(`|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
    for (const subId of r.subCompetencyIds) {
      const c = r.metrics.perCell[subId];
      if (!c) continue;
      lines.push(`| ${subId.slice(0, 12)} | ${fmt(c.kSd)} | ${fmt(c.uSd)} | ${fmt(c.dSd)} | ${fmt(c.kMeanAbsDelta)} | ${fmt(c.uMeanAbsDelta)} | ${fmt(c.dMeanAbsDelta)} | ${fmt(c.kMaxSpread, 0)} | ${fmt(c.uMaxSpread, 0)} | ${fmt(c.dMaxSpread, 0)} | ${c.kBandAgreement !== null ? pct(c.kBandAgreement) : '—'} | ${pct(c.uBandAgreement)} | ${pct(c.dBandAgreement)} |`);
    }
    lines.push('');
  }

  // ── Findings ──
  lines.push(`## Findings`);
  lines.push('');

  // Aggregate across Part 1
  const allSdK = part1Results.map(r => r.metrics.dimensionDepthDistribution.sdMeanK);
  const allSdU = part1Results.map(r => r.metrics.dimensionDepthDistribution.sdMeanU);
  const allSdD = part1Results.map(r => r.metrics.dimensionDepthDistribution.sdMeanD);
  const typicalSdK = mean(allSdK);
  const typicalSdU = mean(allSdU);
  const typicalSdD = mean(allSdD);

  const foundBandAgreements: number[] = [];
  for (const r of part1Results) {
    for (const [, f] of Object.entries(r.metrics.foundationalDepths)) {
      if (f.dValues.length >= 2) foundBandAgreements.push(f.bandAgreement);
    }
  }
  const foundBandAgreePct = foundBandAgreements.length > 0 ? mean(foundBandAgreements) : null;

  // Aggregate Part 2
  const allCellBandAgreeD: number[] = [];
  const allCellBandAgreeK: number[] = [];
  const allCellBandAgreeU: number[] = [];
  for (const r of part2Results) {
    allCellBandAgreeD.push(r.metrics.pairLevel.dFullBandAgreementPct);
    allCellBandAgreeK.push(r.metrics.pairLevel.kFullBandAgreementPct);
    allCellBandAgreeU.push(r.metrics.pairLevel.uFullBandAgreementPct);
  }
  const avgCellBandAgreeD = allCellBandAgreeD.length > 0 ? mean(allCellBandAgreeD) : null;
  const avgCellBandAgreeK = allCellBandAgreeK.length > 0 ? mean(allCellBandAgreeK) : null;
  const avgCellBandAgreeU = allCellBandAgreeU.length > 0 ? mean(allCellBandAgreeU) : null;

  lines.push(`### Part 1 — Synthesis stability`);
  lines.push('');
  lines.push(`**Per-dimension SD of run-means** (typical across ${part1Results.length} courses):`);
  lines.push(`- K: ${fmt(typicalSdK)}`);
  lines.push(`- U: ${fmt(typicalSdU)}`);
  lines.push(`- D: ${fmt(typicalSdD)}`);
  lines.push('');
  lines.push(`**Foundational band agreement** (D-depth, all five baseline foundationals matched by name): ${foundBandAgreePct !== null ? pct(foundBandAgreePct) : '—'}`);
  lines.push('');

  lines.push(`### Part 2 — Coverage scorer stability`);
  lines.push('');
  if (avgCellBandAgreeD !== null) {
    lines.push(`**Mean full-band-agreement across ${part2Results.length} pair(s):**`);
    lines.push(`- K: ${avgCellBandAgreeK !== null ? pct(avgCellBandAgreeK) : '—'}`);
    lines.push(`- U: ${avgCellBandAgreeU !== null ? pct(avgCellBandAgreeU) : '—'}`);
    lines.push(`- D: ${pct(avgCellBandAgreeD)}`);
  } else {
    lines.push(`*Part 2 data not available (truncated or no qualifying snapshots).*`);
  }
  lines.push('');

  lines.push(`### A7 bands-default assessment`);
  lines.push('');
  if (avgCellBandAgreeD !== null) {
    const highBandAgreement = avgCellBandAgreeD >= 0.7;
    const within1D = mean(part2Results.map(r => r.metrics.pairLevel.dWithin1IntPct));
    if (highBandAgreement && within1D >= 0.8) {
      lines.push(`Band agreement is high (D: ${pct(avgCellBandAgreeD)}) AND within-±1 agreement is also high (D: ${pct(within1D)}). **Integers appear defensible** — bands default is conservative but justified as the default pending faculty-rater Part iii. No cause to revert.`);
    } else if (highBandAgreement) {
      lines.push(`Band agreement is high (D: ${pct(avgCellBandAgreeD)}) while within-±1 agreement is lower (D: ${pct(within1D)}). **Bands default is directly justified**: the instrument reliably supports band-level conclusions; bare-integer display would overstate precision. Consistent with A7 design rationale.`);
    } else {
      lines.push(`**WARNING:** Band agreement is LOW (D: ${pct(avgCellBandAgreeD)}). The instrument is more variable than the A7 default assumes. Flag for operator review before any program-level conclusions are drawn.`);
    }
  } else {
    lines.push(`*Part 2 data insufficient to assess A7 bands-default. Defer to Part iii (faculty raters).*`);
  }
  lines.push('');

  lines.push(`### Caveats`);
  lines.push('');
  lines.push(`- N=5 is a minimum viability threshold; formal reliability benchmarks (Krippendorff α ≥ 0.70) require Part iii (human raters).`);
  lines.push(`- Same-model replications measure *stability*, not *validity*. A consistently wrong model looks stable.`);
  lines.push(`- All 3 courses used v1-era snapshots and confirmed profiles. The synthesis context may include legacy v1 material.`);
  lines.push(`- Faculty-rater Part iii (human–AI agreement, target α ≥ 0.70/dimension) remains the load-bearing validity test.`);
  lines.push('');

  lines.push(`---`);
  lines.push(`*Generated ${completedAt} | Total cost: \$${totalCostUsd}*`);
  lines.push('');

  return lines.join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`=== A6 Reliability Study — ${startedAt.slice(0, 19)} ===\n`);

  let totalCostCents = 0;
  let truncatedGlobally = false;

  // ── Part 1 ─────────────────────────────────────────────────────────────────
  console.log('--- PART 1: Synthesis stability ---\n');
  const part1Results: Part1CourseResult[] = [];

  for (const courseCode of SYNTHESIS_COURSES) {
    if (truncatedGlobally) {
      console.log(`  Skipping ${courseCode} (globally truncated at cap)`);
      continue;
    }
    console.log(`\n[${courseCode}] Assembling context...`);
    const { context, sessionId } = await assembleSynthesisContext(courseCode);
    console.log(`  sessionId=${sessionId.slice(0, 8)}, transcript=${context.transcript.length} msgs, materials=${context.materials.length}, prereqs=${context.prerequisiteCaptureProfiles.length}`);

    const runs: CaptureProfile[] = [];
    const runCosts: number[] = [];
    let truncatedAtRun: number | null = null;
    let runModel = 'unknown';

    for (let i = 0; i < N_RUNS; i++) {
      // Check cap before each call
      const cap = await checkDailyCap();
      if (!cap.ok) {
        console.log(`  ⚠ Daily cap hit before run ${i + 1}. Stopping. Spent: ${cap.spentCents}`);
        truncatedAtRun = i;
        truncatedGlobally = true;
        break;
      }

      console.log(`  Run ${i + 1}/${N_RUNS}...`);
      const t0 = Date.now();
      try {
        const result = await generateCaptureProfileV2({
          chatContext: context,
          sessionId: context.sessionId,
          transcript: context.transcript,
        });
        const costCents = result.telemetry.costUsdCents;
        await recordSpend(costCents);
        totalCostCents += costCents;
        runs.push(result.profile);
        runCosts.push(costCents);
        runModel = result.model;
        const techCount = result.profile.competencies.filter(c => c.type === 'technical').length;
        console.log(`    done in ${Date.now() - t0}ms, cost=${costCents} 1/100¢, model=${result.model}, techComps=${techCount}`);
      } catch (err) {
        console.error(`    Run ${i + 1} FAILED:`, err instanceof Error ? err.message : err);
        // Skip this run, continue
      }
    }

    if (runs.length >= 2) {
      const result = computePart1Metrics(courseCode, runs, runCosts, runModel, truncatedAtRun);
      part1Results.push(result);
      console.log(`  [${courseCode}] Metrics computed. Tech comp mean=${result.metrics.technicalCompetencyCount.mean.toFixed(1)}, D-SD=${result.metrics.dimensionDepthDistribution.sdMeanD.toFixed(2)}`);
    } else if (runs.length === 1) {
      // Partial: just store the raw run with minimal metrics
      console.log(`  [${courseCode}] Only 1 run completed (need 2+ for metrics).`);
      const result = computePart1Metrics(courseCode, runs, runCosts, runModel, truncatedAtRun);
      part1Results.push(result);
    } else {
      console.log(`  [${courseCode}] No runs completed.`);
    }
  }

  // ── Part 2 ─────────────────────────────────────────────────────────────────
  console.log('\n--- PART 2: Coverage scorer stability ---\n');
  const part2Results: Part2PairResult[] = [];

  // Find GC 3800's latest non-retired snapshot (only course with snapshot)
  const snap3800 = await getLatestSnapshotByCourse('GC 3800');
  if (!snap3800) {
    console.log('  No snapshot for GC 3800. Trying GC 3460...');
  }

  // Pick the first two career targets by displayOrder
  const allTargets = await db.select({
    id: careerTargets.id,
    name: careerTargets.name,
    displayOrder: careerTargets.displayOrder,
    shortDefinition: careerTargets.shortDefinition,
    knowDescriptors: careerTargets.knowDescriptors,
    understandDescriptors: careerTargets.understandDescriptors,
    doDescriptors: careerTargets.doDescriptors,
  }).from(careerTargets).orderBy(asc(careerTargets.displayOrder));

  const firstTwoTargets = allTargets.slice(0, 2);

  // Find a snapshot to use — prefer GC 3800, fall back to GC 3460
  let studySnapshot = snap3800;
  let studyCourseCode = 'GC 3800';
  if (!studySnapshot) {
    studySnapshot = await getLatestSnapshotByCourse('GC 3460');
    studyCourseCode = 'GC 3460';
  }

  if (!studySnapshot) {
    console.log('  No suitable snapshot found for Part 2. Skipping.');
  } else {
    console.log(`  Using snapshot ${studySnapshot.id.slice(0, 8)} (${studyCourseCode})`);

    for (const target of firstTwoTargets) {
      if (truncatedGlobally) {
        console.log(`  Skipping target "${target.name}" (globally truncated)`);
        continue;
      }

      // Get sub-competencies for this target
      const subs = await db.select({
        id: subCompetencies.id,
        name: subCompetencies.name,
        knowDescriptor: subCompetencies.knowDescriptor,
        understandDescriptor: subCompetencies.understandDescriptor,
        doDescriptor: subCompetencies.doDescriptor,
        displayOrder: subCompetencies.displayOrder,
        retired: subCompetencies.retired,
      }).from(subCompetencies).where(eq(subCompetencies.careerTargetId, target.id)).orderBy(asc(subCompetencies.displayOrder));

      const activeSubs = subs.filter(s => !s.retired);
      console.log(`\n  Target: "${target.name}" (${activeSubs.length} active sub-comps)`);

      const coverageRuns: CoverageRunCells[] = [];
      const runCosts: number[] = [];
      let truncatedAtRun: number | null = null;
      let runModel = 'unknown';

      for (let i = 0; i < N_RUNS; i++) {
        const cap = await checkDailyCap();
        if (!cap.ok) {
          console.log(`    ⚠ Daily cap hit before coverage run ${i + 1}. Stopping.`);
          truncatedAtRun = i;
          truncatedGlobally = true;
          break;
        }

        console.log(`    Coverage run ${i + 1}/${N_RUNS}...`);
        const t0 = Date.now();
        try {
          const { result, model, costUsdCents } = await scoreSnapshotAgainstTarget({
            snapshotId: studySnapshot!.id,
            courseCode: studyCourseCode,
            snapshotProfile: studySnapshot!.profile,
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

          // Convert to keyed map
          const cellMap: CoverageRunCells = {};
          for (const cell of result.cells) {
            cellMap[cell.sub_competency_id] = {
              k_depth: cell.k_depth,
              u_depth: cell.u_depth,
              d_depth: cell.d_depth,
            };
          }
          coverageRuns.push(cellMap);
          runCosts.push(costUsdCents);
          runModel = model;
          console.log(`      done in ${Date.now() - t0}ms, cost=${costUsdCents} 1/100¢, cells=${result.cells.length}`);
        } catch (err) {
          console.error(`      Coverage run ${i + 1} FAILED:`, err instanceof Error ? err.message : err);
        }
      }

      if (coverageRuns.length >= 1) {
        const subIds = activeSubs.map(s => s.id);
        const result = computePart2Metrics(
          studySnapshot!.id,
          studyCourseCode,
          target.id,
          target.name,
          coverageRuns,
          runCosts,
          runModel,
          truncatedAtRun,
          subIds,
        );
        part2Results.push(result);
        console.log(`  Pair computed. D band-agreement: ${pct(result.metrics.pairLevel.dFullBandAgreementPct)}`);
      }
    }
  }

  const completedAt = new Date().toISOString();
  const totalCostUsd = (totalCostCents / 10000).toFixed(4);
  console.log(`\n=== Study complete. Total cost: $${totalCostUsd} (${totalCostCents} 1/100¢) ===`);

  // ── Serialize outputs ───────────────────────────────────────────────────────
  const jsonOutput = {
    meta: {
      study: 'A6 reliability study — parts i (synthesis) + ii (coverage)',
      startedAt,
      completedAt,
      totalCostUsdCents: totalCostCents,
      totalCostUsd: parseFloat(totalCostUsd),
      truncatedAtCap: truncatedGlobally,
      N: N_RUNS,
      synthesisCourses: SYNTHESIS_COURSES,
    },
    part1: part1Results.map(r => ({
      courseCode: r.courseCode,
      model: r.model,
      truncatedAtRun: r.truncatedAtRun,
      runCosts: r.runCosts,
      runs: r.runs.map(p => ({
        technicalCompetencies: p.competencies.filter(c => c.type === 'technical').map(c => ({
          statement: c.statement,
          k_depth: c.k_depth,
          u_depth: c.u_depth,
          d_depth: c.d_depth,
        })),
        foundationalCompetencies: p.competencies.filter(c => c.type === 'foundational').map(c => ({
          statement: c.statement,
          d_depth: c.d_depth,
        })),
        incomingExpectationsCount: (p.incoming_expectations ?? []).length,
      })),
      metrics: r.metrics,
    })),
    part2: part2Results.map(r => ({
      snapshotId: r.snapshotId,
      courseCode: r.courseCode,
      careerTargetId: r.careerTargetId,
      careerTargetName: r.careerTargetName,
      model: r.model,
      truncatedAtRun: r.truncatedAtRun,
      runCosts: r.runCosts,
      subCompetencyIds: r.subCompetencyIds,
      runs: r.runs,
      metrics: r.metrics,
    })),
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(jsonOutput, null, 2), 'utf-8');
  console.log(`\nWrote: ${OUTPUT_JSON}`);

  const report = buildReport(part1Results, part2Results, totalCostCents, startedAt, completedAt, truncatedGlobally);
  fs.writeFileSync(OUTPUT_MD, report, 'utf-8');
  console.log(`Wrote: ${OUTPUT_MD}`);

  // ── Summary to stdout ───────────────────────────────────────────────────────
  console.log('\n=== SUMMARY ===');
  console.log(`Total cost: $${totalCostUsd}`);
  console.log(`Truncated: ${truncatedGlobally}`);
  for (const r of part1Results) {
    const d = r.metrics.dimensionDepthDistribution;
    const foundAgree = Object.values(r.metrics.foundationalDepths)
      .filter(f => f.dValues.length >= 2)
      .map(f => f.bandAgreement);
    const foundAgreePct = foundAgree.length > 0 ? (foundAgree.filter(a => a === 1).length / foundAgree.length) : null;
    console.log(`[${r.courseCode}] SD K=${d.sdMeanK.toFixed(2)} U=${d.sdMeanU.toFixed(2)} D=${d.sdMeanD.toFixed(2)} | Foundational band-agree: ${foundAgreePct !== null ? pct(foundAgreePct) : '—'}`);
  }
  for (const r of part2Results) {
    const pl = r.metrics.pairLevel;
    console.log(`[${r.courseCode}×${r.careerTargetName}] Band-agree K=${pct(pl.kFullBandAgreementPct)} U=${pct(pl.uFullBandAgreementPct)} D=${pct(pl.dFullBandAgreementPct)}`);
  }

  process.exit(0);
}

main().catch(e => {
  console.error('FATAL:', e instanceof Error ? e.message : e);
  process.exit(1);
});
