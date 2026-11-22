#!/usr/bin/env tsx
/**
 * Wiki benchmark harness for the agents-vs-single-calls study. Runs the wiki arms (single,
 * agent, checker) across models x pages x runs, measures factual errors, unverifiable
 * statements and wiki-lint errors per page, and writes blinded A/B pairs ({ markdown } only)
 * against the current page in the wiki repo. Generated pages go ONLY to the --out folder: the
 * wiki repo is read (current pages as baseline, a lint copy), never written, and the wiki
 * writer module is not imported.
 *
 * Course pages call ensureCourseSkillEmbeddings (a DB embedding-cache write plus a campus
 * embedding call), so the scratch-only DATABASE_URL guard runs before any app import.
 * Campus runs scrub OPENAI_API_KEY at startup; a paid run needs --paid AND --max-credits.
 *
 *   node --import <env preload> tsx scripts/bench/agent-wiki.ts --pages competencies/problem-solving \
 *     --arms single,agent,checker --models qwen3.8-27b-fp8:off --runs 3 --out <dir> [--paid --max-credits 5]
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { judgeFolderFiles, makePairs, type PairInput } from './lib/blind';
import type { Cell } from './lib/score-arms';
import type { LintIssue } from '@/lib/ai/wiki/lint';
import { assertCanSpend, assertNoPaidKey, assertSafeDb, checkCreditCeiling, parseArms, parseModels, scrubCampusModelEnv, scrubPaidKey, withBackoff } from './agent-judge';

/** The 13 pages of the 2026-11-19 wiki-writer review that the arms can write (its index page is unsupported), plus problem-solving. */
export const WIKI_PAGES: string[] = [
  'competencies/professional-readiness', 'competencies/problem-solving',
  'targets/account-management', 'targets/ai-workflow', 'targets/brand-strategy', 'targets/creative-generalist', 'targets/production-operations',
  'courses/gc-4800', 'courses/gc-3710', 'courses/gc-3800', 'courses/gc-1050', 'courses/gc-1010', 'courses/gc-2070', 'courses/gc-3730',
];

export function parsePages(s: string): string[] {
  const pages = s.split(',').map(x => x.trim()).filter(Boolean);
  if (!pages.length) throw new Error('--pages is empty');
  for (const p of pages) if (!/^(competencies|targets|courses)\/[a-z0-9-]+$/.test(p)) throw new Error(`unsupported page "${p}" (use competencies/*, targets/*, courses/*)`);
  return pages;
}

export interface WikiKey { model: string; arm: string; page: string; run: number }
export const wikiKeyId = (k: WikiKey) => `${k.model}|${k.arm}|${k.page}|${k.run}`;
export function pendingWikiKeys(all: WikiKey[], done: Iterable<WikiKey | string>): WikiKey[] {
  const d = new Set([...done].map(x => (typeof x === 'string' ? x : wikiKeyId(x))));
  return all.filter(k => !d.has(wikiKeyId(k)));
}

/** What the blind judge sees of a page: the markdown and nothing else (no ids, counts, model or arm). */
export function blindWikiCell(markdown: string): Cell {
  return { markdown } as unknown as Cell;
}

/** Lint issues for one page (id like courses/gc-1010) out of a whole-wiki lint. */
export function pageLint(issues: LintIssue[], pageId: string): { errors: number; warnings: number } {
  const mine = issues.filter(i => i.page === `${pageId}.md`);
  return { errors: mine.filter(i => i.severity === 'error').length, warnings: mine.filter(i => i.severity === 'warning').length };
}

export function assertPaidWikiArgs(paid: boolean, maxCredits: number | null): void {
  if (paid && (maxCredits === null || !(maxCredits > 0))) throw new Error('--paid requires --max-credits <n> (> 0)');
}

export const FACTUAL_NOTE = 'Factual errors are not independent for agent/checker arms (they can check drafts against the same function) — blind review decides (ruling R13).';

export interface WikiRun { page: string; ok: boolean; factual?: number; unverifiable?: number; lintErrors?: number }
export function summarizeWikiArm(runs: WikiRun[]) {
  const ok = runs.filter(r => r.ok);
  const per = (f: (r: WikiRun) => number) => (ok.length ? ok.reduce((s, r) => s + f(r), 0) / ok.length : NaN);
  return {
    n: ok.length, errors: runs.length - ok.length,
    factualPerPage: per(r => r.factual ?? 0), unverifiablePerPage: per(r => r.unverifiable ?? 0), lintPerPage: per(r => r.lintErrors ?? 0),
  };
}

