#!/usr/bin/env tsx
/**
 * Interview benchmark (owner, 2026-10-27): does the CourseCapture interviewer
 * search the course files and cite them when the files answer the question,
 * and at what cost? Re-runs fixed moments from real interviews
 * (interview-bench-cases.json) under one or more model settings, with the
 * production prompt and production context, and prints one row per setting.
 *
 * Why: at low effort gpt-6.1-sol searched at 0 of 3 moments where the instructor
 * pointed at a rubric or brief; at medium it searched and cited at 3 of 3
 * (2026-10-27 replays). Model changes for the Converse role (e.g. gpt-6.1-terra
 * once the campus gateway serves it) should be run through this first.
 *
 * Measures, per setting:
 *   files cases       — share with a material search, share citing a passage
 *   instructor cases  — share with a search (optional there; reported, not scored)
 *   tokens in/out, cached share, cost (the provider's estimate), seconds per turn
 * The interviewer's questions are written to --out for a person to read:
 * citing more must not mean asking worse questions.
 *
 * SCRATCH ONLY: each case copies its session's history into a temporary
 * session in capture_messages and deletes it afterwards. Refuses any database
 * whose name lacks "scratch". Run from the deploy checkout so its env loads.
 *
 * Usage:
 *   DATABASE_URL=postgresql://admin@127.0.0.1:5433/gc_curriculum_p2_scratch \
 *   node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs scripts/capture/interview-bench.ts \
 *     --expect-db gc_curriculum_p2_scratch \
 *     [--configs gpt-6.1-sol:medium,gpt-6.1-terra:low]   # default: the interviewer's current setting
 *     [--quick | --cases 2070-088,1020-016] [--view index|digests] [--dry] [--out results.json]
 *
 * Cost: every case is one model call over ~30-100k tokens, two when it searches.
 * The full set is 9 cases; --quick is 4. Settings run one after another (all
 * cases for one setting, then the next), never interleaved.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { and, asc, eq, inArray, like, lt, sql } from 'drizzle-orm';
import type { AuditResponse } from '@/lib/ai/agent/audit-response-schema';
import { loadAppEnv, isMainModule } from '@/scripts/catalog/catalog-source';
// App modules are imported inside main(), AFTER loadAppEnv(): @ai-sdk/openai's
// default provider reads OPENAI_BASE_URL when it is first imported, so a static
// import sent every call to api.openai.com instead of the campus gateway.

export interface BenchCase {
  id: string;
  course: string;
  session: string;
  turn: number;
  kind: 'files' | 'instructor';
  quick: boolean;
  note: string;
}

export interface BenchConfig { model?: string; effort?: string; label: string }

export interface CaseResult {
  caseId: string;
  kind: BenchCase['kind'];
  materialToolCalls: number;
  otherToolCalls: number;
  chunkCitations: number;
  instructorCitations: number;
  question: string;
  costUsdCents: number;
  uncachedPromptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  durationMs: number;
  /** Of uncachedPromptTokens, the part the provider wrote to its prompt cache (reported separately for credit budgeting). */
  cacheWriteTokens?: number;
  /** Citations naming a passage not retrieved this turn or cited earlier, or a message id not in the conversation. */
  badCitations?: number;
  /** Harness spike: what the controls did (pi/codex loops only). */
  controlEvents?: string[];
  requests?: number;
  error?: string;
}

export interface ConfigSummary {
  label: string;
  filesCases: number;
  filesSearched: number;
  filesCited: number;
  instructorCases: number;
  instructorSearched: number;
  tokensIn: number;
  cachedShare: number;
  tokensOut: number;
  costUsdCents: number;
  secondsPerTurn: number;
  errors: number;
}

const MATERIAL_TOOLS = new Set(['search_materials', 'fetch_material_section', 'list_materials']);

export function loadCases(file = path.join(process.cwd(), 'scripts/capture/interview-bench-cases.json')): BenchCase[] {
  return (JSON.parse(readFileSync(file, 'utf8')) as { cases: BenchCase[] }).cases;
}

/** "gpt-6.1-sol:medium,gpt-6.1-terra" → configs; no flag → the interviewer's current setting. */
export function parseConfigs(spec: string | undefined): BenchConfig[] {
  if (!spec) return [{ label: 'current setting' }];
  return spec.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const [model, effort] = s.split(':');
    return { model, effort: effort || undefined, label: effort ? `${model} ${effort}` : `${model} (model default effort)` };
  });
}

