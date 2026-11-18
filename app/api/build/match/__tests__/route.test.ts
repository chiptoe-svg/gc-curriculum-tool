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
  clusters: new Map<string, { state: unknown }>(),
  setCache: new Map<string, Record<string, unknown>>(),
  setWrites: [] as Array<Record<string, unknown>>,
  setAsked: 0,
  setImpl: null as null | ((target: unknown, pool: Array<{ ref: string }>) => Promise<Record<string, unknown>>),
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
vi.mock('@/lib/db/cluster-queries', () => ({ getCluster: async (id: string) => state.clusters.get(id) ?? null }));
vi.mock('@/lib/db/set-judgment-queries', () => ({
  readSetJudgment: async (k: { targetHash: string; poolHash: string }) => state.setCache.get(`${k.targetHash}|${k.poolHash}`) ?? null,
  writeSetJudgment: async (k: { targetHash: string; poolHash: string }, v: Record<string, unknown>) => { state.setWrites.push({ ...k, ...v }); state.setCache.set(`${k.targetHash}|${k.poolHash}`, v); },
}));
vi.mock('@/lib/ai/set-judge', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai/set-judge')>()),
  judgeSet: async (target: unknown, pool: Array<{ ref: string }>) => {
    state.setAsked++;
    if (!state.setImpl) return { pAny: 0.8, picked: pool.slice(0, 2).map((p) => p.ref), kept: pool.slice(0, 2).map((p) => p.ref), pTogether: 0.7, pCombining: 0.4 };
    return state.setImpl(target, pool);
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
  state.clusters = new Map(); state.setCache = new Map(); state.setWrites = []; state.setAsked = 0; state.setImpl = null;
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
  const others = Array.from({ length: 10 }, (_, i) => ({ ref: `o${i}`, text: `other skill ${i}`, course: 'GC 1020', title: 'Intro' }));
  const anchor = { text: 'lay out a page', course: 'GC 3460', title: 'Print', side: 'required' as const };
  const setVectors = () => {
    state.vectors = new Map([[h(anchor.text), [1, 0]]]);
    others.forEach((o, i) => state.vectors.set(h(o.text), [1 - i * 0.05, i * 0.05])); // o0 most similar
  };

  it('judges the top 8 by similarity (as the batch and the composite experiment do) with the model in use only, and asks only uncached pairs', async () => {
    setVectors();
    // o0's pair is already cached for both models.
    for (const m of ['qwen3.8-27b-fp8', 'deepseek-v4.1-flash-1017']) state.cache.set(`${m}|${h(anchor.text)}|${h(others[0]!.text)}`, { pFully: 0.5, pPartly: 0.6 });
    const res = await post({ action: 'judge', anchor, others });
    expect(res.status).toBe(200);
    const { results } = await res.json();
    expect(results.map((r: { ref: string }) => r.ref)).toEqual(['o0', 'o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7']);
    expect(results[0]).toMatchObject({ pFully: 0.5, pPartly: 0.6 });
    expect(results[1]).toMatchObject({ pFully: 0.8, pPartly: 0.9 });
    expect(state.asked).toEqual([{ model: 'qwen3.8-27b-fp8', n: 7 }]);
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

  it('502 with a fixed message when the campus model fails; the upstream detail is only logged', async () => {
    setVectors();
    state.judgeImpl = async (pairs, opts) => { if (opts.errorSink) opts.errorSink.message = 'HTTP 503 from http://campus.example/v1'; return pairs.map(() => ({ pFully: null, pPartly: null })); };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await post({ action: 'judge', anchor, others });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('The campus model did not answer; try again.');
    expect(warn.mock.calls.flat().join(' ')).toMatch(/HTTP 503/);
    warn.mockRestore();
  });

  it('takes prompt titles from the courses table and the plan, not the body', async () => {
    setVectors();
    const mixed = [
      { ref: 'o0', text: 'other skill 0', course: 'GC 1020', title: 'FORGED' },
      { ref: 'o1', text: 'other skill 1', course: 'new:abc', title: 'FORGED too' },
      { ref: 'o2', text: 'other skill 2', course: 'GC 9999', title: 'x'.repeat(200) },
    ];
    state.selects = [[{ code: 'GC 3460', title: 'Print Real' }, { code: 'GC 1020', title: 'Intro Real' }], [{ state: { proposed: [{ id: 'new:abc', code: 'GC 4990', title: 'Proposed Lab' }] } }]];
    const seen: Array<{ requiredTitle: string; suppliedCourse: string; suppliedTitle: string }> = [];
    state.judgeImpl = async (pairs) => { seen.push(...(pairs as typeof seen)); return pairs.map(() => ({ pFully: 0.1, pPartly: 0.2 })); };
    const res = await post({ action: 'judge', planId: PLAN, anchor: { ...anchor, title: 'FORGED anchor' }, others: mixed });
    expect(res.status).toBe(200);
    const by = new Map(seen.map((p) => [p.suppliedCourse, p]));
    expect(seen.every((p) => p.requiredTitle === 'Print Real')).toBe(true);
    expect(by.get('GC 1020')?.suppliedTitle).toBe('Intro Real');
    expect(by.get('new:abc')?.suppliedTitle).toBe('Proposed Lab');
    expect(by.get('GC 9999')?.suppliedTitle).toBe('x'.repeat(200));
  });

  it('400 for a malformed plan id', async () => {
    expect((await post({ action: 'judge', planId: 'nope', anchor, others })).status).toBe(400);
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

describe('POST /api/build/match with a cluster', () => {
  const CLUSTER = '8b1f0c2e-0000-4000-8000-0000000000c1';
  const side = (course: string, text: string) => ({ course, title: '', snapshotId: null, ref: 'r', text });

  it('decide with clusterId stores source cluster and plan_id = clusterId, reading proposed courses from the cluster', async () => {
    state.clusters.set(CLUSTER, { state: { proposed: [{ id: 'prop-1', code: 'GC 4990', title: 'Lab' }] } });
    state.selects = [[{ code: 'GC 1020', title: 'Intro' }]];
    const res = await post({ action: 'decide', clusterId: CLUSTER, label: 'partly', required: side('prop-1', 'a new required skill'), supplied: side('GC 1020', 'a new supplied skill') });
    expect(res.status).toBe(200);
    expect(state.inserted[0]).toMatchObject({ source: 'cluster', planId: CLUSTER, draft: true });
  });

  it('decide: 400 with both planId and clusterId, 400 with neither, 404 for an unknown cluster', async () => {
    const base = { action: 'decide', label: 'fully', required: side('GC 1', 'x'), supplied: side('GC 2', 'y') };
    expect((await post({ ...base, planId: PLAN, clusterId: CLUSTER })).status).toBe(400);
    expect((await post(base)).status).toBe(400);
    expect((await post({ ...base, clusterId: CLUSTER })).status).toBe(404);
    expect(state.inserted).toHaveLength(0);
  });

  it('judge: 400 with both planId and clusterId; a cluster supplies proposed titles', async () => {
    const others = [{ ref: 'o0', text: 'other skill 0', course: 'prop-1', title: 'FORGED' }];
    const anchor = { text: 'lay out a page', course: 'GC 3460', title: 'Print', side: 'required' as const };
    expect((await post({ action: 'judge', planId: PLAN, clusterId: CLUSTER, anchor, others })).status).toBe(400);
    state.clusters.set(CLUSTER, { state: { proposed: [{ id: 'prop-1', code: 'GC 4990', title: 'Proposed Lab' }] } });
    state.vectors = new Map([[h(anchor.text), [1, 0]], [h('other skill 0'), [1, 0]]]);
    state.selects = [[{ code: 'GC 3460', title: 'Print Real' }]];
    let seen: { suppliedTitle: string } | undefined;
    state.judgeImpl = async (pairs) => { seen = pairs[0] as typeof seen; return pairs.map(() => ({ pFully: 0.1, pPartly: 0.2 })); };
    expect((await post({ action: 'judge', clusterId: CLUSTER, anchor, others })).status).toBe(200);
    expect(seen?.suppliedTitle).toBe('Proposed Lab');
  });
});

describe('POST /api/build/match judge-set', () => {
  const CLUSTER = '8b1f0c2e-0000-4000-8000-0000000000c1';
  const target = { key: 'cobj:1', text: 'produce a packaged print job', course: 'GC 4400', title: 'Studio' };
  const pool = [
    { ref: 'p1', text: 'compose a booklet', course: 'GC 1020', title: 'Intro' },
    { ref: 'p2', text: 'prepare press files', course: 'GC 2070', title: 'Prepress' },
  ];
  beforeEach(() => { state.clusters.set(CLUSTER, { state: { proposed: [] } }); });

  it('returns the cached verdict without calling the model, with the client refs', async () => {
    const poolHash = textHash([h(pool[0]!.text), h(pool[1]!.text)].sort().join(','));
    state.setCache.set(`${h(target.text)}|${poolHash}`, { pAny: 0.9, picked: [h(pool[1]!.text)], kept: [h(pool[1]!.text)], pTogether: 0.66, pCombining: 0.2 });
    state.selects = [[], []];
    const res = await post({ action: 'judge-set', clusterId: CLUSTER, target, pool });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ verdict: { pAny: 0.9, kept: ['p2'], pTogether: 0.66, pCombining: 0.2 } });
    expect(state.setAsked).toBe(0);
  });

  it('judges on a miss, stores hashes, and returns the client refs', async () => {
    state.selects = [[{ code: 'GC 4400', title: 'Studio Real' }], [{ code: 'GC 4400', description: 'x'.repeat(500) }]];
    let seen: { ctx: string; pool: Array<{ ref: string }> } | undefined;
    state.setImpl = async (t, p) => { seen = { ctx: (t as { context: string }).context, pool: p }; return { pAny: 0.8, picked: [p[0]!.ref], kept: [p[0]!.ref], pTogether: 0.7, pCombining: 0.4 }; };
    const res = await post({ action: 'judge-set', clusterId: CLUSTER, target, pool });
    expect(res.status).toBe(200);
    expect((await res.json()).verdict).toEqual({ pAny: 0.8, kept: ['p1'], pTogether: 0.7, pCombining: 0.4 });
    expect(seen!.ctx).toBe(`GC 4400 Studio Real (catalog: ${'x'.repeat(350)})`);
    expect(state.setWrites).toHaveLength(1);
    expect(state.setWrites[0]).toMatchObject({ targetHash: h(target.text), kept: [h(pool[0]!.text)] });
  });

  it('uses the newest non-empty catalog description, and passes titles', async () => {
    const run = async (rows: Array<{ code: string; description: string; year: string }>) => {
      state.setAsked = 0; state.setCache.clear();
      state.selects = [[{ code: 'GC 4400', title: 'Studio Real' }], rows];
      let seen: { ctx: string; title?: string; pt?: string } | undefined;
      state.setImpl = async (t, p) => { seen = { ctx: (t as { context: string }).context, title: (t as { title?: string }).title, pt: (p[0] as { title?: string }).title }; return { pAny: 0.1, picked: [], kept: [], pTogether: null, pCombining: null }; };
      await post({ action: 'judge-set', clusterId: CLUSTER, target, pool });
      return seen!;
    };
    const a = await run([{ code: 'GC 4400', description: 'newer', year: '2026-27' }, { code: 'GC 4400', description: 'older', year: '2024-25' }]);
    expect(a.ctx).toBe('GC 4400 Studio Real (catalog: newer)');
    expect(a.title).toBe('Studio Real'); expect(a.pt).toBe('Intro');
    const b = await run([{ code: 'GC 4400', description: '', year: '2026-27' }, { code: 'GC 4400', description: 'older', year: '2024-25' }]);
    expect(b.ctx).toBe('GC 4400 Studio Real (catalog: older)');
  });

  it('takes the top 8 by embedding when more are sent', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ref: `q${i}`, text: `skill ${i}`, course: 'GC 1020', title: 'Intro' }));
    state.vectors = new Map([[h(target.text), [1, 0]]]);
    many.forEach((o, i) => state.vectors.set(h(o.text), [1 - i * 0.05, i * 0.05]));
    let n = 0; state.setImpl = async (_t, p) => { n = p.length; return { pAny: 0.1, picked: [], kept: [], pTogether: null, pCombining: null }; };
    expect((await post({ action: 'judge-set', clusterId: CLUSTER, target, pool: many })).status).toBe(200);
    expect(n).toBe(8);
  });

  it('502 and nothing stored when the model fails', async () => {
    state.setImpl = async () => { throw new Error('HTTP 503 from http://campus.example/v1'); };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await post({ action: 'judge-set', clusterId: CLUSTER, target, pool });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('The campus model did not answer; try again.');
    expect(state.setWrites).toHaveLength(0);
    warn.mockRestore();
  });

  it('400 for a bad cluster id or empty pool; 404 for an unknown cluster', async () => {
    expect((await post({ action: 'judge-set', clusterId: 'nope', target, pool })).status).toBe(400);
    expect((await post({ action: 'judge-set', clusterId: CLUSTER, target, pool: [] })).status).toBe(400);
    expect((await post({ action: 'judge-set', clusterId: '8b1f0c2e-0000-4000-8000-0000000000c9', target, pool })).status).toBe(404);
  });
});