export class CallTimeout extends Error {}
/** Stop waiting on one page after ms; the run stops (the call may still be live) and a resume retries the key. */
export function withTimeout<T>(p: Promise<T>, ms: number, k: WikiKey): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([p, new Promise<never>((_, rej) => { t = setTimeout(() => rej(new CallTimeout(`timed out after ${ms / 60000} min: ${wikiKeyId(k)} (run stopped; rerun with the same --out to resume)`)), ms); })]).finally(() => clearTimeout(t));
}

interface CallRec {
  key: WikiKey; ok: boolean; error?: string; markdown?: string; calls?: number; tokens?: unknown; usdUnits?: number; credits?: number | null; ms?: number;
  actualModel?: string; toolCalls?: number; forcedSubmit?: boolean;
  factual?: number; factualDetail?: Array<{ kind: string; detail: string }>; draftErrors?: number; unverifiable?: number; unverifiableDetail?: string[];
  lintErrors?: number; lintWarnings?: number;
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const paid = argv.includes('--paid');
  const maxCredits = arg('--max-credits') !== undefined ? Number(arg('--max-credits')) : null;
  assertSafeDb(process.env.DATABASE_URL ?? ''); // before any import that can touch the database
  if (scrubPaidKey(process.env, paid)) console.log('OpenAI key removed for campus run');
  assertNoPaidKey(process.env, paid);
  const clearedPins = scrubCampusModelEnv(process.env, paid);
  if (clearedPins.length) console.log(`campus run: removed ${clearedPins.join(', ')} so the requested model is used`);
  if (!paid) process.env.AI_PROVIDER = 'campus';

  const out = arg('--out'); if (!out) throw new Error('--out <dir> required');
  const arms = parseArms(arg('--arms') ?? 'single,agent,checker');
  const models = parseModels(arg('--models') ?? '');
  assertPaidWikiArgs(paid, maxCredits);
  const pages = arg('--pages') ? parsePages(arg('--pages')!) : WIKI_PAGES;
  const runs = Number(arg('--runs') ?? 3);
  const callTimeoutMs = Number(arg('--call-timeout-min') ?? 20) * 60_000;
  const wikiRoot = arg('--wiki') ?? join(homedir(), 'projects', 'gc-curriculum-wiki');
  mkdirSync(out, { recursive: true });

  const [{ runWikiArm }, { pageFacts, factualCheck }, { lintWiki }] = await Promise.all([
    import('./lib/wiki-arms'), import('./lib/wiki-facts'), import('@/lib/ai/wiki/lint'),
  ]);

  // Lint runs on a throwaway copy of the wiki's page folders (the repo itself is never touched).
  const lintRoot = mkdtempSync(join(tmpdir(), 'wiki-lint-'));
  for (const d of ['competencies', 'courses', 'targets', 'concepts', 'research']) if (existsSync(join(wikiRoot, d))) cpSync(join(wikiRoot, d), join(lintRoot, d), { recursive: true });
  if (existsSync(join(wikiRoot, 'index.md'))) cpSync(join(wikiRoot, 'index.md'), join(lintRoot, 'index.md'));
  const lintWith = async (pageId: string, markdown: string) => {
    const file = join(lintRoot, `${pageId}.md`);
    const original = existsSync(file) ? readFileSync(file, 'utf8') : null;
    mkdirSync(join(lintRoot, pageId.split('/')[0]!), { recursive: true });
    writeFileSync(file, markdown);
    try { return pageLint(await lintWiki(lintRoot), pageId); } finally { if (original === null) rmSync(file, { force: true }); else writeFileSync(file, original); }
  };

  const facts = new Map<string, Awaited<ReturnType<typeof pageFacts>>>();
  const baseline = new Map<string, string>();
  for (const p of pages) {
    facts.set(p, await pageFacts(p));
    const f = join(wikiRoot, `${p}.md`);
    if (existsSync(f)) baseline.set(p, readFileSync(f, 'utf8'));
  }

