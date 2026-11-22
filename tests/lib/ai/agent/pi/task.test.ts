// @vitest-environment node
/** Generic Pi task loop (agents-vs-single-calls benchmark, Task 1). Pi is scripted by stubbing fetch, as in turn.test.ts. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { runPiTask, type PiTaskInput } from '@/lib/ai/agent/pi/task';
import { costUsdCents, costCredits } from '@/lib/ai/prices';

type Body = Record<string, unknown> & { tool_choice?: unknown };
let bodies: Body[] = [];
let script: Array<(b: Body) => unknown[]> = [];

const sse = (chunks: unknown[]) => new Response(
  chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n',
  { status: 200, headers: { 'content-type': 'text/event-stream' } },
);
// prompt 1000 = 500 fresh + 400 cache read + 100 cache write; 100 out.
const usage = { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 400, cache_write_tokens: 100 } };
const call = (name: string, args: unknown, id = `call_${name}`) => [
  { choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: '' } }] } }] },
  { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] } }] },
  { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage },
];
const text = (t: string) => [
  { choices: [{ index: 0, delta: { role: 'assistant', content: t } }] },
  { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage },
];

const lookup = {
  name: 'lookup', description: 'Look something up', inputSchema: z.object({ q: z.string() }),
  execute: async () => ({ hit: 'x' }),
};
const input = (over: Partial<PiTaskInput> = {}): PiTaskInput => ({
  systemPrompt: 'You score things.', userMessage: 'Score it.', tools: [lookup] as never,
  submitSchema: { type: 'object', properties: { score: { type: 'number' } }, required: ['score'], additionalProperties: false },
  submitDescription: 'Deliver the score.',
  endpoint: { baseUrl: 'http://gateway.test/v1', apiKey: 'k', model: 'qwen3.8-27b-fp8', api: 'openai-completions', campusReasoning: 'off' },
  ...over,
});

beforeEach(() => {
  bodies = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: string }) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Body;
    bodies.push(body);
    const next = script.shift();
    if (!next) throw new Error('script ran out');
    return sse(next(body));
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('runPiTask', () => {
  it('returns the submit arguments as value', async () => {
    script = [() => call('lookup', { q: 'a' }), () => call('submit', { score: 3 })];
    const r = await runPiTask<{ score: number }>(input());
    expect(r.value).toEqual({ score: 3 });
    expect(r.toolCalls).toEqual([{ name: 'lookup', args: { q: 'a' } }]);
    expect(r.forcedSubmit).toBe(false);
    expect(r.requests).toBe(2);
  });

  it('forces submit after maxToolCalls tool calls and sets forcedSubmit=true', async () => {
    script = [() => call('lookup', { q: 'a' }, 'a'), () => call('lookup', { q: 'b' }, 'b'), () => call('submit', { score: 1 })];
    const r = await runPiTask<{ score: number }>(input({ maxToolCalls: 2 }));
    expect(bodies[2]!.tool_choice).toEqual({ type: 'function', function: { name: 'submit' } });
    expect(bodies[1]!.tool_choice).toBe('required');
    expect(r.forcedSubmit).toBe(true);
    expect(r.value).toEqual({ score: 1 });
  });

  it('counts tokens from every assistant message into TokenCounts exactly as turn.ts now feeds costUsdCents', async () => {
    script = [() => call('lookup', { q: 'a' }), () => call('submit', { score: 3 })];
    const r = await runPiTask(input({ endpoint: { baseUrl: 'http://gateway.test/v1', apiKey: 'k', model: 'claude-sonnet-4-6', api: 'openai-completions', reasoning: undefined } }));
    // Per request: freshInput 500, cachedInput 400, output 100, cacheWrite 100 (counted separately, per lib/ai/prices.ts TokenCounts).
    expect(r.tokens).toEqual({ freshInput: 1000, cachedInput: 800, output: 200, cacheWrite: 200 });
    expect(r.usdUnits).toBe(costUsdCents('claude-sonnet-4-6', r.tokens));
    expect(r.usdUnits).toBeGreaterThan(0);
  });

  it('prices campus models at 0 usd and 0 credits', async () => {
    script = [() => call('submit', { score: 3 })];
    const r = await runPiTask(input());
    expect(r.usdUnits).toBe(0);
    expect(r.credits).toBe(0);
  });

  it('prices credits via the gateway rate for a paid model', async () => {
    script = [() => call('submit', { score: 3 })];
    const r = await runPiTask(input({ endpoint: { baseUrl: 'http://gateway.test/v1', apiKey: 'k', model: 'gpt-6.1-sol', api: 'openai-completions' } }));
    expect(r.credits).toBe(costCredits('gpt-6.1-sol', r.tokens));
    expect(r.credits).toBeGreaterThan(0);
  });

  it('throws when the model never calls submit even after forcing', async () => {
    script = [() => text('I refuse.'), () => text('Still no.'), () => text('No.'), () => text('No.'), () => text('No.'), () => text('No.')];
    await expect(runPiTask(input())).rejects.toThrow(/no submit/);
  });
});
