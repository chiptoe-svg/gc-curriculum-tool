#!/usr/bin/env tsx
/**
 * Scoring benchmark harness for the agents-vs-single-calls study. Runs the three
 * scoring arms (single, agent, checker) across models x courses x runs, computes
 * code-checked measures, and writes blinded A/B pairs for a judge. Never writes
 * to any database. Campus runs scrub OPENAI_API_KEY at startup so a paid call is
 * impossible; a paid run needs --paid AND --max-credits.
 *
 *   node --import <env preload> tsx scripts/bench/agent-judge.ts --courses "GC 3460" \
 *     --arms single,agent,checker --models qwen3.8-27b-fp8:off --runs 3 --out <dir> [--paid --max-credits 5]
 * with DATABASE_URL pointing at a database whose name contains bench or scratch.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { depthBand } from '@/lib/program/depth-band';
import { evidenceBreaks, findQuote, stability } from './lib/evidence';
import type { ArmName, ArmResult, Cell } from './lib/score-arms';

export interface Key { model: string; arm: string; course: string; run: number }
export const keyId = (k: Key) => `${k.model}|${k.arm}|${k.course}|${k.run}`;

/** Refuse any database whose name lacks bench or scratch (so never gc_curriculum). */
export function assertSafeDb(url: string): void {
  let name = '';
  try { name = decodeURIComponent(new URL(url).pathname.replace(/^\//, '')); } catch { /* fall through */ }
  if (!name || !/bench|scratch/.test(name)) throw new Error('refusing: DATABASE_URL must name a bench or scratch database');
}

/** Throw once spending exceeds the ceiling. A null ceiling means unpaid: nothing to enforce. */
export function checkCreditCeiling(spent: number, max: number | null): void {
  if (max !== null && spent > max) throw new Error(`credit ceiling exceeded: spent ${spent.toFixed(3)} > max ${max}`);
}

export function pendingKeys(all: Key[], done: Iterable<Key | string>): Key[] {
  const d = new Set([...done].map(x => (typeof x === 'string' ? x : keyId(x))));
  return all.filter(k => !d.has(keyId(k)));
}

/** Strict form: without --paid a set OPENAI_API_KEY is an error. */
export function assertNoPaidKey(env: Record<string, string | undefined>, paid: boolean): void {
  if (!paid && env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is set: refusing a free run (use --paid --max-credits, or unset it)');
}
/** What main() does: remove the key for a campus run; returns whether it was present. */
export function scrubPaidKey(env: Record<string, string | undefined>, paid: boolean): boolean {
  if (paid) return false;
  const had = !!env.OPENAI_API_KEY;
  delete env.OPENAI_API_KEY;
  return had;
}
export function assertPaidArgs(paid: boolean, maxCredits: number | null): void {
  if (paid && (maxCredits === null || !(maxCredits > 0))) throw new Error('--paid requires --max-credits <n> (> 0)');
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PairInput { course: string; sub: string; name?: string; baseline: Cell; candidates: Array<{ label: string; cell: Cell }> }
export interface BlindPair { id: string; course: string; competency: string; A: Cell; B: Cell }
export function makeBlindPairs(inputs: PairInput[], seed: number): { pairs: BlindPair[]; key: Record<string, { A: string; B: string }>; seed: number } {
  const rnd = mulberry32(seed);
  const pairs: BlindPair[] = [];
  const key: Record<string, { A: string; B: string }> = {};
  let n = 0;
  for (const p of inputs) for (const c of p.candidates) {
    const id = `pair-${String(++n).padStart(4, '0')}`;
    const flip = rnd() < 0.5;
    pairs.push({ id, course: p.course, competency: p.name ?? p.sub, A: flip ? c.cell : p.baseline, B: flip ? p.baseline : c.cell });
    key[id] = flip ? { A: c.label, B: 'baseline' } : { A: 'baseline', B: c.label };
  }
  return { pairs, key, seed };
}

const band = (v: number | null) => depthBand(v)?.key ?? 'none';
const tripleKey = (c: Cell) => `${band(c.k)}/${band(c.u)}/${band(c.d)}`;
/** The cell from the run whose band triple is most common across runs (first on ties). */
export function modalCell(cells: Cell[]): Cell | undefined {
  const counts = new Map<string, number>();
  for (const c of cells) counts.set(tripleKey(c), (counts.get(tripleKey(c)) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return cells.find(c => tripleKey(c) === best);
}

/** Retry gateway errors (5xx, connection) twice with a pause. Copied from role-judge. */
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

export interface SummaryCase { course: string; subs: string[]; profile: string; runs: Array<{ cells: Cell[]; retrieved: Array<{ id: string; text: string }> }> }
/** Evidence measures. Sources per run = the profile plus the chunks that run itself retrieved. */
export function summarizeArm(cases: SummaryCase[]) {
  let cells = 0, above = 0, breaks = 0, groundedProfile = 0, groundedRetrieved = 0; const stab: number[] = [];
  for (const c of cases) {
    for (const r of c.runs) {
      const profileSrc = [{ id: 'profile', text: c.profile }];
      const sources = [...profileSrc, ...r.retrieved];
      for (const cell of r.cells) {
        cells++;
        if ((cell.k ?? 0) > 1 || (cell.u ?? 0) > 0 || cell.d > 0) {
          above++;
          if (findQuote(cell.excerpt, profileSrc).found) groundedProfile++;
          else if (findQuote(cell.excerpt, sources).found) groundedRetrieved++;
        }
        if (evidenceBreaks(cell, sources).length) breaks++;
      }
    }
    for (const sub of c.subs) {
      const v = c.runs.map(r => r.cells.find(x => x.sub === sub)).filter((x): x is Cell => !!x);
      if (v.length >= 2) stab.push(stability(v));
    }
  }
  return { cells, above, breaks, groundedProfile, groundedRetrieved, stability: stab.length ? stab.reduce((a, b) => a + b, 0) / stab.length : NaN };
}

type StoredCell = Cell & { grounded: boolean };
interface CallRec {
  key: Key; ok: boolean; error?: string; calls?: number; tokens?: ArmResult['tokens']; usdUnits?: number;
  credits?: number | null; ms?: number; retrieved?: Array<{ id: string; text: string }>; uncheckedCells?: number; forcedSubmit?: boolean; toolCalls?: number; cells: StoredCell[];
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const paid = argv.includes('--paid');
  const maxCredits = arg('--max-credits') !== undefined ? Number(arg('--max-credits')) : null;
  assertPaidArgs(paid, maxCredits);
  assertSafeDb(process.env.DATABASE_URL ?? '');
  if (scrubPaidKey(process.env, paid)) console.log('OpenAI key removed for campus run');
  assertNoPaidKey(process.env, paid);
  if (!paid) process.env.AI_PROVIDER = 'campus';

  const out = arg('--out'); if (!out) throw new Error('--out <dir> required');
  const arms = (arg('--arms') ?? 'single,agent,checker').split(',') as ArmName[];
  const models = (arg('--models') ?? '').split(',').filter(Boolean).map(s => { const [id, level] = s.split(':'); return { id: id!, level }; });
  if (!models.length) throw new Error('--models required, e.g. qwen3.8-27b-fp8:off');
  let courses = (arg('--courses') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (!courses.length) throw new Error('--courses required');
  const probe = arg('--cases-probe'); if (probe) courses = courses.slice(0, Number(probe));
  const runs = Number(arg('--runs') ?? 3);
  mkdirSync(out, { recursive: true });

  const [{ and, eq, gte, inArray }, { db }, schema, { getScoringFlags, flagsFor }, { runScoreArm }, { costCredits }] = await Promise.all([
    import('drizzle-orm'), import('@/lib/db/client'), import('@/lib/db/schema'), import('@/lib/db/scoring-flags'),
    import('./lib/score-arms'), import('@/lib/ai/prices'),
  ]);
  void costCredits; // credits come from runPiTask (computed with costCredits); null means unknown.
  const { courseCaptureSnapshots, snapshotCompetencyCoverage, subCompetencies } = schema;
  const SINCE = new Date('2026-10-19T16:33:55Z'); // scorer fix; Sol re-scored after it (as role-judge)

  const cases: Array<{ course: string; snap: { id: string; profile: unknown }; subs: Array<{ id: string; name: string }>; scoreCase: import('./lib/score-arms').ScoreCase; profileText: string; baseline: Cell[] }> = [];
  for (const course of courses) {
    const base = await db.select({ c: snapshotCompetencyCoverage, s: courseCaptureSnapshots }).from(snapshotCompetencyCoverage)
      .innerJoin(courseCaptureSnapshots, eq(courseCaptureSnapshots.id, snapshotCompetencyCoverage.snapshotId))
      .where(and(eq(courseCaptureSnapshots.courseCode, course), gte(snapshotCompetencyCoverage.generatedAt, SINCE)));
    if (!base.length) throw new Error(`no post-fix Sol cells for ${course}`);
    const snap = base.map(b => b.s).sort((a, b) => +b.createdAt - +a.createdAt)[0]!;
    const own = base.filter(b => b.s.id === snap.id);
    const ids = own.map(b => b.c.competencyId);
    const subs = await db.select().from(subCompetencies).where(inArray(subCompetencies.id, ids));
    const flags = await getScoringFlags(ids);
    cases.push({
      course, snap, subs,
      scoreCase: {
        course, snapshotId: snap.id, profile: snap.profile,
        competencies: subs.map(x => ({ id: x.id, name: x.name, knowDescriptor: x.knowDescriptor, understandDescriptor: x.understandDescriptor, doDescriptor: x.doDescriptor, ...flagsFor(flags, x.id) })),
      },
      profileText: JSON.stringify(snap.profile, null, 1),
      baseline: own.map(b => ({ sub: b.c.competencyId, k: b.c.kDepth, u: b.c.uDepth, d: b.c.dDepth, excerpt: b.c.evidenceExcerpt ?? '' } as Cell)),
    });
  }
  const byCourse = new Map(cases.map(c => [c.course, c]));

  const callsPath = join(out, 'calls.json');
  const calls: CallRec[] = existsSync(callsPath) ? JSON.parse(readFileSync(callsPath, 'utf8')).calls : [];
  const checkpoint = () => writeFileSync(callsPath, JSON.stringify({ models, arms, courses, runs, calls }, null, 1));

  const endpointFor = async (m: { id: string; level?: string }) => {
    if (!paid) {
      const baseUrl = process.env.CAMPUS_LLM_BASE_URL?.trim(), apiKey = process.env.CAMPUS_LLM_API_KEY?.trim();
      if (!baseUrl || !apiKey) throw new Error('CAMPUS_LLM_BASE_URL / CAMPUS_LLM_API_KEY not set');
      return { baseUrl, apiKey, model: m.id, api: 'openai-completions' as const, campusReasoning: m.level as import('@/lib/ai/campus').CampusReasoning | undefined };
    }
    const { usesResponsesApi } = await import('@/lib/ai/models');
    const { openAIBaseURL } = await import('@/lib/ai/openai-base-url');
    const apiKey = process.env.OPENAI_API_KEY?.trim(); if (!apiKey) throw new Error('OPENAI_API_KEY not set for --paid');
    return { baseUrl: openAIBaseURL() ?? 'https://api.openai.com/v1', apiKey, model: m.id,
      api: (usesResponsesApi(m.id) ? 'openai-responses' : 'openai-completions') as 'openai-responses' | 'openai-completions',
      reasoning: m.level as 'low' | 'medium' | 'high' | undefined };
  };

  let spent = calls.reduce((s, c) => s + (c.credits ?? 0), 0);
  const all: Key[] = [];
  for (const m of models) for (const arm of arms) for (let run = 1; run <= runs; run++) for (const course of courses) all.push({ model: `${m.id}:${m.level ?? ''}`, arm, course, run });
  const todo = pendingKeys(all, calls.map(c => c.key));
  console.log(`harness: ${all.length} keys, ${todo.length} pending; models ${models.map(m => m.id).join(',')}; ${paid ? 'PAID' : 'campus (free)'}`);

  const execKey = async (k: Key, model: { id: string; level?: string; endpoint: Awaited<ReturnType<typeof endpointFor>> }) => {
    const c = byCourse.get(k.course)!;
    const t0 = Date.now();
    try {
      const r = await withBackoff(() => runScoreArm(k.arm as ArmName, c.scoreCase, model));
      const cells = r.cells.map(x => ({ ...x, grounded: findQuote(x.excerpt, [{ id: 'profile', text: c.profileText }]).found }));
      calls.push({ key: k, ok: true, calls: r.calls, tokens: r.tokens, usdUnits: r.usdUnits, credits: r.credits, ms: r.ms, forcedSubmit: r.forcedSubmit, toolCalls: r.toolCalls, retrieved: r.retrieved, uncheckedCells: r.uncheckedCells, cells });
      if (paid) {
        if (r.credits === null) throw new Error(`arm ${k.arm} returned unknown credits in --paid mode; stopping rather than ignore spend`);
        spent += r.credits; checkCreditCeiling(spent, maxCredits);
      }
      process.stdout.write('.');
    } catch (e) {
      const msg = (e as Error).message;
      if (/credit ceiling|unknown credits/.test(msg)) { checkpoint(); throw e; }
      calls.push({ key: k, ok: false, error: msg.slice(0, 300), ms: Date.now() - t0, cells: [] });
      process.stdout.write('x');
    }
  };

  // Models outer (never interleaved), then arm, run, courses. Only the single arm runs courses in parallel.
  for (const m of models) {
    const model = { ...m, endpoint: await endpointFor(m) };
    const label = `${m.id}:${m.level ?? ''}`;
    for (const arm of arms) for (let run = 1; run <= runs; run++) {
      const batch = todo.filter(k => k.model === label && k.arm === arm && k.run === run);
      if (arm === 'single') await Promise.all(batch.map(k => execKey(k, model)));
      else for (const k of batch) await execKey(k, model);
      checkpoint();
    }
    console.log(` ${label} done`);
  }

  // ---- measures ----
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const f = (x: number, d = 2) => (Number.isNaN(x) ? 'n/a' : x.toFixed(d));
  const rows: string[] = [];
  const pairInputs: PairInput[] = [];
  const measure = (name: string, perCourse: (course: string) => Array<{ cells: Cell[]; retrieved: Array<{ id: string; text: string }> }>, extra: { calls: string; tokens: string; credits: string; spc: string; errors: number; unchecked: string }) => {
    const m = summarizeArm(cases.map(c => ({ course: c.course, subs: c.subs.map(x => x.id), profile: c.profileText, runs: perCourse(c.course) })));
    const share = (n: number) => (m.above ? f(n / m.above) : 'n/a');
    rows.push(`| ${name} | ${m.cells} | ${m.breaks} | ${share(m.groundedProfile)} | ${share(m.groundedRetrieved)} | ${f(m.stability)} | ${extra.calls} | ${extra.tokens} | ${extra.credits} | ${extra.spc} | ${extra.errors} | ${extra.unchecked} |`);
  };
  measure('baseline (stored Sol, post-2026-10-19)', c => [{ cells: byCourse.get(c)!.baseline, retrieved: [] }], { unchecked: '-', calls: '-', tokens: '-', credits: '-', spc: '-', errors: 0 });
  const candidates = new Map<string, Array<{ course: string; sub: string; cell: Cell }>>();
  for (const m of models) for (const arm of arms) {
    const label = `${m.id}:${m.level ?? ''}`;
    const mine = calls.filter(c => c.key.model === label && c.key.arm === arm);
    const ok = mine.filter(c => c.ok);
    const tok = ok.reduce((s, c) => s + (c.tokens ? c.tokens.freshInput + c.tokens.cachedInput + c.tokens.output : 0), 0);
    const cr = ok.map(c => c.credits);
    measure(`${arm} / ${label}`, course => ok.filter(c => c.key.course === course).map(c => ({ cells: c.cells, retrieved: c.retrieved ?? [] })), {
      unchecked: arm === 'checker' ? String(ok.reduce((s, c) => s + (c.uncheckedCells ?? 0), 0)) : '-',
      calls: String(ok.reduce((s, c) => s + (c.calls ?? 0), 0)), tokens: String(tok),
      credits: cr.some(x => x === null) ? 'unknown (single arm has no token telemetry)' : f(cr.reduce((s: number, x) => s + (x ?? 0), 0), 3),
      spc: f(avg(ok.map(c => (c.ms ?? 0) / 1000)), 1), errors: mine.length - ok.length,
    });
    for (const c of cases) for (const sub of c.subs) {
      const cell = modalCell(ok.filter(x => x.key.course === c.course).map(x => x.cells.find(y => y.sub === sub.id)).filter((x): x is StoredCell => !!x));
      if (cell) { const l = `${arm} / ${label}`; (candidates.get(l) ?? candidates.set(l, []).get(l)!).push({ course: c.course, sub: sub.id, cell }); }
    }
  }
  for (const c of cases) for (const sub of c.subs) {
    const b = c.baseline.find(x => x.sub === sub.id); if (!b) continue;
    const cs = [...candidates.entries()].flatMap(([label, xs]) => xs.filter(x => x.course === c.course && x.sub === sub.id).map(x => ({ label, cell: x.cell })));
    if (cs.length) pairInputs.push({ course: c.course, sub: sub.id, name: sub.name, baseline: b, candidates: cs });
  }
  const seed = Number(arg('--seed') ?? 20261122);
  const { pairs, key } = makeBlindPairs(pairInputs, seed);
  writeFileSync(join(out, 'blind-pairs.json'), JSON.stringify({ seed, pairs }, null, 1));
  writeFileSync(join(out, 'blind-key.json'), JSON.stringify({ seed, key }, null, 1));

  const ng = calls.filter(c => c.ok && c.forcedSubmit).length;
  writeFileSync(join(out, 'summary.md'), [
    `# Scoring benchmark summary`, '',
    `Courses: ${courses.join(', ')}; runs: ${runs}; mode: ${paid ? `paid (ceiling ${maxCredits} credits, spent ${spent.toFixed(3)})` : 'campus (free)'}.`, '',
    '| arm / model | cells | evidence breaks | grounded in profile | grounded in retrieved files | stability | calls | tokens | credits | s/course | errors | unchecked (checker) |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|', ...rows, '',
    '## Notes',
    '- Source rule: evidence breaks and grounding use, per arm result, the profile text PLUS every chunk/section that arm itself retrieved for that course (baseline and single: profile only). Grounding is split: found in the profile, else found in a retrieved file; shares are of above-floor cells. Each stored cell in calls.json has `grounded` (found in the profile alone).',
    '- Evidence breaks counts cells with at least one dimension above its floor and no grounded quote.',
    '- Stability: per cell, share of K/U/D whose depth band matches in every run, averaged over cells (needs 2+ runs).',
    '- Unchecked (checker): cells whose checker verdict was missing for a scored dimension; those scores are floored (K1/U0/D0).',
    `- Agent/checker tasks that hit the forced-submit path: ${ng}.`,
    '- Blind pairs: baseline vs each arm x model modal cell (A/B by seeded RNG; seed in blind-pairs.json; key in blind-key.json).', '',
  ].join('\n'));
  console.log(`\nwrote ${out}/summary.md (${pairs.length} blind pairs)`);
  process.exit(0);
}

if (process.argv[1]?.endsWith('agent-judge.ts')) main().catch(e => { console.error(e); process.exit(1); });
