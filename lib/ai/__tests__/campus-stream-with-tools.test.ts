// @vitest-environment node
/** Part 2 Task 4: the campus provider streams tool use with the OpenAI provider's event order (interview on campus). */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

const create = vi.hoisted(() => vi.fn());
vi.mock('openai', () => {
  class APIError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }
  return { default: class MockOpenAI { static APIError = APIError; chat = { completions: { create } }; constructor(_o: unknown) {} }, APIError };
});

const toolCall = (name: string) => ({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name, arguments: '{"query":"rubric"}' } }] } }], usage: { prompt_tokens: 10, completion_tokens: 2 } });
const done = { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } };
async function* chunks(text: string) {
  for (const piece of [text.slice(0, 5), text.slice(5)]) yield { choices: [{ delta: { content: piece } }] };
  yield { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 5 } };
}
const tools = [{ name: 'search_materials', description: 'search', inputSchema: z.object({ query: z.string() }), execute: async () => [{ id: 'c1' }] }];
const args = (extra: Record<string, unknown> = {}) => ({ systemPrompt: 's', messages: [{ role: 'user' as const, content: 'u' }], tools: tools as never, schemaName: 'r', jsonSchema: {}, validate: (r: unknown) => r as { a: number }, ...extra });

async function collect(gen: AsyncIterable<unknown>) { const out: Array<{ kind: string }> = []; for await (const e of gen) out.push(e as { kind: string }); return out; }

describe('campus streamWithTools', () => {
  beforeEach(() => { create.mockReset(); });

  it("streams text deltas and tool calls in the OpenAI provider's event order", async () => {
    const { CampusProvider } = await import('../campus');
    create.mockImplementation(async (body: { stream?: boolean }) => (body.stream ? chunks('{"a": 1}') : create.mock.calls.length === 1 ? toolCall('search_materials') : done));
    const events = await collect(new CampusProvider('qwen3.8-27b-fp8', 'http://x', 'k', { reasoning: 'off' }).streamWithTools(args()));
    expect(events.map(e => e.kind)).toEqual(['tool-start', 'text-delta', 'text-delta', 'final']);
    expect(events.at(-1)).toMatchObject({ kind: 'final', value: { a: 1 }, toolCallsUsed: [{ toolName: 'search_materials' }] });
  });

  it('requireToolFirst sends tool_choice required on the first request only', async () => {
    const { CampusProvider } = await import('../campus');
    create.mockImplementation(async (body: { stream?: boolean }) => (body.stream ? chunks('{"a": 1}') : create.mock.calls.length === 1 ? toolCall('search_materials') : done));
    await collect(new CampusProvider('qwen3.8-27b-fp8', 'http://x', 'k').streamWithTools(args({ requireToolFirst: ['search_materials'] })));
    expect(create.mock.calls[0]![0].tool_choice).toBe('required');
    expect(create.mock.calls[0]![0].tools.map((t: { function: { name: string } }) => t.function.name)).toEqual(['search_materials']);
    expect(create.mock.calls[1]![0].tool_choice).toBe('auto');
  });

  it('a 400 on forced tool choice retries without it and logs once', async () => {
    const { CampusProvider } = await import('../campus');
    const { APIError } = await import('openai') as unknown as { APIError: new (s: number, m: string) => Error };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    create.mockImplementation(async (body: { stream?: boolean; tool_choice?: string }) => {
      if (body.stream) return chunks('{"a": 1}');
      if (body.tool_choice === 'required') throw new APIError(400, 'tool_choice required not supported');
      return done;
    });
    const events = await collect(new CampusProvider('qwen3.8-27b-fp8', 'http://x', 'k').streamWithTools(args({ requireToolFirst: ['search_materials'] })));
    expect(events.at(-1)!.kind).toBe('final');
    expect(warn.mock.calls.filter(c => String(c[0]).includes('forced tool choice rejected'))).toHaveLength(1);
    warn.mockRestore();
  });
});