export function selectCases(all: BenchCase[], opts: { quick?: boolean; ids?: string[] }): BenchCase[] {
  if (opts.ids?.length) {
    const unknown = opts.ids.filter(id => !all.some(c => c.id === id));
    if (unknown.length) throw new Error(`unknown case id(s): ${unknown.join(', ')}`);
    return all.filter(c => opts.ids!.includes(c.id));
  }
  return opts.quick ? all.filter(c => c.quick) : all;
}

/** For each interviewer turn to regenerate, the instructor turn just before it. */
export function userTurnsBefore<T extends { role: string; turnIndex: number; content: string | null }>(session: T[], interviewerTurns: number[]): T[] {
  return interviewerTurns.map(t => {
    const u = session.find(r => r.turnIndex === t - 1);
    if (!u || u.role !== 'user' || !u.content) throw new Error(`turn ${t - 1} is not an instructor turn; pick an interviewer turn that follows one`);
    return u;
  });
}

export function summarize(label: string, results: CaseResult[]): ConfigSummary {
  const ok = results.filter(r => !r.error);
  const files = ok.filter(r => r.kind === 'files');
  const instr = ok.filter(r => r.kind === 'instructor');
  const sum = (f: (r: CaseResult) => number) => ok.reduce((n, r) => n + f(r), 0);
  const tokensIn = sum(r => r.uncachedPromptTokens + r.cachedTokens);
  return {
    label,
    filesCases: files.length,
    filesSearched: files.filter(r => r.materialToolCalls > 0).length,
    filesCited: files.filter(r => r.chunkCitations > 0).length,
    instructorCases: instr.length,
    instructorSearched: instr.filter(r => r.materialToolCalls > 0).length,
    tokensIn,
    cachedShare: tokensIn ? sum(r => r.cachedTokens) / tokensIn : 0,
    tokensOut: sum(r => r.completionTokens),
    costUsdCents: sum(r => r.costUsdCents),
    secondsPerTurn: ok.length ? sum(r => r.durationMs) / ok.length / 1000 : 0,
    errors: results.length - ok.length,
  };
}

export function renderTable(rows: ConfigSummary[]): string {
  const head = '| Setting | Files cases: searched | Files cases: cited a file | Instructor cases: searched | Tokens in (cached) | Tokens out | Cost est. | s/turn | Errors |';
  const sep = '|---|---|---|---|---|---|---|---|---|';
  const body = rows.map(r =>
    `| ${r.label} | ${r.filesSearched}/${r.filesCases} | ${r.filesCited}/${r.filesCases} | ${r.instructorSearched}/${r.instructorCases} | ${r.tokensIn.toLocaleString('en-US')} (${Math.round(r.cachedShare * 100)}%) | ${r.tokensOut.toLocaleString('en-US')} | $${(r.costUsdCents / 100).toFixed(2)} | ${r.secondsPerTurn.toFixed(1)} | ${r.errors} |`);
  return [head, sep, ...body].join('\n');
}

