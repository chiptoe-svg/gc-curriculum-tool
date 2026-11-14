import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CaptureProfile } from '@/lib/ai/capture/schema';
import { baseProfile } from '../../helpers/capture-profile-fixture';

const streamWithTools = vi.fn();
const getProviderForFunction = vi.fn();
vi.mock('@/lib/ai/provider', () => ({ getProviderForFunction: (...a: unknown[]) => getProviderForFunction(...a) }));
const readWikiPage = vi.fn();
vi.mock('@/lib/wiki/git-ops', () => ({ readWikiPage: (...a: unknown[]) => readWikiPage(...a) }));
const tool = (name: string) => ({ name, description: name, inputSchema: {}, execute: async () => ({}) });
vi.mock('@/lib/ai/agent/audit-tools', () => ({
  buildAuditTools: () => ['list_materials', 'fetch_material_section', 'search_materials'].map(tool),
}));
vi.mock('@/lib/ai/wiki/tools', () => ({ buildCurriculumChatTools: () => [tool('read_wiki')] }));
vi.mock('@/lib/ai/wiki/graph-tools', () => ({ buildCurriculumGraphTools: () => [] }));
vi.mock('@/lib/ai/wiki/curriculum-search-tool', () => ({ buildCurriculumSearchTools: () => [] }));
const estimateWhatIf = vi.fn();
vi.mock('@/lib/what-if/estimate', () => ({ estimateWhatIf: (...a: unknown[]) => estimateWhatIf(...a) }));
vi.mock('@/lib/what-if/neighbors', () => ({ loadWhatIfNeighborContext: async () => ({ focal: {}, upstream: [], downstream: [] }) }));
vi.mock('@/lib/what-if/knock-on', () => ({
  computeKnockOn: async () => ({ laterCourses: [], earlierCourses: [], careerTargets: [], notComputed: [], careerNotComputed: false }),
}));
vi.mock('@/lib/db/what-if-queries', () => ({ listActiveSubCompetencies: async () => [] }));

import { streamWhatIfAgent } from '@/lib/what-if/agent';

const approved = baseProfile([
  { statement: 'Prepare print-ready files.', type: 'technical', k_depth: 3, u_depth: 2, d_depth: 3,
    evidence_k: 'q', evidence_u: 'r', evidence_d: 'g', rationale: 'x' },
]) as unknown as CaptureProfile;
const whatIf = { id: 'w1', courseCode: 'GC 3460', baseSnapshotId: 'snap-1' } as never;
const telemetry = { costUsdCents: 2, durationMs: 1, cachedTokens: 0, uncachedPromptTokens: 3, completionTokens: 4 };
const final = { kind: 'final', value: { response: 'Hello', citations: [] }, toolCallsUsed: [{}, {}], telemetry };

beforeEach(() => {
  [streamWithTools, readWikiPage, getProviderForFunction, estimateWhatIf].forEach(m => m.mockReset());
  readWikiPage.mockResolvedValue(null);
  streamWithTools.mockImplementation(async function* () { yield final; });
  getProviderForFunction.mockResolvedValue({ streamWithTools });
  estimateWhatIf.mockResolvedValue({
    estimate: { changeItems: [], movedRatings: [], newCompetencies: [], incomingChanges: [] }, telemetry,
  });
});

const run = async (over: object = {}) => {
  const events: unknown[] = [];
  const onEstimate = vi.fn();
  for await (const e of streamWhatIfAgent({
    whatIf, approved, history: [], message: 'Add a lab', attachments: [], onEstimate, ...over,
  } as never)) events.push(e);
  return { events, call: streamWithTools.mock.calls[0]![0], onEstimate };
};
const firstUser = (call: { messages: Array<{ content: string }> }) => call.messages[0]!.content;

