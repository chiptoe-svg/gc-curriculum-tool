import { describe, it, expect, vi } from 'vitest';
import { rerankTopK, RERANK_CANDIDATES, candidateLimit } from '../rerank-hits';

const items = [
  { id: 'a', text: 'alpha', score: 0.9 },
  { id: 'b', text: 'beta', score: 0.8 },
  { id: 'c', text: 'gamma', score: 0.7 },
];

describe('candidateLimit', () => {
  it('fetches 50 candidates when reranking, else exactly k', () => {
    expect(RERANK_CANDIDATES).toBe(50);
    expect(candidateLimit(5, true)).toBe(50);
    expect(candidateLimit(80, true)).toBe(80);
    expect(candidateLimit(5, false)).toBe(5);
  });
});

describe('rerankTopK', () => {
  it('reorders by reranker score and cuts to k, reranking the passage text', async () => {
    const fn = vi.fn(async () => [{ index: 2, score: 0.99 }, { index: 0, score: 0.5 }, { index: 1, score: 0.1 }]);
    const out = await rerankTopK('q', items, 2, fn);
    expect(out.map(h => h.id)).toEqual(['c', 'a']);
    expect(out.map(h => h.rerankScore)).toEqual([0.99, 0.5]);
    expect(fn).toHaveBeenCalledWith('q', ['alpha', 'beta', 'gamma']);
  });

  it('breaks reranker ties by the original search score', async () => {
    const fn = vi.fn(async () => [{ index: 1, score: 0.5 }, { index: 0, score: 0.5 }, { index: 2, score: 0.1 }]);
    const out = await rerankTopK('q', items, 3, fn);
    expect(out.map(h => h.id)).toEqual(['a', 'b', 'c']);
  });

  it('falls back to the search order (cut to k, no rerank score) when the reranker fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fn = vi.fn(async () => { throw new Error('503'); });
    const out = await rerankTopK('q', items, 2, fn);
    expect(out.map(h => h.id)).toEqual(['a', 'b']);
    expect(out.every(h => h.rerankScore === null)).toBe(true);
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0])).not.toContain('alpha');
    warn.mockRestore();
  });

  it('skips the reranker for zero or one candidate', async () => {
    const fn = vi.fn();
    expect(await rerankTopK('q', [], 5, fn)).toEqual([]);
    expect((await rerankTopK('q', [items[0]!], 5, fn)).map(h => h.id)).toEqual(['a']);
    expect(fn).not.toHaveBeenCalled();
  });
});
