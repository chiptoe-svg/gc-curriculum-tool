import { describe, it, expect, vi, beforeEach } from 'vitest';
import { textHash } from '@/lib/catalog/bundles';
import { normalizeStatement } from '@/lib/catalog/project-trail';

const h = (s: string) => textHash(normalizeStatement(s));
const PLAN = '8b1f0c2e-0000-4000-8000-000000000001';
const SNAP_A = '8b1f0c2e-0000-4000-8000-0000000000a1';
const SNAP_B = '8b1f0c2e-0000-4000-8000-0000000000b1';

const state = vi.hoisted(() => ({
  selects: [] as unknown[][], // queued results, one per db.select() call
  inserted: [] as Array<Record<string, unknown>>,
  cache: new Map<string, { pFully: number; pPartly: number }>(), // `${model}|${req}|${sup}`
  vectors: new Map<string, number[]>(),
  asked: [] as Array<{ model?: string; n: number }>,
  failRead: false,
  judgeImpl: null as null | ((pairs: unknown[], opts: { model?: string; errorSink?: { message: string | null } }) => Promise<Array<{ pFully: number | null; pPartly: number | null }>>),
}));

vi.mock('@/lib/auth/route-auth', () => ({ authorizeRequest: async () => ({ grant: { id: 'g', label: 'Dr Who', scope: ['*'], can: ['capture'] } }) }));
vi.mock('@/lib/auth/viewer', () => ({ personalName: (g: { label: string } | null) => g?.label ?? null }));
vi.mock('@/lib/db/client', () => ({
  db: { select: () => ({ from: () => ({ where: async () => state.selects.shift() ?? [] }) }) },
}));
vi.mock('@/lib/db/bundle-queries', () => ({
  embedMissing: async () => ({ cached: 0, embedded: 0 }),
  readVectors: async () => state.vectors,
}));
vi.mock('@/lib/ai/embeddings', () => ({
  DEFAULT_EMBEDDING_MODEL: 'emb', embedBatch: async () => [],
  cosineSimilarity: (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0),
}));
vi.mock('@/lib/db/match-queries', () => ({
  insertDecision: async (d: Record<string, unknown>) => { state.inserted.push(d); },
  readJudgments: async (pairs: Array<{ requiredHash: string; suppliedHash: string }>, model: string) => {
    if (state.failRead) throw new Error('connection to database lost');
    const out = new Map<string, { pFully: number; pPartly: number }>();
    for (const p of pairs) { const v = state.cache.get(`${model}|${p.requiredHash}|${p.suppliedHash}`); if (v) out.set(`${p.requiredHash}|${p.suppliedHash}`, v); }
    return out;
  },
  writeJudgments: async (rows: Array<{ requiredHash: string; suppliedHash: string; model: string; pFully: number; pPartly: number }>) => {
    for (const r of rows) state.cache.set(`${r.model}|${r.requiredHash}|${r.suppliedHash}`, { pFully: r.pFully, pPartly: r.pPartly });
  },
}));
vi.mock('@/lib/ai/match-judge', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai/match-judge')>()),
  judgePairs: async (pairs: unknown[], opts: { model?: string; errorSink?: { message: string | null } }) => {
    state.asked.push({ model: opts.model, n: pairs.length });
    return state.judgeImpl ? state.judgeImpl(pairs, opts) : pairs.map(() => ({ pFully: 0.8, pPartly: 0.9 }));
  },
}));

import { POST } from '@/app/api/build/match/route';

const post = (body: unknown) => POST(new Request('http://x/api/build/match', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  state.selects = []; state.inserted = []; state.cache.clear(); state.vectors = new Map(); state.asked = []; state.judgeImpl = null; state.failRead = false;
});

