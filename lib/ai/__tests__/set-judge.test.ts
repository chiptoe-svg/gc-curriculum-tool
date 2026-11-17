import { describe, it, expect, beforeEach } from 'vitest';
import { judgeSet, SET_CUTOFFS } from '@/lib/ai/set-judge';

const target = { text: 'produce a packaged print job', course: 'GC 4400', context: 'GC 4400 Studio (catalog: builds jobs)' };
const pool = [
  { ref: 'r1', course: 'GC 1020', text: 'compose a booklet', context: 'GC 1020 Intro' },
  { ref: 'r2', course: 'GC 2070', text: 'prepare press files', context: 'GC 2070 Prepress' },
  { ref: 'r3', course: 'GC 3460', text: 'mix ink colors', context: 'GC 3460 Ink' },
];

type Calls = { prompts: string[] };
let calls: Calls;
let generated: string | null;
let pPartlyByCourse: Record<string, number>;
let failAll: boolean;

const yes = (p: number) => ({ choices: [{ logprobs: { content: [{ top_logprobs: [{ token: 'Yes', logprob: Math.log(p) }, { token: 'No', logprob: Math.log(1 - p) }] }] } }] });
const fetchImpl = (async (_url: string, init: RequestInit) => {
  const body = JSON.parse(init.body as string);
  const prompt: string = body.messages[0].content;
  calls.prompts.push(prompt);
  if (failAll) return new Response('x', { status: 500 });
  if (body.max_tokens === 24) return new Response(JSON.stringify({ choices: [{ message: { content: generated } }] }), { status: 200 });
  if (prompt.startsWith('Earlier course:')) {
    const code = /Earlier course: (GC \d+)/.exec(prompt)![1]!;
    return new Response(JSON.stringify(yes(pPartlyByCourse[code] ?? 0.9)), { status: 200 });
  }
  if (prompt.includes('Taken together, do some or all')) return new Response(JSON.stringify(yes(0.8)), { status: 200 });
  if (prompt.includes('Taken together, do these earlier courses')) return new Response(JSON.stringify(yes(0.7)), { status: 200 });
  return new Response(JSON.stringify(yes(0.3)), { status: 200 });
}) as unknown as typeof fetch;

beforeEach(() => {
  calls = { prompts: [] }; generated = '1, 2'; pPartlyByCourse = {}; failAll = false;
  process.env.CAMPUS_LLM_BASE_URL = 'http://campus.test'; process.env.CAMPUS_LLM_API_KEY = 'k';
});

describe('judgeSet', () => {
  it('has the provisional cut-offs', () => {
    expect(SET_CUTOFFS).toEqual({ any: 0.3, together: 0.6, combining: 0.5 });
  });

  it('asks the together question only about kept members', async () => {
    generated = '1, 3';
    pPartlyByCourse = { 'GC 3460': 0.001 }; // below the partly cut-off: dropped
    const v = await judgeSet(target, pool, { fetchImpl, retryDelayMs: 0 });
    expect(v.picked).toEqual(['r1', 'r3']);
    expect(v.kept).toEqual(['r1']);
    const together = calls.prompts.find((p) => p.includes('Taken together, do these earlier courses'))!;
    expect(together).toContain('1. GC 1020 Intro');
    expect(together).not.toContain('GC 3460');
    expect(together).not.toContain('GC 2070');
    expect(v.pAny).toBeCloseTo(0.8, 3); expect(v.pTogether).toBeCloseTo(0.7, 3); expect(v.pCombining).toBeCloseTo(0.3, 3);
  });

  it('returns no set when the generated answer is 0', async () => {
    generated = '0';
    const v = await judgeSet(target, pool, { fetchImpl, retryDelayMs: 0 });
    expect(v.picked).toEqual([]); expect(v.kept).toEqual([]);
    expect(v.pTogether).toBeNull(); expect(v.pCombining).toBeNull();
    expect(v.pAny).toBeCloseTo(0.8, 3);
    expect(calls.prompts.some((p) => p.includes('Taken together, do these earlier courses'))).toBe(false);
  });

  it('drops a pick the pair judge scores below partly', async () => {
    pPartlyByCourse = { 'GC 2070': 0.01 };
    const v = await judgeSet(target, pool, { fetchImpl, retryDelayMs: 0 });
    expect(v.picked).toEqual(['r1', 'r2']);
    expect(v.kept).toEqual(['r1']);
  });

  it('throws, rather than returning a null verdict, when the model never answers', async () => {
    failAll = true;
    await expect(judgeSet(target, pool, { fetchImpl, retryDelayMs: 0 })).rejects.toThrow();
  });
});
