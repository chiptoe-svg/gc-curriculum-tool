import { describe, it, expect, vi, beforeEach } from 'vitest';

const runPiTask = vi.fn();
const complete = vi.fn();
const getProvider = vi.fn();
const generate = vi.fn();
const pageFactsMock = vi.fn();
vi.mock('@/lib/ai/agent/pi/task', () => ({ runPiTask: (...a: unknown[]) => runPiTask(...a) }));
vi.mock('@/lib/ai/prompts/load', () => ({ loadPrompt: async () => 'WIKI PROMPT' }));
vi.mock('@/lib/ai/provider', () => ({ getProviderForFunction: (...a: unknown[]) => getProvider(...a) }));
vi.mock('@/lib/ai/wiki/update', () => ({
  generateProgramPagesFromSubstrate: (...a: unknown[]) => generate(...a),
  updateWikiForSnapshot: vi.fn(),
  loadCompetencySubstrate: async () => ({ contributingCells: [], buildingProjects: [] }),
  loadTargetSubstrate: async () => ({}),
  courseCodeToSlug: (c: string) => c.toLowerCase().replace(/\s+/g, '-'),
}));
vi.mock('@/scripts/bench/lib/wiki-facts', async () => {
  const actual = await vi.importActual<typeof import('@/scripts/bench/lib/wiki-facts')>('@/scripts/bench/lib/wiki-facts');
  return { ...actual, pageFacts: (...a: unknown[]) => pageFactsMock(...a) };
});

import { runWikiArm } from '@/scripts/bench/lib/wiki-arms';

const model = { id: 'm1', level: 'low', endpoint: { baseUrl: 'x', apiKey: 'k', model: 'm1', api: 'openai-completions' as const } };
const PATH = 'competencies/x.md';
const facts = { pageId: 'competencies/x', counts: { 'contributing courses': 2 }, courseLists: {}, targets: [] };
const out = (content: string) => ({ pages: [{ path: PATH, operation: 'create', content }], log_entry: 'l' });
const piBase = { toolCalls: [], forcedSubmit: false, requests: 1, tokens: { freshInput: 10, cachedInput: 0, output: 5, cacheWrite: 0 }, usdUnits: 3, credits: 0.1, ms: 5 };

// The production generator calls provider.complete once and returns the page it gets.
beforeEach(() => {
  vi.clearAllMocks();
  pageFactsMock.mockResolvedValue(facts);
  getProvider.mockResolvedValue({ model: 'm1', complete });
  complete.mockResolvedValue({ data: out('draft: 3 contributing courses'), costUsdCents: 7, durationMs: 1, cachedTokens: 0, uncachedPromptTokens: 100, completionTokens: 20 });
  generate.mockImplementation(async (pages: Array<{ path: string }>, deps: { systemPrompt: string; provider: { complete: (a: unknown) => Promise<{ data: ReturnType<typeof out> }> } }) => {
    const r = await deps.provider.complete({ systemPrompt: deps.systemPrompt, userMessage: 'U', schemaName: 'wiki_update', jsonSchema: { type: 'object', title: 'wiki' }, validate: (x: unknown) => x });
    return { wiki: r.data.pages.map(p => ({ path: p.path, content: p.content })), logEntry: 'l' };
  });
});

describe('single', () => {
  it('runs the production generator with the requested model and returns the page', async () => {
    complete.mockResolvedValue({ data: out('draft: 2 contributing courses'), costUsdCents: 7, durationMs: 1, cachedTokens: 0, uncachedPromptTokens: 100, completionTokens: 20 });
    const r = await runWikiArm('single', 'competencies/x', model);
    expect(getProvider.mock.calls[0]![2]).toMatchObject({ model: 'm1', reasoningEffort: 'low' });
    expect(r.markdown).toBe('draft: 2 contributing courses');
    expect(r.calls).toBe(1);
    expect(r.usdUnits).toBe(7);
    expect(r.actualModel).toBe('m1');
    expect(r.factualErrors).toEqual([]);
  });
  it('throws if the provider runs another model', async () => {
    getProvider.mockResolvedValue({ model: 'qwen3.6-35b-a3b-fp8', complete });
    await expect(runWikiArm('single', 'competencies/x', model)).rejects.toThrow(/requested m1.*qwen3\.6/);
  });
});

describe('agent', () => {
  it('offers exactly read_snapshot_facts, check_page and submit', async () => {
    runPiTask.mockResolvedValue({ ...piBase, value: out('agent page') });
    const r = await runWikiArm('agent', 'competencies/x', model);
    const input = runPiTask.mock.calls[0]![0];
    expect(input.tools.map((t: { name: string }) => t.name).sort()).toEqual(['check_page', 'read_snapshot_facts']);
    expect(input.submitSchema).toEqual({ type: 'object', title: 'wiki' });
    expect(input.systemPrompt).toContain('WIKI PROMPT');
    expect(input.endpoint).toBe(model.endpoint);
    expect(complete).not.toHaveBeenCalled();
    expect(r.markdown).toBe('agent page');
  });
  it('read_snapshot_facts returns the facts and check_page runs factualErrors', async () => {
    runPiTask.mockResolvedValue({ ...piBase, value: out('x') });
    await runWikiArm('agent', 'competencies/x', model);
    const tools = runPiTask.mock.calls[0]![0].tools as { name: string; execute: (a: unknown) => Promise<unknown> }[];
    expect(await tools.find(t => t.name === 'read_snapshot_facts')!.execute({})).toEqual(facts);
    expect(await tools.find(t => t.name === 'check_page')!.execute({ markdown: '5 contributing courses' }))
      .toEqual({ factualErrors: [expect.objectContaining({ kind: 'count' })] });
  });
});

describe('checker', () => {
  it('writes a single draft, then a fact-checking task that sees the draft; code re-runs factualErrors', async () => {
    runPiTask.mockResolvedValue({ ...piBase, value: out('fixed: 2 contributing courses') });
    const r = await runWikiArm('checker', 'competencies/x', model);
    expect(complete).toHaveBeenCalledTimes(1);
    const input = runPiTask.mock.calls[0]![0];
    expect(input.tools.map((t: { name: string }) => t.name)).toEqual(['read_snapshot_facts']);
    expect(input.userMessage).toContain('draft: 3 contributing courses');
    expect(r.markdown).toBe('fixed: 2 contributing courses');
    expect(r.draftErrors).toHaveLength(1);
    expect(r.factualErrors).toEqual([]);
    expect(r.calls).toBe(2);
    expect(r.usdUnits).toBe(10);
  });
});

describe('endpoint model guard', () => {
  it.each(['single', 'agent', 'checker'] as const)('%s throws if the endpoint model differs from the request', async arm => {
    runPiTask.mockResolvedValue({ ...piBase, value: out('x') });
    await expect(runWikiArm(arm, 'competencies/x', { ...model, endpoint: { ...model.endpoint, model: 'other' } })).rejects.toThrow(/requested m1.*other/);
  });
  it('checker reports both models', async () => {
    runPiTask.mockResolvedValue({ ...piBase, value: out('2 contributing courses') });
    expect((await runWikiArm('checker', 'competencies/x', model)).actualModel).toBe('m1+m1');
  });
});
