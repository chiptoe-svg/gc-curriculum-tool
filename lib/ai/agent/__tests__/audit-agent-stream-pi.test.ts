/** Pi plan Task 3: with the loop set to Pi, the interview streams the same events and stores the same rows. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const persisted: unknown[] = [];
const loop = vi.hoisted(() => ({ value: 'pi' as 'pi' | 'current' }));
const reply = {
  finding: 'f', question: 'q?',
  citations: [{ type: 'chunk' as const, chunkId: 'chunk-1', messageId: null, excerpt: 'kept' }],
  readiness: { score: 1, covered: [], remaining: [], good_enough_to_generate: false },
};
const toolCallsUsed = [{ id: 't1', toolName: 'search_materials', args: { query: 'rubric' } }];

vi.mock('@/lib/ai/agent/audit-agent', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/agent/audit-agent')>();
  return {
    ...actual,
    buildAgentCall: async () => ({
      systemPrompt: 'S',
      messages: [{ role: 'user', content: 'context' }, { role: 'user', content: '[messageId=u2]\nIt is graded on the rubric.' }],
      tools: [{ name: 'search_materials', description: 'd', inputSchema: { parse: (v: unknown) => v }, execute: async () => ({ chunks: [{ id: 'chunk-1', materialId: 'm1', text: 'x' }] }) }],
      isOpeningTurn: false, userTurnIndex: 2, requireToolFirst: ['search_materials', 'fetch_material_section'], fileNames: ['Menu brief.pdf'],
    }),
    persistAssistantTurn: async (input: unknown) => { persisted.push(input); },
  };
});
vi.mock('@/lib/ai/function-settings', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/ai/function-settings')>()),
  resolveInterviewLoop: async () => loop.value,
}));
vi.mock('@/lib/ai/agent/pi/endpoint', () => ({ piEndpointFor: async () => ({ baseUrl: 'http://x', apiKey: 'k', model: 'qwen3.8-27b-fp8', api: 'openai-completions', campusReasoning: 'off' }) }));
const runPiTurn = vi.hoisted(() => vi.fn());
vi.mock('@/lib/ai/agent/pi/turn', () => ({ runPiTurn }));
vi.mock('@/lib/ai/provider', () => ({
  getProviderForFunction: async () => ({
    async *streamWithTools(args: { tools: Array<{ execute: (a: unknown) => Promise<unknown> }> }) {
      await args.tools[0]!.execute({ query: 'rubric' });
      yield { kind: 'tool-start', toolName: 'search_materials', args: { query: 'rubric' } };
      yield { kind: 'final', value: reply, toolCallsUsed };
    },
  }),
}));

import { streamAuditAgent } from '../audit-agent-stream';

const turn = { sessionId: 's', courseCode: 'GC 4800', userMessage: 'It is graded on the rubric.', auditMode: 'full' as const };
async function run() { const ev: Array<{ kind: string }> = []; for await (const e of streamAuditAgent(turn)) ev.push(e); return ev; }

beforeEach(() => {
  persisted.length = 0;
  runPiTurn.mockReset();
  runPiTurn.mockImplementation(async (input: { tools: Array<{ execute: (a: unknown) => Promise<unknown> }>; onEvent?: (e: unknown) => void }) => {
    await input.tools[0]!.execute({ query: 'rubric' });
    input.onEvent?.({ kind: 'tool-start', toolName: 'search_materials', args: { query: 'rubric' } });
    input.onEvent?.({ kind: 'text-delta', delta: '{"finding":' });
    return { value: reply, toolCallsUsed, telemetry: {}, controlEvents: ['search required (x); forced on the first request'], requests: 2 };
  });
});

describe('streamAuditAgent on Pi', () => {
  it('emits session, tool-start per tool call, a text-delta heartbeat while submit_turn streams, then final', async () => {
    loop.value = 'pi';
    expect((await run()).map(e => e.kind)).toEqual(['session', 'tool-start', 'text-delta', 'final']);
    expect(runPiTurn).toHaveBeenCalledOnce();
  });

  it("stored rows match the current loop's for the same scripted turn", async () => {
    loop.value = 'current';
    await run();
    loop.value = 'pi';
    await run();
    expect(persisted).toHaveLength(2);
    expect(persisted[1]).toEqual(persisted[0]);
  });

  it('a turn whose citations were dropped still saves and logs the control events', async () => {
    loop.value = 'pi';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    runPiTurn.mockResolvedValueOnce({ value: { ...reply, citations: [] }, toolCallsUsed, telemetry: {}, controlEvents: ['citation check failed: x; no retries left, 1 citation(s) dropped'], requests: 4 });
    const ev = await run();
    expect(ev.at(-1)!.kind).toBe('final');
    expect(persisted).toHaveLength(1);
    expect(warn.mock.calls.some(c => String(c[0]).includes('1 citation(s) dropped'))).toBe(true);
    warn.mockRestore();
  });
});
