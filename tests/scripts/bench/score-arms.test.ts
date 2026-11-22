import { describe, it, expect, vi, beforeEach } from 'vitest';

const score = vi.fn();
const runPiTask = vi.fn();
const searchExecute = vi.fn();
const fetchExecute = vi.fn();
import { z } from 'zod';
vi.mock('@/lib/ai/analyze/program-score-coverage', () => ({
  scoreSnapshotCompetencies: (...a: unknown[]) => score(...a),
  coverageJsonSchema: { type: 'object', title: 'coverage' },
}));
vi.mock('@/lib/ai/agent/pi/task', () => ({ runPiTask: (...a: unknown[]) => runPiTask(...a) }));
vi.mock('@/lib/ai/prompts/load', () => ({ loadPrompt: async () => 'PRODUCTION PROMPT' }));
vi.mock('@/lib/ai/agent/audit-tools', () => ({
  buildAuditTools: () => ['list_materials', 'fetch_material_section', 'search_materials', 'wiki_search'].map(name => ({
    name, description: name, inputSchema: z.object({ courseCode: z.string(), query: z.string().optional() }),
    execute: name === 'search_materials' ? searchExecute : name === 'fetch_material_section' ? fetchExecute : async () => ({}),
  })),
}));

import { runScoreArm, type ScoreCase } from '@/scripts/bench/lib/score-arms';

const model = { id: 'm1', level: 'low', endpoint: { baseUrl: 'x', apiKey: 'k', model: 'm1', api: 'openai-completions' as const } };
const case1: ScoreCase = {
  course: 'GC 1', snapshotId: 's1',
  profile: { note: 'Students build a poster brief for the client every term in studio.' },
  competencies: [
    { id: 'c1', name: 'Type', knowDescriptor: 'k', understandDescriptor: 'u', doDescriptor: 'd', foundational: false, scoring: 'direct' },
    { id: 'c2', name: 'Agency', knowDescriptor: null, understandDescriptor: null, doDescriptor: 'd', foundational: true, scoring: 'direct' },
  ],
};
const piBase = { toolCalls: [], forcedSubmit: false, requests: 1, tokens: { freshInput: 10, cachedInput: 0, output: 5, cacheWrite: 0 }, usdUnits: 3, credits: 0.1, ms: 5 };
const cell = (id: string, k: number | null, u: number | null, d: number, ex: string) =>
  ({ competency_id: id, matched_competency: null, k_depth: k, u_depth: u, d_depth: d, evidence_excerpt: ex, confidence: 'high', rationale: 'SCORER-RATIONALE-MARKER' });

beforeEach(() => { vi.clearAllMocks(); });

describe('single', () => {
  it('passes model overrides through and returns cells', async () => {
    score.mockResolvedValue({ result: { snapshot_id: 's1', generated_at: '', cells: [cell('c1', 3, 2, 3, 'e')] }, model: 'm1', costUsdCents: 7, rejectedCompetencyIds: [] });
    const r = await runScoreArm('single', case1, model);
    expect(score.mock.calls[0]![0]).toMatchObject({ modelOverride: 'm1', reasoningEffortOverride: 'low', snapshotId: 's1', courseCode: 'GC 1' });
    expect(r.cells).toEqual([{ sub: 'c1', k: 3, u: 2, d: 3, excerpt: 'e' }]);
    expect(r.calls).toBe(1);
    expect(r.usdUnits).toBe(7);
  });
});

