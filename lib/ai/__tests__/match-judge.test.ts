import { describe, it, expect } from 'vitest';
import { pYes, judgePairs, judgePrompt, MODELS, MODEL_IN_USE, PROMPT_VERSION, CUTOFFS, type PairText } from '@/lib/ai/match-judge';

const pair: PairText = {
  requiredText: 'lay out a page', requiredCourse: 'GC 3460', requiredTitle: 'Print',
  suppliedText: 'compose a booklet', suppliedCourse: 'GC 1020', suppliedTitle: 'Intro',
};

describe('pYes', () => {
  it('is Yes over Yes+No, trimmed and case-insensitive', () => {
    const p = pYes([{ token: 'No', logprob: -0.672 }, { token: ' yes', logprob: -0.797 }, { token: 'The', logprob: -3 }]);
    expect(p).toBeCloseTo(Math.exp(-0.797) / (Math.exp(-0.797) + Math.exp(-0.672)), 6);
    expect(p).toBeCloseTo(0.469, 2);
  });
  it('is null without yes/no tokens', () => {
    expect(pYes([{ token: 'Maybe', logprob: -0.1 }])).toBeNull();
    expect(pYes([])).toBeNull();
  });
});

describe('constants', () => {
  it('match the plan', () => {
    expect(MODELS).toEqual(['qwen3.8-27b-fp8', 'deepseek-v4.1-flash-1017']);
    expect(MODEL_IN_USE).toBe('qwen3.8-27b-fp8');
    expect(PROMPT_VERSION).toBe('m1');
    expect(CUTOFFS['qwen3.8-27b-fp8']).toEqual({ fully: 0.6, partly: 0.9 });
    expect(CUTOFFS['deepseek-v4.1-flash-1017']).toEqual({ fully: 0.75, partly: 0.95 });
  });
  it('prompt carries the context and the question', () => {
    const t = judgePrompt('fully', pair);
    expect(t.startsWith('Earlier course: GC 1020 Intro. It develops: "compose a booklet"\nLater course: GC 3460 Print. Students must arrive able to: "lay out a page"\n\n')).toBe(true);
    expect(t.endsWith('Answer Yes or No.')).toBe(true);
    expect(judgePrompt('partly', pair)).toContain('at least part of the activity');
  });
});

describe('judgePairs', () => {
  it('sends the exact body and returns both probabilities', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      expect(String(url)).toMatch(/\/chat\/completions$/);
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      const fully = String(body.messages[0].content).includes('develop the activity that');
      const top = fully
        ? [{ token: 'Yes', logprob: Math.log(0.8) }, { token: 'No', logprob: Math.log(0.2) }]
        : [{ token: 'Yes', logprob: Math.log(0.5) }, { token: 'No', logprob: Math.log(0.5) }];
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Yes' }, logprobs: { content: [{ top_logprobs: top }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    process.env.CAMPUS_LLM_BASE_URL = 'http://x/v1';
    process.env.CAMPUS_LLM_API_KEY = 'k';
    const out = await judgePairs([pair], { fetchImpl });
    expect(out).toHaveLength(1);
    expect(out[0]!.pFully).toBeCloseTo(0.8);
    expect(out[0]!.pPartly).toBeCloseTo(0.5);
    expect(bodies).toHaveLength(2);
    for (const b of bodies) {
      expect(b).toMatchObject({ model: MODEL_IN_USE, max_tokens: 1, temperature: 0, logprobs: true, top_logprobs: 20, chat_template_kwargs: { enable_thinking: false } });
    }
  });
  it('retries then yields null', async () => {
    let n = 0;
    const fetchImpl = (async () => { n++; return new Response('boom', { status: 500 }); }) as unknown as typeof fetch;
    process.env.CAMPUS_LLM_BASE_URL = 'http://x/v1';
    process.env.CAMPUS_LLM_API_KEY = 'k';
    const out = await judgePairs([pair], { fetchImpl, retryDelayMs: 0 });
    expect(out[0]).toEqual({ pFully: null, pPartly: null });
    expect(n).toBe(10); // 2 questions x (1 try + 4 retries)
  });
  it('keeps the last error message', async () => {
    const fetchImpl = (async () => new Response('boom', { status: 503 })) as unknown as typeof fetch;
    process.env.CAMPUS_LLM_BASE_URL = 'http://x/v1';
    process.env.CAMPUS_LLM_API_KEY = 'secret-key';
    const errorSink = { message: null as string | null };
    await judgePairs([pair], { fetchImpl, retryDelayMs: 0, errorSink });
    expect(errorSink.message).toBe('HTTP 503');
  });
  it('fails fast when the campus model is not configured', async () => {
    const saved = [process.env.CAMPUS_LLM_BASE_URL, process.env.CAMPUS_LLM_API_KEY];
    delete process.env.CAMPUS_LLM_BASE_URL;
    delete process.env.CAMPUS_LLM_API_KEY;
    try {
      await expect(judgePairs([pair])).rejects.toThrow(/not configured/);
    } finally {
      process.env.CAMPUS_LLM_BASE_URL = saved[0]; process.env.CAMPUS_LLM_API_KEY = saved[1];
    }
  });
});
