/**
 * The three scoring arms of the agents-vs-single-calls benchmark:
 *  - single:  today's production call (scoreSnapshotCompetencies).
 *  - agent:   Pi tool loop, production prompt plus retrieval tools and a code quote checker.
 *  - checker: the single result, then one independent checker call per course that never
 *             sees the scores; code caps each score by what the checker's grounded quote supports.
 * No endpoints are built here: the caller supplies a PiEndpoint. Run arms serially
 * (runPiTask sets a process-wide env key).
 */
import { z } from 'zod';
import { scoreSnapshotCompetencies, coverageJsonSchema, type ScoreCompetenciesInput } from '@/lib/ai/analyze/program-score-coverage';
import { runPiTask } from '@/lib/ai/agent/pi/task';
import type { PiEndpoint } from '@/lib/ai/agent/pi/turn';
import { buildAuditTools } from '@/lib/ai/agent/audit-tools';
import { loadPrompt } from '@/lib/ai/prompts/load';
import type { ToolDefinition } from '@/lib/ai/tool-use-types';
import type { TokenCounts } from '@/lib/ai/prices';
import { findQuote } from './evidence';

export type CompetencyInput = ScoreCompetenciesInput['competencies'][number];
export interface ScoreCase { course: string; snapshotId: string; profile: unknown; competencies: CompetencyInput[] }
export interface Cell { sub: string; k: number | null; u: number | null; d: number; excerpt: string }
export interface ArmResult {
  cells: Cell[]; calls: number; tokens: TokenCounts; usdUnits: number; credits: number | null; ms: number;
  forcedSubmit?: boolean; toolCalls?: number;
}
export type ArmName = 'single' | 'agent' | 'checker';
export interface ArmModel { id: string; level?: string; endpoint: PiEndpoint }

const ZERO: TokenCounts = { freshInput: 0, cachedInput: 0, output: 0, cacheWrite: 0 };
const addTokens = (a: TokenCounts, b: TokenCounts): TokenCounts => ({
  freshInput: a.freshInput + b.freshInput, cachedInput: a.cachedInput + b.cachedInput,
  output: a.output + b.output, cacheWrite: (a.cacheWrite ?? 0) + (b.cacheWrite ?? 0),
});

type RawCell = { competency_id: string; k_depth: number | null; u_depth: number | null; d_depth: number; evidence_excerpt: string | null };
const toCell = (c: RawCell): Cell => ({ sub: c.competency_id, k: c.k_depth ?? null, u: c.u_depth ?? null, d: c.d_depth, excerpt: c.evidence_excerpt ?? '' });
const direct = (c: ScoreCase) => c.competencies.filter(x => x.scoring !== 'derived');

async function single(c: ScoreCase, model: ArmModel): Promise<ArmResult> {
  const t0 = Date.now();
  const r = await scoreSnapshotCompetencies({
    snapshotId: c.snapshotId, courseCode: c.course, snapshotProfile: c.profile as never,
    competencies: c.competencies, modelOverride: model.id, reasoningEffortOverride: model.level,
  });
  // The single call reports no token counts, only paid cost (0 on campus).
  return { cells: r.result.cells.map(toCell), calls: 1, tokens: { ...ZERO }, usdUnits: r.costUsdCents, credits: null, ms: Date.now() - t0 };
}

const profileText = (p: unknown) => JSON.stringify(p, null, 1);

/** search/fetch tools pinned to the course; every chunk they return is kept for check_quote. */
function retrievalTools(course: string, seen: Array<{ id: string; text: string }>): ToolDefinition[] {
  const keep = ['search_materials', 'fetch_material_section'];
  return buildAuditTools(course).filter(t => keep.includes(t.name)).map(t => ({
    ...t,
    async execute(args: unknown) {
      const out = await t.execute({ ...(args as object), courseCode: course });
      for (const ch of ((out as { chunks?: Array<{ id: string; text?: string; parentSectionText?: string | null }> })?.chunks ?? [])) {
        if (ch.text) seen.push({ id: ch.id, text: ch.text });
        if (ch.parentSectionText) seen.push({ id: `${ch.id}:section`, text: ch.parentSectionText });
      }
      return out;
    },
  }));
}

