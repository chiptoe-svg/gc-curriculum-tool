/**
 * The three wiki-page arms of the agents-vs-single-calls benchmark. Each arm writes ONE page
 * and returns its markdown; nothing is written anywhere (no database, no wiki repo).
 *  - single:  today's production writer, unchanged (generateProgramPagesFromSubstrate for
 *             competency/target pages, updateWikiForSnapshot for course pages), with the
 *             campus model pinned through the provider override.
 *  - agent:   the same generator and the same stamping, but the writer call is a Pi tool
 *             loop: the production prompt plus read_snapshot_facts and check_page.
 *  - checker: the single writer, then one Pi task that sees the draft and read_snapshot_facts
 *             and returns the corrected page. It never edits facts itself: code re-runs
 *             factualErrors on the result.
 * Because the arms differ only in the provider handed to the production generator, every
 * arm gets the same substrate, batching and deterministic stamps.
 * Run arms serially (runPiTask sets a process-wide env key).
 */
import { z } from 'zod';
import {
  generateProgramPagesFromSubstrate, updateWikiForSnapshot, loadCompetencySubstrate, loadTargetSubstrate,
  type WikiProvider,
} from '@/lib/ai/wiki/update';
import { getProviderForFunction } from '@/lib/ai/provider';
import { runPiTask } from '@/lib/ai/agent/pi/task';
import type { PiEndpoint } from '@/lib/ai/agent/pi/turn';
import { loadPrompt } from '@/lib/ai/prompts/load';
import type { ToolDefinition } from '@/lib/ai/tool-use-types';
import { costCredits, type TokenCounts } from '@/lib/ai/prices';
import { pageFacts, factualErrors, type PageFacts, type FactualError } from './wiki-facts';

export type WikiArmName = 'single' | 'agent' | 'checker';
export interface WikiArmModel { id: string; level?: string; endpoint: PiEndpoint }
export interface WikiArmResult {
  markdown: string; calls: number; tokens: TokenCounts; usdUnits: number; credits: number | null; ms: number;
  /** Errors in the returned markdown. */
  factualErrors: FactualError[];
  /** Checker only: errors in the single draft before checking ([] otherwise). */
  draftErrors: FactualError[];
  toolCalls: number; forcedSubmit: boolean;
  /** The model the writer call actually ran on (asserted equal to the request). */
  actualModel: string;
}

const ZERO: TokenCounts = { freshInput: 0, cachedInput: 0, output: 0, cacheWrite: 0 };
const addTokens = (a: TokenCounts, b: TokenCounts): TokenCounts => ({
  freshInput: a.freshInput + b.freshInput, cachedInput: a.cachedInput + b.cachedInput,
  output: a.output + b.output, cacheWrite: (a.cacheWrite ?? 0) + (b.cacheWrite ?? 0),
});
const addCredits = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));

type WikiOut = { pages: Array<{ path: string; content: string; operation: string }>; log_entry: string };
type CompleteArgs = Parameters<WikiProvider['complete']>[0];

interface Acc { calls: number; tokens: TokenCounts; usdUnits: number; credits: number | null; toolCalls: number; forcedSubmit: boolean; draft: string | null; draftErrors: FactualError[] }

function factsTool(facts: PageFacts): ToolDefinition {
  return {
    name: 'read_snapshot_facts',
    description: 'Read the facts this page must state, taken from the database: counts, course lists and the current career targets. Use them for every number, course list and target you write.',
    inputSchema: z.object({}),
    async execute() { return facts; },
  };
}
function checkPageTool(facts: PageFacts): ToolDefinition {
  return {
    name: 'check_page',
    description: 'Check a draft of the page against the facts. Returns { factualErrors: [{ kind, detail }] }; fix every one before you submit.',
    inputSchema: z.object({ markdown: z.string() }),
    async execute(args) { return { factualErrors: factualErrors((args as { markdown: string }).markdown, facts) }; },
  };
}

const AGENT_TOOLS_SECTION = `

# Tools

Before you write the page, call read_snapshot_facts: every count, course list and career target you state must match it. When the page is drafted, call check_page with its markdown and fix every error it returns. Then deliver the pages with submit.`;

const CHECKER_SYSTEM = `You fact-check one drafted wiki page. You are given the page request, the draft, and a tool that returns the facts the page must state (read_snapshot_facts).
Call read_snapshot_facts. Correct every count, course list and career-target reference in the draft that disagrees with those facts. Change nothing else: keep the structure, wording, links and frontmatter. Do not invent facts.
Return the same JSON the writer returns, with the corrected page in it.`;

const telemetry = (usdUnits: number) => ({ costUsdCents: usdUnits, durationMs: 0, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 });

/** Wrap the production provider: count calls, tokens and cost, and re-assert the model after the call. */
function singleProvider(inner: Awaited<ReturnType<typeof getProviderForFunction>>, model: WikiArmModel, acc: Acc): WikiProvider {
  return {
    async complete<T>(args: CompleteArgs & { validate: (raw: unknown) => T }) {
      const r = await inner.complete<T>(args);
      if (inner.model !== model.id) throw new Error(`single arm ran the wrong model: requested ${model.id}, provider used ${inner.model}`);
      acc.calls++;
      acc.tokens = addTokens(acc.tokens, { freshInput: r.uncachedPromptTokens, cachedInput: r.cachedTokens, output: r.completionTokens, cacheWrite: 0 });
      acc.usdUnits += r.costUsdCents;
      acc.credits = addCredits(acc.credits, costCredits(model.id, { freshInput: r.uncachedPromptTokens, cachedInput: r.cachedTokens, output: r.completionTokens }));
      return r;
    },
  } as WikiProvider;
}

