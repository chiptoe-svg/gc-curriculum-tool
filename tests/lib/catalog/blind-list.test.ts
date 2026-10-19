import { describe, it, expect } from 'vitest';
import {
  rankElements, mergeNearDuplicates, rowGroupKeys, BLIND_ELEMENT_K, BLIND_TASK_K, NEAR_DUPLICATE_COSINE,
} from '@/lib/catalog/blind-list';
import type { GoldenCandidate } from '@/lib/db/schema';

const cand = (key: string, rank: number): GoldenCandidate => ({
  key, label: `task ${key}`, rank, score: 1 - rank / 100, members: [{ taskId: `t-${key}`, onetSocCode: `11-${rank}` }],
});

describe('constants', () => {
  it('are the decided values', () => {
    expect([BLIND_ELEMENT_K, BLIND_TASK_K, NEAR_DUPLICATE_COSINE]).toEqual([20, 25, 0.92]);
  });
});

describe('rankElements', () => {
  it('returns the k element ids most similar to the card, best first', () => {
    const card = [1, 0];
    const vecs = new Map<string, number[]>([
      ['far', [0, 1]], ['near', [1, 0.1]], ['mid', [1, 1]], ['opposite', [-1, 0]],
    ]);
    expect(rankElements(card, vecs, 2)).toEqual(['near', 'mid']);
  });
  it('breaks exact ties by id ascending', () => {
    const vecs = new Map<string, number[]>([['b', [1, 0]], ['a', [1, 0]], ['c', [0, 1]]]);
    expect(rankElements([1, 0], vecs, 2)).toEqual(['a', 'b']);
  });
  it('takes the top 20 of 30 by default', () => {
    const vecs = new Map<string, number[]>();
    for (let i = 0; i < 30; i++) vecs.set(`e${String(i).padStart(2, '0')}`, [1, i / 10]);
    const out = rankElements([1, 0], vecs);
    expect(out).toHaveLength(20);
    expect(out[0]).toBe('e00');
    expect(out[19]).toBe('e19');
  });
});

describe('mergeNearDuplicates', () => {
  it('keeps the first 25 candidates only', () => {
    const cands = Array.from({ length: 50 }, (_, i) => cand(`k${i}`, i + 1));
    // orthogonal-ish vectors: no merges
    const vecs = new Map(cands.map((c, i) => [c.key, Array.from({ length: 50 }, (_, j) => (i === j ? 1 : 0))]));
    const rows = mergeNearDuplicates(cands, vecs);
    expect(rows).toHaveLength(25);
    expect(rows.map(r => r.key)).toEqual(cands.slice(0, 25).map(c => c.key));
    expect(rows.every(r => r.similar.length === 0)).toBe(true);
  });
  it('folds a task with cosine >= 0.92 to a kept task into that row, in order', () => {
    const cands = [cand('a', 1), cand('b', 2), cand('c', 3), cand('d', 4)];
    const vecs = new Map<string, number[]>([
      ['a', [1, 0]], ['b', [0, 1]],
      ['c', [1, 0.05]],            // cos with a ~ 0.9988 -> joins a
      ['d', [0.9, 0.9]],           // cos with a = cos with b ~ 0.707 -> own row
    ]);
    const rows = mergeNearDuplicates(cands, vecs);
    expect(rows.map(r => r.key)).toEqual(['a', 'b', 'd']);
    expect(rows[0]!.label).toBe('task a');
    expect(rows[0]!.similar.map(s => s.key)).toEqual(['c']);
  });
  it('threshold is inclusive at 0.92 and exclusive below', () => {
    const cands = [cand('a', 1), cand('b', 2), cand('c', 3)];
    // cos(a,b) = 0.92 exactly: [1,0] vs [0.92, sqrt(1-0.92^2)]
    const s = Math.sqrt(1 - 0.92 * 0.92);
    const below = Math.sqrt(1 - 0.919 * 0.919);
    const vecs = new Map<string, number[]>([['a', [1, 0]], ['b', [0.92, s]], ['c', [0.919, below]]]);
    const rows = mergeNearDuplicates(cands, vecs);
    expect(rows.map(r => r.key)).toEqual(['a', 'c']);
    expect(rows[0]!.similar.map(x => x.key)).toEqual(['b']);
  });
  it('compares only against kept rows (a merged task never anchors a row)', () => {
    const cands = [cand('a', 1), cand('b', 2), cand('c', 3)];
    // b~a (merged); c~b but c far from a: c must not merge via b.
    const vecs = new Map<string, number[]>([['a', [1, 0]], ['b', [1, 0.3]], ['c', [1, 0.7]]]);
    const rows = mergeNearDuplicates(cands, vecs, 25, 0.95);
    expect(rows.map(r => r.key)).toEqual(['a', 'c']);
  });
  it('a candidate with no vector stays its own row', () => {
    const cands = [cand('a', 1), cand('b', 2)];
    const rows = mergeNearDuplicates(cands, new Map([['a', [1, 0]]]));
    expect(rows.map(r => r.key)).toEqual(['a', 'b']);
  });
});

describe('rowGroupKeys (a pick on a merged row fans out)', () => {
  it('is the primary key then every merged key', () => {
    const cands = [cand('a', 1), cand('c', 2), cand('e', 3)];
    const vecs = new Map<string, number[]>([['a', [1, 0]], ['c', [1, 0.01]], ['e', [1, 0.02]]]);
    const [row] = mergeNearDuplicates(cands, vecs);
    expect(rowGroupKeys(row!)).toEqual(['a', 'c', 'e']);
  });
});