function checkQuoteTool(profile: unknown, seen: Array<{ id: string; text: string }>): ToolDefinition {
  return {
    name: 'check_quote',
    description: 'Check that a quote is verbatim in the course profile or in a material chunk you already fetched. Returns { found, sourceId }.',
    inputSchema: z.object({ quote: z.string() }),
    async execute(args) {
      const { quote } = args as { quote: string };
      return findQuote(quote, [{ id: 'profile', text: profileText(profile) }, ...seen]);
    },
  };
}

const TOOL_SECTION = `

# Tools

You may search the course's materials (search_materials, fetch_material_section) when the profile alone is not enough to judge a competency, and you must verify each evidence_excerpt you intend to submit with check_quote (it must be verbatim from the profile or a chunk you fetched). Use few calls. Then deliver all cells with submit.`;

function agentUserMessage(c: ScoreCase): string {
  const ctx = direct(c).map(x => ({ id: x.id, name: x.name, foundational: x.foundational, know_descriptor: x.knowDescriptor, understand_descriptor: x.understandDescriptor, do_descriptor: x.doDescriptor }));
  return [
    `**Snapshot ID:** ${c.snapshotId}`, `**Course:** ${c.course}`, '', '**Snapshot profile:**', profileText(c.profile), '', '---', '',
    '**Competencies to score:**', JSON.stringify(ctx, null, 2), '', '---', '',
    'Score every competency above against this snapshot per the system',
    'instructions. Produce one cell entry per competency, using the',
    'competency.id verbatim. Set snapshot_id to the value above and',
    'generated_at to the current ISO timestamp.',
  ].join('\n');
}

async function agent(c: ScoreCase, model: ArmModel): Promise<ArmResult> {
  const seen: Array<{ id: string; text: string }> = [];
  const r = await runPiTask<{ cells: RawCell[] }>({
    systemPrompt: (await loadPrompt('program-score-coverage')) + TOOL_SECTION,
    userMessage: agentUserMessage(c),
    tools: [...retrievalTools(c.course, seen), checkQuoteTool(c.profile, seen)],
    submitSchema: coverageJsonSchema as unknown as Record<string, unknown>,
    submitDescription: 'Deliver the coverage result: one cell per competency.',
    endpoint: model.endpoint,
  });
  const known = new Map(direct(c).map(x => [x.id, x]));
  const cells = r.value.cells.filter(x => known.has(x.competency_id)).map(x => {
    const cell = toCell(x);
    // Same rule the single path enforces: foundational competencies are D-only.
    return known.get(x.competency_id)!.foundational ? { ...cell, k: null, u: null } : cell;
  });
  return { cells, calls: 1, tokens: r.tokens, usdUnits: r.usdUnits, credits: r.credits, ms: r.ms, forcedSubmit: r.forcedSubmit, toolCalls: r.toolCalls.length };
}

// Adapted from scripts/bench/judge-factcheck.ts.
const CHECKER_SYSTEM = `You check evidence for a curriculum coverage judgment. You are given one course's profile and a list of competencies.
For each competency and each dimension asked, find the single best verbatim quote that is evidence of THAT kind, for THIS competency:
- know: an assessment item (quiz, exam, test, graded identification) that checks students recall or identify this competency's content.
- understand: students producing reasoning about this competency: explaining why, predicting, comparing, justifying, critiquing. A calculation, a procedure or a finished artifact is NOT reasoning.
- do: a graded deliverable or task students actually perform that exercises this competency.
Not evidence: a lecture topic, reading, schedule item or video alone; course objectives or aspirations ("students will understand"); evidence the profile gives for a different competency unless it also shows this competency itself; written work for spoken communication or spoken work for writing.
Low levels need only modest evidence: a guided task with instructor direction is Do 1; students restating an explanation is Understand 1. Do not demand more than the level needs.
Quotes come from the profile, or from material chunks you fetch with search_materials / fetch_material_section. Copy the quote exactly. If there is no such evidence, use null. Do not guess.
Give "level": the highest depth level (per the scale below) that the evidence of that kind supports for this competency; 0 when quote is null (Know: 1 when the content is only presented, with no assessment).
Return one entry per competency. For a foundational competency only "do" is asked: set know and understand to null.

`;