describe('agent', () => {
  it('offers exactly search_materials, fetch_material_section, check_quote and submit', async () => {
    runPiTask.mockResolvedValue({ ...piBase, value: { snapshot_id: 's1', generated_at: '', cells: [cell('c1', 1, 0, 1, 'x')] } });
    await runScoreArm('agent', case1, model);
    const input = runPiTask.mock.calls[0]![0];
    expect(input.tools.map((t: { name: string }) => t.name).sort()).toEqual(['check_quote', 'fetch_material_section', 'search_materials']);
    expect(input.submitSchema).toEqual({ type: 'object', title: 'coverage' });
    expect(input.systemPrompt).toContain('PRODUCTION PROMPT');
    expect(input.endpoint).toBe(model.endpoint);
  });

  it('check_quote finds text from a fetched chunk', async () => {
    fetchExecute.mockResolvedValue({ chunks: [{ id: 'ch1', text: 'Rubric: kerning accuracy counts for twenty points.', parentSectionText: null }] });
    runPiTask.mockResolvedValue({ ...piBase, value: { snapshot_id: 's1', generated_at: '', cells: [cell('c1', 1, 0, 1, 'x')] } });
    await runScoreArm('agent', case1, model);
    const tools = runPiTask.mock.calls[0]![0].tools as { name: string; execute: (a: unknown) => Promise<{ found: boolean }> }[];
    const check = tools.find(t => t.name === 'check_quote')!;
    const fetch = tools.find(t => t.name === 'fetch_material_section')!;
    expect((await check.execute({ quote: 'kerning accuracy counts for twenty points' })).found).toBe(false);
    await fetch.execute({ courseCode: 'GC 1', materialId: 'm', query: 'q' });
    expect((await check.execute({ quote: 'kerning accuracy counts for twenty points' })).found).toBe(true);
    expect((await check.execute({ quote: 'poster brief for the client every term' })).found).toBe(true);
  });

  it('a course with no materials still returns cells', async () => {
    searchExecute.mockResolvedValue({ chunks: [], note: 'No materials are in use for this course.' });
    runPiTask.mockResolvedValue({ ...piBase, value: { snapshot_id: 's1', generated_at: '', cells: [cell('c1', 1, 0, 0, '')] } });
    const r = await runScoreArm('agent', case1, model);
    expect(r.cells).toHaveLength(1);
    expect(r.calls).toBe(1);
  });
});

describe('checker', () => {
  const singleCells = [cell('c1', 4, 3, 3, 'poster brief for the client every term'), cell('c2', null, null, 2, 'nothing real here at all')];
  beforeEach(() => {
    score.mockResolvedValue({ result: { snapshot_id: 's1', generated_at: '', cells: singleCells }, model: 'm1', costUsdCents: 0, rejectedCompetencyIds: [] });
  });

  it('never puts the single arm\'s scores in the checker prompt', async () => {
    runPiTask.mockResolvedValue({ ...piBase, value: { competencies: [] } });
    await runScoreArm('checker', case1, model);
    const input = runPiTask.mock.calls[0]![0];
    const all = input.systemPrompt + input.userMessage;
    // The shared depth scale legitimately names the output fields; what must not appear is the scorer's actual output.
    for (const f of ['"k_depth"', '"d_depth"', '"evidence_excerpt"', 'SCORER-RATIONALE-MARKER', 'nothing real here at all']) expect(all).not.toContain(f);
  });

  it('caps D3 to the level of a grounded quote and drops an ungrounded D2 to 0', async () => {
    runPiTask.mockResolvedValue({ ...piBase, value: { competencies: [
      { competency_id: 'c1', know: { quote: 'poster brief for the client', level: 2 }, understand: { quote: null, level: 0 }, do: { quote: 'poster brief for the client every term', level: 2 } },
      { competency_id: 'c2', know: null, understand: null, do: { quote: 'invented sentence not in the profile anywhere', level: 3 } },
    ] } });
    const r = await runScoreArm('checker', case1, model);
    const c1 = r.cells.find(c => c.sub === 'c1')!;
    const c2 = r.cells.find(c => c.sub === 'c2')!;
    expect(c1.d).toBe(2);       // D3 capped to grounded level 2
    expect(c1.k).toBe(2);       // K4 capped
    expect(c1.u).toBe(0);       // no quote: U floor 0
    expect(c2.d).toBe(0);       // ungrounded D2 -> 0
    expect(c2.k).toBeNull(); expect(c2.u).toBeNull();
    expect(r.calls).toBe(2);
    expect(r.usdUnits).toBe(3);
  });
});