export async function main(argv: string[]): Promise<number> {
  const arg = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const expectDb = arg('--expect-db');
  if (!expectDb) { console.error('usage: --expect-db <scratch db> [--configs model:effort,...] [--quick | --cases id,id] [--view index|digests] [--dry] [--out file]'); return 2; }
  if (!expectDb.includes('scratch')) { console.error('refusing: the benchmark writes temporary rows and runs only against a scratch database'); return 2; }
  // --endpoint campus: send model calls to the RCD campus path (/v1), where the free
  // hosted models such as glm-5.3 live, instead of the OpenAI proxy (/openai/v1).
  // Set before the app modules are imported below, which read OPENAI_BASE_URL on import.
  const endpoint = arg('--endpoint');
  if (endpoint && endpoint !== 'campus') { console.error('--endpoint must be campus'); return 2; }
  if (endpoint === 'campus') {
    if (!process.env.CAMPUS_LLM_BASE_URL || !process.env.CAMPUS_LLM_API_KEY) { console.error('CAMPUS_LLM_BASE_URL / CAMPUS_LLM_API_KEY not set'); return 2; }
    process.env.OPENAI_BASE_URL = process.env.CAMPUS_LLM_BASE_URL;
    process.env.OPENAI_API_KEY = process.env.CAMPUS_LLM_API_KEY;
  }
  // --loop: which engine runs the interviewer turn (harness spike, 2026-10-28).
  //   vercel (default) = the live loop; pi = pi-agent-core in-process; codex = codex exec + MCP.
  // --controls: turn on the deterministic checks in the pi/codex loops (lib/ai/agent/harness/controls.ts).
  const loop = (arg('--loop') ?? 'vercel') as 'vercel' | 'pi' | 'codex';
  if (!['vercel', 'pi', 'codex'].includes(loop)) { console.error('--loop must be vercel, pi or codex'); return 2; }
  const controls = argv.includes('--controls');
  const view = arg('--view') as 'index' | 'digests' | undefined;
  if (view && view !== 'index' && view !== 'digests') { console.error('--view must be index or digests'); return 2; }

  const { db } = await import('@/lib/db/client');
  const { captureMessages } = await import('@/lib/db/schema');
  const { buildAgentCall } = await import('@/lib/ai/agent/audit-agent');
  const { getProviderForFunction } = await import('@/lib/ai/provider');
  const { AuditResponseJsonSchema, AuditResponseSchema } = await import('@/lib/ai/agent/audit-response-schema');
  const { formatDbError, assertExpectedDb } = await import('@/scripts/catalog/catalog-source');
  try { await assertExpectedDb(expectDb); } catch (err) { console.error(formatDbError(err)); return 1; }

  let cases: BenchCase[];
  try { cases = selectCases(loadCases(), { quick: argv.includes('--quick'), ids: arg('--cases')?.split(',') }); }
  catch (err) { console.error(err instanceof Error ? err.message : String(err)); return 2; }
  const configs = parseConfigs(arg('--configs'));
  console.log(`${cases.length} case(s) × ${configs.length} setting(s): ${configs.map(c => c.label).join('; ')}`);

  /** Copy the case's history into a temporary session and build the interviewer call for it. */
  async function prepare(c: BenchCase) {
    const all = await db.select().from(captureMessages)
      .where(and(eq(captureMessages.courseCode, c.course), like(sql`${captureMessages.sessionId}::text`, `${c.session}%`)))
      .orderBy(asc(captureMessages.turnIndex));
    if (!all.length) throw new Error(`${c.id}: no session ${c.session} for ${c.course} in this database`);
    const [pick] = userTurnsBefore(all, [c.turn]);
    const tempSession = randomUUID();
    const history = all.filter(h => h.turnIndex < pick!.turnIndex);
    if (history.length) await db.insert(captureMessages).values(history.map(h => ({ ...h, id: randomUUID(), sessionId: tempSession })));
    const built = await buildAgentCall({
      sessionId: tempSession, courseCode: c.course, userMessage: pick!.content!, auditMode: 'full', includePriorSessions: false,
      ...(view ? { materialsView: view } : {}),
    });
    const { listMaterialsByCourse } = await import('@/lib/db/course-materials-queries');
    const fileNames = (await listMaterialsByCourse(c.course)).filter(m => !m.ignored && m.extractionStatus === 'ok').map(m => m.fileName);
    return { tempSession, built, userMessage: pick!.content!, fileNames };
  }

  async function runCase(c: BenchCase, cfg: BenchConfig): Promise<CaseResult> {
    const empty = { caseId: c.id, kind: c.kind, materialToolCalls: 0, otherToolCalls: 0, chunkCitations: 0, instructorCitations: 0, question: '', costUsdCents: 0, uncachedPromptTokens: 0, cachedTokens: 0, completionTokens: 0, durationMs: 0 };
    let tempSession: string | undefined;
    try {
      const prepared = await prepare(c);
      tempSession = prepared.tempSession;
      const { built, userMessage, fileNames } = prepared;
      // Record every chunk the tools return, whichever loop calls them, to score citations the same way.
      const { chunkIdsInToolResult, checkCitations, citableFromHistory } = await import('@/lib/ai/agent/harness/controls');
      const retrieved = new Set<string>();
      const tools = built.tools.map(t => ({ ...t, execute: async (a: unknown) => { const r = await t.execute(a); chunkIdsInToolResult(r, retrieved); return r; } }));
      const history = citableFromHistory(built.messages as Array<{ role: string; content: string | null }>);
      if (argv.includes('--dry')) {
        const chars = built.systemPrompt.length + built.messages.reduce((n, m) => n + String((m as { content?: unknown }).content ?? '').length, 0);
        console.log(`  ${c.id}: ≈ ${Math.round(chars / 4).toLocaleString('en-US')} tokens per call (dry run, no model call)`);
        return empty;
      }
      let r: { value: AuditResponse; toolCallsUsed: Array<{ toolName: string }>; telemetry: { costUsdCents: number; uncachedPromptTokens: number; cachedTokens: number; completionTokens: number; durationMs: number; cacheWriteTokens?: number }; controlEvents?: string[]; requests?: number };
      if (loop === 'vercel') {
        const provider = await getProviderForFunction('capture-chat-agent', cfg.model ? { model: cfg.model, reasoningEffort: cfg.effort } : undefined);
        const v = await provider.completeWithTools<AuditResponse>({
          systemPrompt: built.systemPrompt,
          messages: built.messages,
          tools,
          schemaName: 'audit_response',
          jsonSchema: AuditResponseJsonSchema,
          validate: raw => AuditResponseSchema.parse(raw),
          maxToolCalls: 4,
        });
        if (v.kind !== 'response') throw new Error('agent loop did not converge');
        r = v;
      } else {
        const model = cfg.model ?? 'gpt-6.1-sol';
        const { usesResponsesApi } = await import('@/lib/ai/models');
        const endpoint = {
          baseUrl: process.env.OPENAI_BASE_URL!, apiKey: process.env.OPENAI_API_KEY!, model,
          api: (usesResponsesApi(model) ? 'openai-responses' : 'openai-completions') as 'openai-responses' | 'openai-completions',
          reasoning: cfg.effort as 'low' | 'medium' | 'high' | undefined,
        };
        const turn = { systemPrompt: built.systemPrompt, messages: built.messages, tools, userMessage, fileNames, courseCode: c.course, endpoint, maxToolCalls: 4, controls };
        r = loop === 'pi'
          ? await (await import('@/lib/ai/agent/harness/pi-interview')).runPiTurn(turn)
          : await (await import('@/lib/ai/agent/harness/codex-interview')).runCodexTurn(turn);
      }
      const cites = (r.value.citations ?? []) as Array<{ type: string }>;
      return {
        ...empty,
        materialToolCalls: r.toolCallsUsed.filter(t => MATERIAL_TOOLS.has(t.toolName)).length,
        otherToolCalls: r.toolCallsUsed.filter(t => !MATERIAL_TOOLS.has(t.toolName)).length,
        chunkCitations: cites.filter(x => x.type === 'chunk').length,
        instructorCitations: cites.filter(x => x.type === 'instructor').length,
        badCitations: (((r as { retrievedChunkIds?: string[] }).retrievedChunkIds ?? []).forEach(id => retrieved.add(id)), checkCitations(r.value, { retrievedThisTurn: retrieved, history }).length),
        controlEvents: r.controlEvents,
        requests: r.requests,
        question: String((r.value as { question?: unknown }).question ?? '').slice(0, 400),
        costUsdCents: r.telemetry.costUsdCents,
        uncachedPromptTokens: r.telemetry.uncachedPromptTokens,
        cachedTokens: r.telemetry.cachedTokens,
        completionTokens: r.telemetry.completionTokens,
        cacheWriteTokens: r.telemetry.cacheWriteTokens ?? 0,
        durationMs: r.telemetry.durationMs,
      };
    } catch (err) {
      return { ...empty, error: err instanceof Error ? err.message : String(err) };
    } finally {
      if (tempSession) await db.delete(captureMessages).where(inArray(captureMessages.sessionId, [tempSession]));
    }
  }

  const runs: Array<{ config: BenchConfig; results: CaseResult[] }> = [];
  for (const cfg of configs) {
    console.log(`\n${cfg.label}`);
    const results: CaseResult[] = [];
    for (const c of cases) {
      const r = await runCase(c, cfg);
      results.push(r);
      if (!argv.includes('--dry')) {
        console.log(`  ${c.id} (${c.kind}): ${r.materialToolCalls} search, ${r.chunkCitations} file / ${r.instructorCitations} instructor cites, ${(r.uncachedPromptTokens + r.cachedTokens).toLocaleString('en-US')} tokens, ${(r.durationMs / 1000).toFixed(1)}s, ${r.badCitations ?? 0} bad cites${r.controlEvents?.length ? ' [' + r.controlEvents.join('; ') + ']' : ''}${r.error ? '  ERROR ' + r.error.slice(0, 120) : ''}`);
      }
    }
    runs.push({ config: cfg, results });
  }
  if (argv.includes('--dry')) return 0;

  const summaries = runs.map(r => summarize(r.config.label, r.results));
  console.log('\n' + renderTable(summaries));
  const out = arg('--out');
  if (out) writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), cases, runs, summaries }, null, 2));
  return summaries.some(s => s.errors) ? 3 : 0;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadAppEnv();
  void main(process.argv.slice(2)).then(code => process.exit(code));
}