describe('streamWhatIfAgent', () => {
  it('uses the what-if-agent function for the course and allows 8 tool calls', async () => {
    const { call } = await run();
    expect(getProviderForFunction).toHaveBeenCalledWith('what-if-agent', { courseCode: 'GC 3460' });
    expect(call.maxToolCalls).toBe(8);
  });

  it('offers quick_estimate and the grounding tools, and none of the Explore scenario tools', async () => {
    const { call } = await run();
    const names = call.tools.map((t: { name: string }) => t.name);
    for (const n of ['quick_estimate', 'list_materials', 'fetch_material_section', 'search_materials']) expect(names).toContain(n);
    for (const n of ['save_scenario', 'list_scenarios', 'compare_scenarios', 'run_impact']) expect(names).not.toContain(n);
  });

  it('puts the approved profile and the wiki page in the context, history before the new message', async () => {
    readWikiPage.mockResolvedValue('# GC 3460 wiki page text');
    const { call } = await run({ history: [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'reply' }] });
    expect(readWikiPage).toHaveBeenCalledWith('courses/gc-3460.md');
    expect(firstUser(call)).toContain('Prepare print-ready files.');
    expect(firstUser(call)).toContain('GC 3460 wiki page text');
    expect(call.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(call.messages[2].content).toBe('Add a lab');
  });

  it('shows attachment text for ok files only; failed and held back files carry no text', async () => {
    const { call } = await run({ attachments: [
      { fileName: 'plan.docx', status: 'ok', text: 'WEEK FIVE LAB TEXT', truncated: false },
      { fileName: 'broken.pdf', status: 'failed', text: null, truncated: false },
      { fileName: 'grades.xlsx', status: 'held_back', text: null, truncated: false },
    ] });
    const first = firstUser(call);
    expect(first).toContain('WEEK FIVE LAB TEXT');
    expect(first).toMatch(/broken\.pdf[^\n]*could not be read/);
    expect(first).toMatch(/grades\.xlsx[^\n]*held back/);
  });

  it('states truncation: a cut file, and a later file left out for the limit', async () => {
    const { call } = await run({ attachments: [
      { fileName: 'big.docx', status: 'ok', text: 'CUT TEXT', truncated: true },
      { fileName: 'late.docx', status: 'ok', text: null, truncated: true },
    ] });
    const first = firstUser(call);
    expect(first).toContain('CUT TEXT');
    expect(first).toContain('The rest of this file was cut at the 120,000-character limit.');
    expect(first).toMatch(/late\.docx[^\n]*left out[^\n]*120,000-character limit/);
  });

  it('says the base version is gone when there is no approved profile', async () => {
    const { call } = await run({ approved: null, whatIf: { id: 'w1', courseCode: 'GC 3460', baseSnapshotId: null } });
    expect(firstUser(call)).toMatch(/no longer exists/);
  });

  it('gives quick_estimate ok files with text only, a cut file carrying the cut line', async () => {
    const { call } = await run({ attachments: [
      { fileName: 'a.docx', status: 'ok', text: 'AAA', truncated: true },
      { fileName: 'b.pdf', status: 'failed', text: null, truncated: false },
      { fileName: 'c.docx', status: 'ok', text: null, truncated: true },
      { fileName: 'd.docx', status: 'ok', text: 'DDD', truncated: false },
    ] });
    await call.tools.find((t: { name: string }) => t.name === 'quick_estimate').execute({ candidate: 'x' });
    expect(estimateWhatIf.mock.calls[0]![0].attachments).toEqual([
      { fileName: 'a.docx', text: 'AAA\n\nThe rest of this file was cut at the 120,000-character limit.' },
      { fileName: 'd.docx', text: 'DDD' },
    ]);
  });

  it('yields the final response with the tool-call count, and reports chat telemetry', async () => {
    const onChatTelemetry = vi.fn();
    const { events } = await run({ onChatTelemetry });
    expect(events.at(-1)).toEqual({ kind: 'final', response: { response: 'Hello', citations: [] }, toolCallsUsed: 2 });
    expect(onChatTelemetry).toHaveBeenCalledWith(telemetry);
  });

  it('yields an estimate event for each quick estimate, before the final', async () => {
    streamWithTools.mockImplementation(async function* (args: { tools: Array<{ name: string; execute: (a: unknown) => Promise<unknown> }> }) {
      await args.tools.find(t => t.name === 'quick_estimate')!.execute({ candidate: 'a lab' });
      yield final;
    });
    const { events, onEstimate } = await run();
    expect(events.map(e => (e as { kind: string }).kind)).toEqual(['estimate', 'final']);
    expect((events[0] as { estimate: { candidate: string } }).estimate.candidate).toBe('a lab');
    expect(onEstimate).toHaveBeenCalledTimes(1);
  });

  it('turns a provider error into an error event', async () => {
    streamWithTools.mockImplementation(async function* () { yield { kind: 'error', message: 'boom' }; });
    const { events } = await run();
    expect(events).toEqual([{ kind: 'error', message: 'boom' }]);
  });
});