async function piComplete<T>(args: CompleteArgs & { validate: (raw: unknown) => T }, input: { systemPrompt: string; userMessage: string; tools: ToolDefinition[] }, model: WikiArmModel, acc: Acc) {
  const r = await runPiTask<WikiOut>({
    ...input,
    submitSchema: args.jsonSchema as Record<string, unknown>,
    submitDescription: 'Deliver the wiki pages you wrote or corrected.',
    endpoint: model.endpoint,
  });
  acc.calls++;
  acc.tokens = addTokens(acc.tokens, r.tokens);
  acc.usdUnits += r.usdUnits;
  acc.credits = addCredits(acc.credits, r.credits);
  acc.toolCalls += r.toolCalls.length;
  acc.forcedSubmit ||= r.forcedSubmit;
  return { data: args.validate(r.value), ...telemetry(r.usdUnits) };
}

async function generatePage(pageId: string, provider: WikiProvider, systemPrompt: string): Promise<string> {
  const [section, slug] = pageId.split('/') as [string, string];
  const path = `${pageId}.md`;
  let wiki: Array<{ path: string; content: string }>;
  if (section === 'courses') {
    const [{ db }, { courses }, { getLatestSnapshotByCourse }, update] = await Promise.all([
      import('@/lib/db/client'), import('@/lib/db/schema'), import('@/lib/db/capture-snapshots-queries'), import('@/lib/ai/wiki/update'),
    ]);
    const code = (await db.select({ code: courses.code }).from(courses)).map(r => r.code).find(c => update.courseCodeToSlug(c) === slug);
    const snap = code ? await getLatestSnapshotByCourse(code) : null;
    if (!snap) throw new Error(`no snapshot for course page ${pageId}`);
    wiki = (await updateWikiForSnapshot(snap.id, { pageTypes: ['course'], provider, systemPrompt })).wiki;
  } else if (section === 'competencies' || section === 'targets') {
    let substrate: unknown = section === 'competencies' ? await loadCompetencySubstrate(slug) : await loadTargetSubstrate(slug);
    if (pageId === 'competencies/problem-solving') {
      // Its conditions table is derived from capture conditions the competency substrate does not carry;
      // every arm gets the same profile so the table can be written (and checked) at all.
      const [{ loadProblemSolvingInputs }, { buildProblemSolvingProfile }] = await Promise.all([
        import('@/lib/db/problem-solving-queries'), import('@/lib/program/problem-solving-profile'),
      ]);
      const inputs = await loadProblemSolvingInputs();
      substrate = { ...(substrate as object), conditionProfile: buildProblemSolvingProfile(inputs.courses, inputs.depths) };
    }
    wiki = (await generateProgramPagesFromSubstrate(
      [{ type: section === 'competencies' ? 'competency' : 'target', slug, path, existingContent: null, substrate }],
      { provider, systemPrompt, now: new Date() },
    )).wiki;
  } else {
    throw new Error(`unsupported page section: ${section}`);
  }
  const page = wiki.find(p => p.path === path);
  if (!page) throw new Error(`the writer returned no page at ${path}`);
  return page.content;
}

export async function runWikiArm(arm: WikiArmName, pageId: string, model: WikiArmModel): Promise<WikiArmResult> {
  const t0 = Date.now();
  const facts = await pageFacts(pageId);
  const path = `${pageId}.md`;
  const inner = await getProviderForFunction('wiki-update', undefined, { model: model.id, reasoningEffort: model.level });
  if (inner.model !== model.id) throw new Error(`single arm ran the wrong model: requested ${model.id}, provider used ${inner.model}`);
  const systemPrompt = await loadPrompt('wiki-update');
  const acc: Acc = { calls: 0, tokens: { ...ZERO }, usdUnits: 0, credits: null, toolCalls: 0, forcedSubmit: false, draft: null, draftErrors: [] };

  let provider: WikiProvider;
  if (arm === 'single') {
    provider = singleProvider(inner, model, acc);
  } else if (arm === 'agent') {
    provider = {
      complete: <T>(args: CompleteArgs & { validate: (raw: unknown) => T }) => piComplete(args, {
        systemPrompt: args.systemPrompt + AGENT_TOOLS_SECTION, userMessage: args.userMessage, tools: [factsTool(facts), checkPageTool(facts)],
      }, model, acc),
    } as WikiProvider;
  } else {
    const writer = singleProvider(inner, model, acc);
    provider = {
      async complete<T>(args: CompleteArgs & { validate: (raw: unknown) => T }) {
        const draft = await writer.complete<WikiOut>({ ...args, validate: args.validate as (raw: unknown) => WikiOut });
        acc.draft = draft.data.pages.find(p => p.path === path)?.content ?? null;
        if (acc.draft !== null) acc.draftErrors = factualErrors(acc.draft, facts);
        return piComplete(args, {
          systemPrompt: CHECKER_SYSTEM,
          userMessage: `${args.userMessage}\n\n# Draft to check\n\n${JSON.stringify(draft.data)}`,
          tools: [factsTool(facts)],
        }, model, acc);
      },
    } as WikiProvider;
  }

  const markdown = await generatePage(pageId, provider, systemPrompt);
  return {
    markdown, calls: acc.calls, tokens: acc.tokens, usdUnits: acc.usdUnits, credits: acc.credits, ms: Date.now() - t0,
    factualErrors: factualErrors(markdown, facts), draftErrors: acc.draftErrors,
    toolCalls: acc.toolCalls, forcedSubmit: acc.forcedSubmit,
    actualModel: arm === 'single' || arm === 'checker' ? inner.model : model.endpoint.model,
  };
}