describe('POST /api/build/match decide', () => {
  const reqText = 'lay out a page', supText = 'compose a booklet';
  it('reads the captured text, not the body', async () => {
    state.selects = [
      [{ id: PLAN }],
      [{ courseCode: 'GC 3460', profile: { incoming_expectations: [{ statement: reqText }] } }],
      [{ courseCode: 'GC 1020', profile: { competencies: [{ statement: supText }] } }],
      [{ code: 'GC 3460', title: 'Print Real' }, { code: 'GC 1020', title: 'Intro Real' }],
    ];
    state.cache.set(`qwen3.8-27b-fp8|${h(reqText)}|${h(supText)}`, { pFully: 0.7, pPartly: 0.95 });
    const res = await post({
      action: 'decide', planId: PLAN, label: 'partly', reason: ' close ',
      required: { course: 'GC 9999', title: 'Print', snapshotId: SNAP_A, ref: h(reqText), text: 'FORGED required' },
      supplied: { course: 'GC 8888', title: 'Intro', snapshotId: SNAP_B, ref: h(supText), text: 'FORGED supplied' },
    });
    expect(res.status).toBe(200);
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      requiredText: reqText, suppliedText: supText, requiredCourse: 'GC 3460', suppliedCourse: 'GC 1020', requiredCourseTitle: 'Print Real', suppliedCourseTitle: 'Intro Real',
      draft: false, label: 'partly', reason: 'close', decidedBy: 'Dr Who', source: 'map', planId: PLAN,
      judgeModel: 'qwen3.8-27b-fp8', promptVersion: 'm1', judgePFully: 0.7, judgePPartly: 0.95,
    });
  });

  it('404 when the ref is not in the capture', async () => {
    state.selects = [[{ id: PLAN }], [{ courseCode: 'GC 3460', profile: { incoming_expectations: [{ statement: 'something else' }] } }]];
    const res = await post({
      action: 'decide', planId: PLAN, label: 'fully',
      required: { course: 'GC 3460', title: '', snapshotId: SNAP_A, ref: h(reqText), text: reqText },
      supplied: { course: 'GC 1020', title: '', snapshotId: null, ref: h(supText), text: supText },
    });
    expect(res.status).toBe(404);
    expect(state.inserted).toHaveLength(0);
  });

  it('a side without a snapshot is a draft and uses the body text', async () => {
    state.selects = [[{ id: PLAN }], [{ courseCode: 'GC 3460', profile: { incoming_expectations: [{ statement: reqText }] } }], [{ code: 'GC 3460', title: 'Print' }, { code: 'GC 1020', title: 'Intro' }]];
    const res = await post({
      action: 'decide', planId: PLAN, label: 'not',
      required: { course: 'GC 3460', title: 'Print', snapshotId: SNAP_A, ref: h(reqText), text: reqText },
      supplied: { course: 'GC 1020', title: 'Intro', snapshotId: null, ref: 'ignored', text: 'a brand new skill' },
    });
    expect(res.status).toBe(200);
    expect(state.inserted[0]).toMatchObject({ draft: true, suppliedText: 'a brand new skill', suppliedHash: h('a brand new skill'), judgePFully: null });
  });

  it('400 for a draft side whose course is neither in the catalog nor proposed on the plan; accepts new: and plan-proposed ids', async () => {
    const mk = (course: string) => ({
      action: 'decide', planId: PLAN, label: 'fully',
      required: { course, title: '', snapshotId: null, ref: 'r', text: 'a new required skill' },
      supplied: { course: 'GC 1020', title: '', snapshotId: null, ref: 's', text: 'a new supplied skill' },
    });
    const real = [{ code: 'GC 1020', title: 'Intro' }];
    state.selects = [[{ id: PLAN, state: { proposed: [] } }], real];
    expect((await post(mk('GC 9999'))).status).toBe(400);
    state.selects = [[{ id: PLAN, state: { proposed: [] } }], real];
    expect((await post(mk('new:abc'))).status).toBe(200);
    state.selects = [[{ id: PLAN, state: { proposed: [{ id: 'prop-1' }] } }], real];
    expect((await post(mk('prop-1'))).status).toBe(200);
  });

  it('404 when the plan does not exist; 400 for a bad label', async () => {
    const side = { course: 'GC 1', title: '', snapshotId: null, ref: 'r', text: 'x' };
    state.selects = [[]];
    expect((await post({ action: 'decide', planId: PLAN, label: 'fully', required: side, supplied: side })).status).toBe(404);
    expect((await post({ action: 'decide', planId: PLAN, label: 'maybe', required: side, supplied: side })).status).toBe(400);
  });
});

