/** The streaming interviewer (the live chat path) runs the same checks as runAuditAgent. */
import { describe, it, expect, vi } from 'vitest';

const persisted: unknown[] = [];
const streamArgs: Array<Record<string, unknown>> = [];

vi.mock('@/lib/ai/agent/audit-agent', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/agent/audit-agent')>();
  return {
    ...actual,
    buildAgentCall: async () => ({
      systemPrompt: 'S',
      messages: [
        { role: 'user', content: 'context' },
        { role: 'user', content: '[messageId=u2]\nIt is graded on the rubric.' },
      ],
      tools: [{ name: 'search_materials', description: 'd', inputSchema: { parse: (v: unknown) => v }, execute: async () => ({ chunks: [{ id: 'chunk-1', materialId: 'm1', text: 'x' }] }) }],
      isOpeningTurn: false,
      userTurnIndex: 2,
      requireToolFirst: ['search_materials', 'fetch_material_section'],
    }),
    persistAssistantTurn: async (input: unknown) => { persisted.push(input); },
  };
});

vi.mock('@/lib/ai/provider', () => ({
  getProviderForFunction: async () => ({
    async *streamWithTools(args: { tools: Array<{ name: string; execute: (a: unknown) => Promise<unknown> }> } & Record<string, unknown>) {
      streamArgs.push(args);
      await args.tools[0]!.execute({ query: 'rubric' });
      yield {
        kind: 'final',
        value: {
          finding: 'f', question: 'q?',
          citations: [
            { type: 'chunk', chunkId: 'chunk-1', messageId: null, excerpt: 'kept' },
            { type: 'chunk', chunkId: 'ghost', messageId: null, excerpt: 'dropped' },
            { type: 'instructor', chunkId: null, messageId: 'u2', excerpt: 'kept' },
          ],
          readiness: { score: 1, covered: [], remaining: [], good_enough_to_generate: false },
        },
        toolCallsUsed: [{ id: 't1', toolName: 'search_materials', args: {} }],
      };
    },
  }),
}));

import { streamAuditAgent } from '../audit-agent-stream';

describe('streamAuditAgent checks', () => {
  it('forces the search when required and drops citations the interviewer never saw', async () => {
    const events = [];
    for await (const ev of streamAuditAgent({ sessionId: 's', courseCode: 'GC 4800', userMessage: 'It is graded on the rubric.', auditMode: 'full' })) events.push(ev);
    expect(streamArgs[0]!.requireToolFirst).toEqual(['search_materials', 'fetch_material_section']);
    const final = events.find(e => e.kind === 'final') as { response: { citations: Array<{ chunkId: string | null; messageId: string | null }> } };
    expect(final.response.citations.map(c => c.chunkId ?? c.messageId)).toEqual(['chunk-1', 'u2']);
    expect((persisted[0] as { response: { citations: unknown[] } }).response.citations).toHaveLength(2);
  });
});
