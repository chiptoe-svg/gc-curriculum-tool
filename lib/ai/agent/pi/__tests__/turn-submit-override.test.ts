// @vitest-environment node
/** runPiTurn with a custom submit tool and a checkSubmit send-back (real pi-agent-core loop, fake model stream). */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const base = {
  systemPrompt: 'sys', messages: [{ role: 'user' as const, content: 'hello' }], tools: [], fileNames: [], courseCode: 'GC 1000',
  endpoint: { baseUrl: 'http://x', apiKey: 'k', model: 'qwen3.8-27b-fp8', api: 'openai-completions' as const, campusReasoning: 'off' as const },
};
const schema = {
  type: 'object', additionalProperties: false, required: ['note', 'n'],
  properties: { note: { type: 'string' }, n: { type: 'number' } },
};
type V = { note: string; n: number };
const submit = { jsonSchema: schema, parse: (raw: unknown) => raw as V, description: 'custom reply' };
const call = (note: string, n = 1) => [{ name: 'submit_turn', arguments: { note, n } }];

beforeEach(() => { script.replies = []; });

describe('runPiTurn custom submit', () => {
  it('validates against the supplied schema, not AuditResponse', async () => {
    script.replies = [[{ name: 'submit_turn', arguments: { note: 'a' } }], call('b')];
    const r = await runPiTurn<V>({ ...base, submit } as never);
    expect(r.value).toEqual({ note: 'b', n: 1 });
    expect(r.controlEvents.some(e => e.startsWith('tool error: submit_turn'))).toBe(true);
  });

  it('a null string in the custom schema becomes "", not "null"', async () => {
    script.replies = [[{ name: 'submit_turn', arguments: { note: null, n: 2 } }]];
    const r = await runPiTurn<V>({ ...base, submit } as never);
    expect(r.value.note).toBe('');
  });

  it('checkSubmit sends back once, then the second value is returned', async () => {
    script.replies = [call('first'), call('second')];
    const check = vi.fn((v: unknown) => ((v as V).note === 'first' ? 'say it again' : null));
    const r = await runPiTurn<V>({ ...base, submit, checkSubmit: check } as never);
    expect(r.value.note).toBe('second');
    expect(r.requests).toBe(2);
    expect(r.controlEvents.some(e => e.includes('say it again'))).toBe(true);
    expect(r.controlEvents).not.toContain('repeat-accepted');
  });

  it('three failures: the third value is accepted with repeat-accepted', async () => {
    script.replies = [call('one'), call('two'), call('three')];
    const r = await runPiTurn<V>({ ...base, submit, checkSubmit: () => 'nope' } as never);
    expect(r.value.note).toBe('three');
    expect(r.requests).toBe(3);
    expect(r.controlEvents).toContain('repeat-accepted');
  });

  it('maxSendBacks 0 accepts the first value', async () => {
    script.replies = [call('one')];
    const r = await runPiTurn<V>({ ...base, submit, maxSendBacks: 0, checkSubmit: () => 'nope' } as never);
    expect(r.value.note).toBe('one');
    expect(r.controlEvents).toContain('repeat-accepted');
  });
});
