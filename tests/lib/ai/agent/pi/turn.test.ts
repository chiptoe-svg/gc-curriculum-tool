// @vitest-environment node
/**
 * Pi plan Task 2 (+ rulings 2026-11-09): the interview turn on Pi. The model is
 * scripted by stubbing fetch with streamed chat-completions responses, so the
 * assertions read the request bodies as they go on the wire.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { runPiTurn, type PiTurnInput } from '@/lib/ai/agent/pi/turn';

type Body = Record<string, unknown> & { tool_choice?: unknown; messages: Array<{ role: string; content: unknown }> };
let bodies: Body[] = [];
let script: Array<(b: Body) => unknown[]> = [];

const sse = (chunks: unknown[]) => new Response(
  chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n',
  { status: 200, headers: { 'content-type': 'text/event-stream' } },
);
const usage = { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 400 } };
const call = (name: string, args: unknown, id = `call_${name}`) => [
  { choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: '' } }] } }] },
  { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] } }] },
  { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage },
];
const text = (t: string) => [
  { choices: [{ index: 0, delta: { role: 'assistant', content: t } }] },
  { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage },
];

const reply = (over: Record<string, unknown> = {}) => ({
  finding: 'The rubric grades the final menu only.',
  question: 'Do students get feedback before the final menu?',
  citations: [{ type: 'chunk', chunkId: 'c1', messageId: null, excerpt: 'Final menu: 40 points' }],
  readiness: { score: 40, covered: [], remaining: [], good_enough_to_generate: false },
  ...over,
});

const tools = [{
  name: 'search_materials',
  description: 'Search course materials',
  inputSchema: z.object({ query: z.string() }),
  execute: async () => [{ id: 'c1', materialId: 'm1', text: 'Final menu: 40 points' }],
}];

const input = (over: Partial<PiTurnInput> = {}): PiTurnInput => ({
  systemPrompt: 'You are the interviewer.',
  messages: [
    { role: 'user', content: '# Course catalog\nGC 1020' },
    { role: 'assistant', content: JSON.stringify({ question: 'How is the menu graded?' }) },
    { role: 'user', content: '[messageId=m-2]\nOnly the final submission is graded.' },
  ],
  tools: tools as never,
  userMessage: 'Only the final submission is graded.',
  fileNames: ['Menu brief.pdf'],
  courseCode: 'GC 1020',
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

describe('runPiTurn', () => {
  it('a valid submit_turn becomes the reply', async () => {
    script = [() => call('search_materials', { query: 'menu grading' }), () => call('submit_turn', reply())];
    const r = await runPiTurn(input());
    expect(r.value.question).toBe('Do students get feedback before the final menu?');
    expect(r.toolCallsUsed.map(t => t.toolName)).toEqual(['search_materials']);
  });

  it('a search-trigger turn forces search_materials on the first request', async () => {
    script = [() => call('search_materials', { query: 'menu grading' }), () => call('submit_turn', reply())];
    await runPiTurn(input());
    expect(bodies[0]!.tool_choice).toEqual({ type: 'function', function: { name: 'search_materials' } });
    expect(bodies[1]!.tool_choice).toBe('required');
  });

  it('a text reply is forced into submit_turn', async () => {
    script = [() => call('search_materials', { query: 'q' }), () => text('Here is my answer.'), () => call('submit_turn', reply())];
    const r = await runPiTurn(input());
    expect(r.controlEvents).toContain('replied in text; forced submit_turn');
    expect(bodies[2]!.tool_choice).toEqual({ type: 'function', function: { name: 'submit_turn' } });
    expect(r.value.finding).toMatch(/final menu/);
  });

  it('invalid citations are retried twice, then dropped', async () => {
    const bad = reply({ citations: [{ type: 'chunk', chunkId: 'ghost', messageId: null, excerpt: 'never retrieved' }] });
    script = [() => call('search_materials', { query: 'q' }), () => call('submit_turn', bad, 'a'), () => call('submit_turn', bad, 'b'), () => call('submit_turn', bad, 'c')];
    const r = await runPiTurn(input());
    expect(r.controlEvents.filter(e => e.endsWith('sent back'))).toHaveLength(2);
    expect(r.value.citations).toEqual([]);
  });

  it('a citation quote over 200 characters is trimmed, not rejected', async () => {
    const long = reply({ citations: [{ type: 'chunk', chunkId: 'c1', messageId: null, excerpt: 'menu '.repeat(60).trim() }] });
    script = [() => call('search_materials', { query: 'q' }), () => call('submit_turn', long)];
    const r = await runPiTurn(input());
    expect(r.value.citations[0]!.excerpt.length).toBeLessThanOrEqual(200);
    expect(r.requests).toBe(2);
  });

  it('every request body carries a 16000 token cap and temperature 0.2', async () => {
    script = [() => call('search_materials', { query: 'q' }), () => call('submit_turn', reply())];
    await runPiTurn(input());
    for (const b of bodies) {
      expect(b.max_tokens ?? b.max_completion_tokens).toBe(16000);
      expect(b.temperature).toBe(0.2);
    }
  });

  it('campus off sends enable_thinking false', async () => {
    script = [() => call('search_materials', { query: 'q' }), () => call('submit_turn', reply())];
    await runPiTurn(input());
    expect(bodies[0]!.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it('costUsdCents is computed from tokens and does not double-count cache writes', async () => {
    script = [() => call('search_materials', { query: 'q' }), () => call('submit_turn', reply())];
    const r = await runPiTurn(input({ endpoint: { baseUrl: 'http://gateway.test/v1', apiKey: 'k', model: 'gpt-6.1-terra', api: 'openai-completions' } }));
    // 2 requests × (600 uncached + 400 cached in, 100 out) at Terra $1/M in, $5/M out, cached at 10%.
    expect(r.telemetry.uncachedPromptTokens).toBe(1200);
    expect(r.telemetry.cachedTokens).toBe(800);
    expect(r.telemetry.completionTokens).toBe(200);
    expect(r.telemetry.costUsdCents).toBeGreaterThan(0);
  });

  it('emits tool-start for a tool call and text-delta while submit_turn streams', async () => {
    script = [() => call('search_materials', { query: 'q' }), () => call('submit_turn', reply())];
    const events: Array<{ kind: string }> = [];
    await runPiTurn(input({ onEvent: e => events.push(e) }));
    expect(events[0]).toMatchObject({ kind: 'tool-start', toolName: 'search_materials' });
    expect(events.some(e => e.kind === 'text-delta')).toBe(true);
  });
});

describe('model change across turns (Pi plan Task 4)', () => {
  it('three turns on OpenAI, then campus, then OpenAI keep one session and the full history', async () => {
    const openai = { baseUrl: 'http://gateway.test/v1', apiKey: 'k', model: 'gpt-6.1-terra', api: 'openai-completions' as const };
    const campus = { baseUrl: 'http://campus.test/v1', apiKey: 'k', model: 'qwen3.8-27b-fp8', api: 'openai-completions' as const, campusReasoning: 'off' as const };
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [{ role: 'user', content: '# Course catalog\nGC 1020' }];
    const answers = ['[messageId=a1]\nThey design a logo first.', '[messageId=a2]\nThen a menu.', '[messageId=a3]\nThe menu is the final.'];
    const endpoints = [openai, campus, openai];
    for (let t = 0; t < 3; t++) {
      history.push({ role: 'user', content: answers[t]! });
      bodies = [];
      script = [() => call('submit_turn', reply({ question: `Question ${t + 1}?`, citations: [] }))];
      const r = await runPiTurn(input({ messages: [...history], userMessage: answers[t], fileNames: [], endpoint: endpoints[t]! }));
      const sent = JSON.stringify(bodies[0]!.messages);
      for (const a of answers.slice(0, t + 1)) expect(sent).toContain(a.split('\n')[1]!);
      for (let k = 1; k <= t; k++) expect(sent).toContain(`Question ${k}?`);
      history.push({ role: 'assistant', content: JSON.stringify(r.value) });
    }
  });
});

describe('review fixes', () => {
  it('sends temperature only to campus models (OpenAI gpt-6 rejects it)', async () => {
    script = [() => call('search_materials', { query: 'q' }), () => call('submit_turn', reply())];
    await runPiTurn(input({ endpoint: { baseUrl: 'http://gateway.test/v1', apiKey: 'k', model: 'gpt-6.1-terra', api: 'openai-completions', reasoning: 'medium' } }));
    for (const b of bodies) expect(b.temperature).toBeUndefined();
  });

  it('never forces a search tool the request does not offer', async () => {
    script = [() => call('submit_turn', reply({ citations: [] }))];
    await runPiTurn(input({ tools: [] as never }));
    expect(bodies[0]!.tool_choice).toBe('required');
  });

  it('forces the search only when the caller says the exchange needs one', async () => {
    script = [() => call('search_materials', { query: 'q' }), () => call('submit_turn', reply())];
    await runPiTurn(input({ requireSearchFirst: false }));
    expect(bodies[0]!.tool_choice).toBe('required');
  });
});