describe('POST /api/build/match judge', () => {
  const others = Array.from({ length: 8 }, (_, i) => ({ ref: `o${i}`, text: `other skill ${i}`, course: 'GC 1020', title: 'Intro' }));
  const anchor = { text: 'lay out a page', course: 'GC 3460', title: 'Print', side: 'required' as const };
  const setVectors = () => {
    state.vectors = new Map([[h(anchor.text), [1, 0]]]);
    others.forEach((o, i) => state.vectors.set(h(o.text), [1 - i * 0.1, i * 0.1])); // o0 most similar
  };

  it('judges the top 5 by similarity and asks only uncached pairs', async () => {
    setVectors();
    // o0's pair is already cached for both models.
    for (const m of ['qwen3.8-27b-fp8', 'deepseek-v4.1-flash-1017']) state.cache.set(`${m}|${h(anchor.text)}|${h(others[0]!.text)}`, { pFully: 0.5, pPartly: 0.6 });
    const res = await post({ action: 'judge', anchor, others });
    expect(res.status).toBe(200);
    const { results } = await res.json();
    expect(results.map((r: { ref: string }) => r.ref)).toEqual(['o0', 'o1', 'o2', 'o3', 'o4']);
    expect(results[0]).toMatchObject({ pFully: 0.5, pPartly: 0.6 });
    expect(results[1]).toMatchObject({ pFully: 0.8, pPartly: 0.9 });
    expect(state.asked).toEqual([{ model: 'qwen3.8-27b-fp8', n: 4 }, { model: 'deepseek-v4.1-flash-1017', n: 4 }]);
    // A second call asks nothing.
    state.asked = [];
    await post({ action: 'judge', anchor, others });
    expect(state.asked).toEqual([]);
  });

  it('puts the anchor on the supplied side when side is supplied', async () => {
    setVectors();
    let first: { requiredText: string; suppliedText: string } | undefined;
    state.judgeImpl = async (pairs) => { first ??= pairs[0] as typeof first; return pairs.map(() => ({ pFully: 0.1, pPartly: 0.2 })); };
    await post({ action: 'judge', anchor: { ...anchor, side: 'supplied' }, others });
    expect(first).toMatchObject({ suppliedText: anchor.text, requiredText: 'other skill 0' });
  });

  it('caches under the hash of the text, not the client ref', async () => {
    setVectors();
    state.vectors.set(h('forged text'), [1, 0]);
    const forged = [{ ref: h('some other skill'), text: 'forged text', course: 'GC 1', title: '' }];
    const res = await post({ action: 'judge', anchor, others: forged });
    expect(res.status).toBe(200);
    expect(state.cache.has(`qwen3.8-27b-fp8|${h(anchor.text)}|${h('forged text')}`)).toBe(true);
    expect(state.cache.has(`qwen3.8-27b-fp8|${h(anchor.text)}|${h('some other skill')}`)).toBe(false);
    expect((await res.json()).results[0].ref).toBe(h('some other skill'));
  });

  it('400 for an over-long course, title or ref', async () => {
    const long = (n: number) => 'x'.repeat(n);
    expect((await post({ action: 'judge', anchor: { ...anchor, course: long(41) }, others })).status).toBe(400);
    expect((await post({ action: 'judge', anchor, others: [{ ...others[0], title: long(201) }] })).status).toBe(400);
    expect((await post({ action: 'judge', anchor, others: [{ ...others[0], ref: long(65) }] })).status).toBe(400);
  });

  it('refuses more than 400 others', async () => {
    const many = Array.from({ length: 401 }, (_, i) => ({ ref: `m${i}`, text: 't', course: 'GC 1', title: '' }));
    expect((await post({ action: 'judge', anchor, others: many })).status).toBe(400);
  });

  it('502 with a plain message when the campus model fails', async () => {
    setVectors();
    state.judgeImpl = async (pairs, opts) => { if (opts.errorSink) opts.errorSink.message = 'HTTP 503'; return pairs.map(() => ({ pFully: null, pPartly: null })); };
    const res = await post({ action: 'judge', anchor, others });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/not reachable.*HTTP 503/);
  });

  it('500 with a generic message (not the campus message) when something else fails', async () => {
    setVectors();
    state.failRead = true;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post({ action: 'judge', anchor, others });
    expect(res.status).toBe(500);
    const msg = (await res.json()).error as string;
    expect(msg).not.toMatch(/campus|database/i);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
