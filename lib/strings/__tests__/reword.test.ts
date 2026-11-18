import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PointRow } from '@/lib/builder/strings/types';

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  inserted: [] as Array<Record<string, unknown>>,
  vectors: new Map<string, number[]>(),
  judged: 0,
  judgeImpl: null as null | ((pairs: unknown[]) => Promise<Array<{ pFully: number | null; pPartly: number | null }>>),
  embedFails: false,
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => state.rows }) }),
    insert: () => ({ values: (v: Record<string, unknown>) => ({ onConflictDoNothing: async () => { state.inserted.push(v); } }) }),
  },
}));
vi.mock('@/lib/db/bundle-queries', () => ({
  embedMissing: async () => { if (state.embedFails) throw new Error('campus down'); return { cached: 0, embedded: 0 }; },
  readVectors: async () => state.vectors,
}));
vi.mock('@/lib/ai/embeddings', () => ({
  DEFAULT_EMBEDDING_MODEL: 'emb', embedBatch: async () => [],
  cosineSimilarity: (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0),
}));
vi.mock('@/lib/ai/match-judge', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai/match-judge')>()),
  judgePairs: async (pairs: unknown[]) => { state.judged++; return state.judgeImpl!(pairs); },
}));

import { checkRewords } from '../reword';
import { MODEL_IN_USE, PROMPT_VERSION, CUTOFFS } from '@/lib/ai/match-judge';

const FULLY = CUTOFFS[MODEL_IN_USE].fully;
const point: PointRow = { id: 'p1', courseCode: 'GC 1010', role: 'develops', statement: 'Old wording', statementHash: 'hp', snapshotId: null, k: null, u: null, d: null, term: null };
const item = { point, snapshotId: 's1', pool: [{ statement: 'A', hash: 'ha' }, { statement: 'B', hash: 'hb' }] };

beforeEach(() => {
  state.rows = []; state.inserted = []; state.judged = 0; state.embedFails = false;
  state.vectors = new Map([['hp', [1, 0]], ['ha', [0.9, 0.1]], ['hb', [0.5, 0.5]]]);
  state.judgeImpl = async (pairs) => pairs.map(() => ({ pFully: 0.1, pPartly: 0.5 }));
});

describe('checkRewords', () => {
  it('cache hit makes no campus call', async () => {
    state.rows = [{ pointId: 'p1', snapshotId: 's1', model: MODEL_IN_USE, promptVersion: PROMPT_VERSION, status: 'changed', candidateStatement: 'A', candidateHash: 'ha', pPartly: 0.5 }];
    const r = await checkRewords([item]);
    expect(r.p1).toEqual({ kind: 'changed', now: null, candidate: { statement: 'A', hash: 'ha' } });
    expect(state.judged).toBe(0);
    expect(state.inserted).toEqual([]);
  });
  it('picks the highest pFully at or above the fully cutoff and caches it', async () => {
    state.judgeImpl = async () => [{ pFully: FULLY + 0.1, pPartly: 0.9 }, { pFully: FULLY + 0.2, pPartly: 0.8 }];
    const r = await checkRewords([item]);
    expect(r.p1).toEqual({ kind: 'changed', now: null, candidate: { statement: 'B', hash: 'hb' } });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({ status: 'changed', candidateHash: 'hb', pPartly: 0.8 });
  });
  it('a partly-only pair is not a reword: unanchored and cached', async () => {
    state.judgeImpl = async (pairs) => pairs.map(() => ({ pFully: FULLY - 0.01, pPartly: 0.99 }));
    const r = await checkRewords([item]);
    expect(r.p1).toEqual({ kind: 'unanchored', why: 'skill gone' });
    expect(state.inserted[0]).toMatchObject({ status: 'unanchored', candidateHash: null });
  });
  it('judge error gives unchecked and writes nothing', async () => {
    state.judgeImpl = async () => { throw new Error('boom'); };
    const r = await checkRewords([item]);
    expect(r.p1).toEqual({ kind: 'unchecked' });
    expect(state.inserted).toEqual([]);
  });
  it('embedding error gives unchecked and writes nothing', async () => {
    state.embedFails = true;
    const r = await checkRewords([item]);
    expect(r.p1).toEqual({ kind: 'unchecked' });
    expect(state.inserted).toEqual([]);
  });
});
