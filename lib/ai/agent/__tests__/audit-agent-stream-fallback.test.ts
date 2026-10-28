/** A forced-search stream rejected before anything was shown retries once without forcing. */
import { describe, it, expect, vi } from 'vitest';

const calls: Array<Record<string, unknown>> = [];

vi.mock('@/lib/ai/agent/audit-agent', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/agent/audit-agent')>();
  return {
    ...actual,
    buildAgentCall: async () => ({
      systemPrompt: 'S', messages: [{ role: 'user', content: 'context' }], tools: [],
      isOpeningTurn: false, userTurnIndex: 0, requireToolFirst: ['search_materials'],
    }),
    persistAssistantTurn: async () => {},
  };
});

vi.mock('@/lib/ai/provider', () => ({
  getProviderForFunction: async () => ({
    async *streamWithTools(args: Record<string, unknown>) {
      calls.push(args);
      if (args.requireToolFirst) { yield { kind: 'error', message: '400 tool_choice not supported' }; return; }
      yield { kind: 'final', value: { finding: 'ok', question: 'q?', citations: [], readiness: { score: 1, covered: [], remaining: [], good_enough_to_generate: false } }, toolCallsUsed: [] };
    },
  }),
}));

import { streamAuditAgent } from '../audit-agent-stream';

describe('streamAuditAgent forced-search fallback', () => {
  it('retries without forcing and finishes the turn', async () => {
    const events = [];
    for await (const ev of streamAuditAgent({ sessionId: 's', courseCode: 'GC 4800', userMessage: 'rubric', auditMode: 'full' })) events.push(ev);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.requireToolFirst).toBeUndefined();
    expect(events.some(e => e.kind === 'error')).toBe(false);
    expect(events.find(e => e.kind === 'final')).toBeDefined();
  });
});
