/**
 * Rerank search candidates and cut to k (owner, 2026-11-19). Same shape as rag-core's search
 * (src/rag_core/index/search.py): fetch 50 candidates, rerank all of them on the passage text as shown
 * and quoted (not the embedding text with its context blurb), order by reranker score then by the
 * original search score, cut to the caller's k.
 *
 * Unlike rag-core today, a reranker failure falls back to the search order: the interview must keep
 * working through an RCD reranker outage (rag-core's 2026-11-19 proposal makes the same change there).
 */
import { rerank } from '@/lib/ai/rerank';

export const RERANK_CANDIDATES = 50;

export function candidateLimit(k: number, reranking: boolean): number {
  return reranking ? Math.max(k, RERANK_CANDIDATES) : k;
}

type RerankFn = (query: string, passages: string[]) => Promise<Array<{ index: number; score: number }>>;

export async function rerankTopK<T extends { text: string; score: number }>(
  query: string,
  candidates: T[],
  k: number,
  fn: RerankFn = (q, p) => rerank(q, p),
): Promise<Array<T & { rerankScore: number | null }>> {
  if (candidates.length <= 1) return candidates.slice(0, k).map(c => ({ ...c, rerankScore: null }));
  try {
    const ranked = await fn(query, candidates.map(c => c.text));
    return ranked
      .map(r => ({ ...candidates[r.index]!, rerankScore: r.score }))
      .sort((a, b) => (b.rerankScore - a.rerankScore) || (b.score - a.score))
      .slice(0, k);
  } catch (err) {
    // Never log the query or passages (they are course content).
    console.warn('[search] rerank failed; using hybrid order:', err instanceof Error ? err.message : 'unknown error');
    return candidates.slice(0, k).map(c => ({ ...c, rerankScore: null }));
  }
}
