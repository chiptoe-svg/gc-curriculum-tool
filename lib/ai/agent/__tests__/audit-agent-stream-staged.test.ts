/** Task 6 routing: only sessions with a capture_interview_sessions row take the staged path. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ row: null as null | Record<string, unknown>, lookupError: null as Error | null }));
const reply = { finding: 'f', question: 'q?', citations: [], readiness: { score: 1, covered: [], remaining: [], good_enough_to_generate: false } };

vi.mock('@/lib/db/capture-interview-sessions-queries', () => ({
  getInterviewSession: vi.fn(async () => { if (h.lookupError) throw h.lookupError; return h.row; }),
}));
const buildAgentCall = vi.hoisted(() => vi.fn(async () => ({
  systemPrompt: 'S', messages: [{ role: 'user', content: 'c' }], tools: [], isOpeningTurn: false, userTurnIndex: 0, fileNames: [],
})));
const persistAssistantTurn = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/lib/ai/agent/audit-agent', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/ai/agent/audit-agent')>()),
  buildAgentCall, persistAssistantTurn,
}));
const staged = vi.hoisted(() => ({
  streamStagedInterview: vi.fn(async function* () { yield { kind: 'final', response: { ...reply, finding: 'staged' }, toolCallsUsed: 0 }; }),
  runStagedInterview: vi.fn(async () => ({ response: { ...reply, finding: 'staged' }, toolCallsUsed: 0 })),
}));
vi.mock('@/lib/capture/staged/staged-turn', () => staged);
// runAuditAgent calls its own buildAgentCall (not the mocked export): its first read marks the classic path.
const getSessionMessages = vi.hoisted(() => vi.fn(async () => { throw new Error('classic-path'); }));
vi.mock('@/lib/db/capture-messages-queries', () => ({ getSessionMessages, appendMessage: vi.fn(), listPriorSessionSummaries: vi.fn() }));
vi.mock('@/lib/ai/function-settings', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/ai/function-settings')>()),
  resolveInterviewLoop: async () => 'current',
}));
vi.mock('@/lib/ai/provider', () => ({
  getProviderForFunction: async () => ({
    async *streamWithTools() { yield { kind: 'final', value: reply, toolCallsUsed: [] }; },
    async completeWithTools() { return { kind: 'response', value: reply, toolCallsUsed: [] }; },
  }),
}));

import { streamAuditAgent } from '../audit-agent-stream';
import { runAuditAgent } from '../audit-agent';

const input = { sessionId: 's', courseCode: 'GC 4060', userMessage: 'hi', auditMode: 'full' as const, finish: true };
async function run() { const ev: Array<{ kind: string; response?: { finding: string } }> = []; for await (const e of streamAuditAgent(input)) ev.push(e); return ev; }

beforeEach(() => {
  h.row = null; h.lookupError = null;
  vi.clearAllMocks();
});

describe('interview routing', () => {
  it('classic session unchanged: no row → buildAgentCall runs, the staged path does not', async () => {
    const ev = await run();
    expect(ev.map(e => e.kind)).toEqual(['session', 'final']);
    expect(ev[1]!.response!.finding).toBe('f');
    expect(buildAgentCall).toHaveBeenCalledOnce();
    expect(staged.streamStagedInterview).not.toHaveBeenCalled();
  });

  it('a staged row → the staged stream (with finish), never buildAgentCall', async () => {
    h.row = { sessionId: 's', map: null, mapStatus: 'none' };
    const ev = await run();
    expect(ev.map(e => e.kind)).toEqual(['session', 'final']);
    expect(ev[1]!.response!.finding).toBe('staged');
    expect(buildAgentCall).not.toHaveBeenCalled();
    expect(staged.streamStagedInterview).toHaveBeenCalledWith(expect.objectContaining({ finish: true, sessionId: 's' }), h.row);
  });

  it('runAuditAgent routes the same way', async () => {
    await expect(runAuditAgent(input)).rejects.toThrow('classic-path');
    expect(staged.runStagedInterview).not.toHaveBeenCalled();
    h.row = { sessionId: 's', map: null, mapStatus: 'none' };
    vi.clearAllMocks();
    expect((await runAuditAgent(input)).response.finding).toBe('staged');
    expect(staged.runStagedInterview).toHaveBeenCalledWith(expect.objectContaining({ finish: true }), h.row);
    expect(getSessionMessages).not.toHaveBeenCalled();
  });

  it('a failed lookup is logged and the turn takes the classic path', async () => {
    h.lookupError = new Error('DATABASE_URL not set');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await run()).map(e => e.kind)).toEqual(['session', 'final']);
    expect(buildAgentCall).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