const dimSchema = {
  type: ['object', 'null'], additionalProperties: false, required: ['quote', 'level'],
  properties: { quote: { type: ['string', 'null'] }, level: { type: 'integer', minimum: 0, maximum: 5 } },
};
const checkerSchema = {
  type: 'object', additionalProperties: false, required: ['competencies'],
  properties: { competencies: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['competency_id', 'know', 'understand', 'do'],
    properties: { competency_id: { type: 'string' }, know: dimSchema, understand: dimSchema, do: { ...dimSchema, type: 'object' } },
  } } },
};
type Verdict = { quote: string | null; level: number } | null;
interface CheckerOut { competencies: Array<{ competency_id: string; know: Verdict; understand: Verdict; do: Verdict }> }

/** Floors when a score has no grounded quote (evidence-above-zero rule: K1, U0, D0). */
const FLOOR = { k: 1, u: 0, d: 0 };

async function checker(c: ScoreCase, model: ArmModel): Promise<ArmResult> {
  const base = await single(c, model);
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const scale = readFileSync(join(process.cwd(), 'lib/ai/prompts/shared/depth-scale.md'), 'utf8');
  const seen: Array<{ id: string; text: string }> = [];
  const comps = direct(c).map(x => ({
    id: x.id, name: x.name, foundational: x.foundational,
    know_descriptor: x.foundational ? null : x.knowDescriptor,
    understand_descriptor: x.foundational ? null : x.understandDescriptor,
    do_descriptor: x.doDescriptor,
  }));
  const r = await runPiTask<CheckerOut>({
    systemPrompt: CHECKER_SYSTEM + scale,
    userMessage: `Course: ${c.course}\n\nCompetencies:\n${JSON.stringify(comps, null, 1)}\n\nCourse profile:\n${profileText(c.profile)}`,
    tools: retrievalTools(c.course, seen),
    submitSchema: checkerSchema as unknown as Record<string, unknown>,
    submitDescription: 'Deliver the evidence quotes and levels, one entry per competency.',
    endpoint: model.endpoint,
  });
  const sources = () => [{ id: 'profile', text: profileText(c.profile) }, ...seen];
  const byId = new Map(r.value.competencies.map(x => [x.competency_id, x]));
  const cap = (score: number | null, v: Verdict | undefined, floor: number): number | null => {
    if (score == null) return null;
    if (!v?.quote || !findQuote(v.quote, sources()).found) return Math.min(score, floor);
    return Math.min(score, Number(v.level ?? 0));
  };
  const cells = base.cells.map(cell => {
    const v = byId.get(cell.sub);
    return { ...cell, k: cap(cell.k, v?.know, FLOOR.k), u: cap(cell.u, v?.understand, FLOOR.u), d: cap(cell.d, v?.do, FLOOR.d) as number };
  });
  return {
    cells, calls: 2, tokens: addTokens(base.tokens, r.tokens), usdUnits: base.usdUnits + r.usdUnits,
    // The single call's credits are unknown (no token telemetry), so this is the checker call's alone.
    credits: r.credits, ms: base.ms + r.ms, forcedSubmit: r.forcedSubmit, toolCalls: r.toolCalls.length,
  };
}

export async function runScoreArm(arm: ArmName, c: ScoreCase, model: ArmModel): Promise<ArmResult> {
  if (arm === 'single') return single(c, model);
  if (arm === 'agent') return agent(c, model);
  return checker(c, model);
}