  const callsPath = join(out, 'calls.json');
  const calls: CallRec[] = existsSync(callsPath) ? JSON.parse(readFileSync(callsPath, 'utf8')).calls : [];
  const checkpoint = () => writeFileSync(callsPath, JSON.stringify({ models, arms, pages, runs, calls }, null, 1));

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
  const all: WikiKey[] = [];
  for (const m of models) for (const arm of arms) for (let run = 1; run <= runs; run++) for (const page of pages) all.push({ model: `${m.id}:${m.level ?? ''}`, arm, page, run });
  const todo = pendingWikiKeys(all, calls.map(c => c.key));
  console.log(`harness: ${all.length} keys, ${todo.length} pending; models ${models.map(m => m.id).join(',')}; ${paid ? 'PAID' : 'campus (free)'}`);

  const projected = new Map<string, number>();
  const execKey = async (k: WikiKey, model: { id: string; level?: string; endpoint: Awaited<ReturnType<typeof endpointFor>> }) => {
    const t0 = Date.now();
    const pk = `${k.model}|${k.arm}`;
    try {
      if (paid) assertCanSpend(spent, maxCredits!, projected.get(pk) ?? 0);
      const r = await withTimeout(withBackoff(() => runWikiArm(k.arm as 'single' | 'agent' | 'checker', k.page, model), !paid), callTimeoutMs, k); // no retries when paid: a retry may re-bill
      const lint = await lintWith(k.page, r.markdown);
      calls.push({
        key: k, ok: true, markdown: r.markdown, calls: r.calls, tokens: r.tokens, usdUnits: r.usdUnits, credits: r.credits, ms: r.ms,
        actualModel: r.actualModel, toolCalls: r.toolCalls, forcedSubmit: r.forcedSubmit,
        factual: r.factualErrors.length, factualDetail: r.factualErrors, draftErrors: r.draftErrors.length,
        unverifiable: r.unverifiable.length, unverifiableDetail: r.unverifiable, lintErrors: lint.errors, lintWarnings: lint.warnings,
      });
      if (paid) {
        if (r.credits === null) throw new Error(`arm ${k.arm} returned unknown credits in --paid mode; stopping rather than ignore spend`);
        spent += r.credits; projected.set(pk, Math.max(projected.get(pk) ?? 0, r.credits)); checkCreditCeiling(spent, maxCredits);
      }
      process.stdout.write('.'); checkpoint();
    } catch (e) {
      const msg = (e as Error).message;
      if (e instanceof CallTimeout) { checkpoint(); throw e; } // not recorded: a resume retries it; stop because the abandoned call may still be running
      calls.push({ key: k, ok: false, error: msg.slice(0, 300), ms: Date.now() - t0 });
      if (paid) { checkpoint(); throw e; } // a paid failure stops the run
      process.stdout.write('x'); checkpoint();
      console.log(` [${k.arm} ${k.page} run ${k.run}] ${msg.slice(0, 160)}`);
    }
  };

  // Models outer (never interleaved), then arm, run, pages; everything serial (Pi sets a process-wide env key).
  for (const m of models) {
    const model = { ...m, endpoint: await endpointFor(m) };
    const label = `${m.id}:${m.level ?? ''}`;
    for (const arm of arms) for (let run = 1; run <= runs; run++) {
      for (const k of todo.filter(x => x.model === label && x.arm === arm && x.run === run)) await execKey(k, model);
      checkpoint();
    }
    console.log(` ${label} done`);
  }

