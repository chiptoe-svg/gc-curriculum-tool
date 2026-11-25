// @vitest-environment node
/**
 * Pi 1.6.1 coerces null in a string field to the text "null" (1.4 gave ""), and a null array to ["null"].
 * Runs the real pi-agent-core loop (fake model stream) through runPiTurn, so the real validateToolArguments path
 * is exercised. Also covers tool errors reaching controlEvents (Pi sends them to the model silently).
 */
import { describe, it, expect, vi } from 'vitest';

const script = vi.hoisted(() => ({ replies: [] as Array<Array<{ name: string; arguments: unknown }>> }));

vi.mock('@earendil-works/pi-ai', async (importActual) => {
  const actual = await importActual<typeof import('@earendil-works/pi-ai')>();
  return {
    ...actual,
    createModels: () => ({
      setProvider: () => {},
      streamSimple: (model: { api: string; provider: string; id: string }) => {
        const calls = script.replies.shift() ?? [];
        const stream = actual.createAssistantMessageEventStream();
        const message = {
          role: 'assistant', api: model.api, provider: model.provider, model: model.id,
          content: calls.map((c, i) => ({ type: 'toolCall', id: `c${i}`, name: c.name, arguments: c.arguments })),
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: 'toolUse', timestamp: Date.now(),
        };
        queueMicrotask(() => { stream.push({ type: 'done', reason: 'toolUse', message } as never); stream.end(message as never); });
        return stream;
      },
    }),
  };
});

import { runPiTurn } from '@/lib/ai/agent/pi/turn';
import { nullsToEmpty } from '@/lib/ai/agent/pi/controls';

const input = {
  systemPrompt: 'sys', messages: [{ role: 'user' as const, content: 'hello' }], tools: [], fileNames: [], courseCode: 'GC 1000',
  endpoint: { baseUrl: 'http://x', apiKey: 'k', model: 'qwen3.8-27b-fp8', api: 'openai-completions' as const, campusReasoning: 'off' as const },
};
const nullArgs = {
  finding: null, question: null,
  citations: [],
  readiness: { score: 10, covered: null, remaining: null, good_enough_to_generate: false },
};

describe('submit_turn null arguments (Pi 1.6 coercion)', () => {
  it('null strings become "" and null arrays [], not the text "null"', async () => {
    script.replies = [[{ name: 'submit_turn', arguments: nullArgs }]];
    const r = await runPiTurn(input as never);
    expect(r.value.finding).toBe('');
    expect(r.value.question).toBe('');
    expect(r.value.readiness.covered).toEqual([]);
    expect(r.value.readiness.remaining).toEqual([]);
  });

  it('citation excerpt null becomes "" while chunkId/messageId nulls stay (real validateToolArguments)', async () => {
    const { validateToolArguments } = await import('@earendil-works/pi-ai');
    const { submitTurnSchema } = await import('@/lib/ai/agent/pi/turn');
    const { Type } = await import('typebox');
    const schema = submitTurnSchema();
    const call = { type: 'toolCall', id: 'x', name: 'submit_turn', arguments: { ...nullArgs, citations: [{ type: 'chunk', chunkId: 'c1', messageId: null, excerpt: null }] } };
    const mk = (prep: boolean) => ({ name: 'submit_turn', description: '', parameters: Type.Unsafe(schema), ...(prep ? { prepareArguments: (a: unknown) => nullsToEmpty(a, schema) } : {}) });
    const run = (prep: boolean) => {
      const tool = mk(prep) as never;
      const args = prep ? (tool as { prepareArguments: (a: unknown) => unknown }).prepareArguments(call.arguments) : call.arguments;
      return validateToolArguments(tool, { ...call, arguments: args } as never);
    };
    const without = run(false);
    expect(without.finding).toBe('null'); // the 1.6.1 behavior the fix guards against
    expect(without.readiness.covered).toEqual(['null']);
    const withFix = run(true);
    expect(withFix.finding).toBe('');
    expect(withFix.citations[0].excerpt).toBe('');
    expect(withFix.citations[0].messageId).toBeNull();
    expect(withFix.readiness.remaining).toEqual([]);
  });

  it('a nullable citation field stays null', () => {
    const s = { type: 'object', properties: { c: { type: 'array', items: { type: 'object', properties: { id: { type: ['string', 'null'] }, ex: { type: 'string' } } } } } };
    expect(nullsToEmpty({ c: [{ id: null, ex: null }] }, s)).toEqual({ c: [{ id: null, ex: '' }] });
  });
});

describe('tool errors reach controlEvents', () => {
  it('an unknown tool name is logged', async () => {
    script.replies = [[{ name: 'no_such_tool', arguments: {} }], [{ name: 'submit_turn', arguments: { ...nullArgs, finding: 'f', question: 'q' } }]];
    const r = await runPiTurn(input as never);
    expect(r.controlEvents.some(e => e.startsWith('tool error: no_such_tool: ') && e.includes('not found'))).toBe(true);
  });
});