  // ---- measures ----
  const f = (x: number, d = 2) => (Number.isNaN(x) ? 'n/a' : x.toFixed(d));
  const rows: string[] = [];
  const jsonRows: Array<Record<string, unknown>> = [];
  const baseRuns: WikiRun[] = [];
  for (const p of pages) {
    const md = baseline.get(p);
    if (md === undefined) { baseRuns.push({ page: p, ok: false }); continue; }
    const fc = factualCheck(md, facts.get(p)!);
    baseRuns.push({ page: p, ok: true, factual: fc.errors.length, unverifiable: fc.unverifiable.length, lintErrors: (await lintWith(p, md)).errors });
  }
  const bs = summarizeWikiArm(baseRuns);
  rows.push(`| baseline (current wiki page) | ${bs.n} | ${f(bs.factualPerPage)} | ${f(bs.unverifiablePerPage)} | ${f(bs.lintPerPage)} | - | - | - | ${bs.errors} | - |`);
  jsonRows.push({ label: 'baseline', ...bs });
  const candidates = new Map<string, Map<string, string>>();
  for (const m of models) for (const arm of arms) {
    const label = `${m.id}:${m.level ?? ''}`;
    const mine = calls.filter(c => c.key.model === label && c.key.arm === arm);
    const ok = mine.filter(c => c.ok);
    const s = summarizeWikiArm(mine.map(c => ({ page: c.key.page, ok: c.ok, factual: c.factual, unverifiable: c.unverifiable, lintErrors: c.lintErrors })));
    const cr = ok.map(c => c.credits);
    const credits = cr.some(x => x === null) ? 'unknown' : f(cr.reduce((a: number, x) => a + (x ?? 0), 0), 3);
    const used = [...new Set(ok.map(c => c.actualModel ?? '?'))];
    const expected = arm === 'checker' ? `${m.id}+${m.id}` : m.id;
    const actual = used.length && used.every(u => u === expected) ? used.join(',') : `MISMATCH: ${used.join(',') || 'none'} (requested ${m.id})`;
    const spp = ok.length ? ok.reduce((a, c) => a + (c.ms ?? 0) / 1000, 0) / ok.length : NaN;
    rows.push(`| ${arm} / ${label} | ${s.n} | ${f(s.factualPerPage)} | ${f(s.unverifiablePerPage)} | ${f(s.lintPerPage)} | ${credits} | ${f(spp, 1)} | ${actual} | ${s.errors} | ${arm === 'checker' ? f(ok.length ? ok.reduce((a, c) => a + (c.draftErrors ?? 0), 0) / ok.length : NaN) : '-'} |`);
    jsonRows.push({ label: `${arm} / ${label}`, ...s, credits, actual });
    const byPage = new Map<string, string>();
    for (const c of ok) if (!byPage.has(c.key.page)) byPage.set(c.key.page, c.markdown!); // first successful run per page
    candidates.set(`${arm} / ${label}`, byPage);
  }

  const pairInputs: PairInput[] = [];
  for (const p of pages) {
    const md = baseline.get(p); if (md === undefined) continue;
    const cs = [...candidates.entries()].filter(([, m]) => m.has(p)).map(([label, m]) => ({ label, cell: blindWikiCell(m.get(p)!) }));
    if (cs.length) pairInputs.push({ course: p, sub: p, name: p, baseline: blindWikiCell(md), candidates: cs });
  }
  const seed = Number(arg('--seed') ?? 20261122);
  const { pairs, key } = makePairs(pairInputs, seed);
  mkdirSync(join(out, 'judge'), { recursive: true });
  for (const [name, body] of Object.entries(judgeFolderFiles(pairs, seed))) writeFileSync(join(out, 'judge', name), JSON.stringify(body, null, 1));
  writeFileSync(join(out, 'blind-key.json'), JSON.stringify({ seed, key }, null, 1));
  writeFileSync(join(out, 'summary.json'), JSON.stringify({ rows: jsonRows }, null, 1));
  rmSync(lintRoot, { recursive: true, force: true });

  const ng = calls.filter(c => c.ok && c.forcedSubmit).length;
  writeFileSync(join(out, 'summary.md'), [
    `# Wiki benchmark summary`, '',
    `Pages: ${pages.length}; runs: ${runs}; mode: ${paid ? `paid (ceiling ${maxCredits} credits, spent ${spent.toFixed(3)})` : 'campus (free)'}.`, '',
    '| arm / model | pages written | factual errors / page | unverifiable / page | lint errors / page | credits | s/page | actual model | errors | draft errors / page (checker) |',
    '|---|---|---|---|---|---|---|---|---|---|', ...rows, '',
    '## Notes',
    `- ${FACTUAL_NOTE}`,
    '- Factual errors: counts, course lists and career-target references checked against the database facts (lib/wiki-facts). Unverifiable: "X of Y" statements whose group could not be identified (neither passed nor failed).',
    '- Lint errors: the wiki lint (lib/ai/wiki/lint.ts) run on a temporary copy of the wiki with the candidate page swapped in; only error-severity issues on that page count. Baseline is the current page in the wiki repo against the same database facts.',
    `- Agent/checker tasks that hit the forced-submit path: ${ng}.`,
    '- Blind pairs: current wiki page vs the first successful run of each arm x model, as { markdown } only, shuffled with opaque ids. judge/ holds only pairs.json and pairs-second.json (sealed); the seed and key are in blind-key.json, outside judge/.', '',
  ].join('\n'));
  console.log(`\nwrote ${out}/summary.md (${pairs.length} blind pairs)`);
  process.exit(0);
}

if (process.argv[1]?.endsWith('agent-wiki.ts')) main().catch(e => { console.error(e); process.exit(1); });
