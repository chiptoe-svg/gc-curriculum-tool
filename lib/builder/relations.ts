/**
 * Which competencies are related, for reinforcement (measurement-hypotheses
 * spec 2026-06-19 §2.3–2.4, §2.7d). Embeddings only PROPOSE the neighborhood
 * ("embeddings shortlist, don't adjudicate"): a neighbor is one of the few
 * nearest bundle cards in the same stratum, above a similarity floor. The
 * same-stratum rule is the spec's "never generalized across domain-distant
 * pairs". What a neighbor then does is fixed and small
 * shortlist only; it does not change any level.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { bundleCards, itemEmbeddings } from '@/lib/db/schema';
import { cosineSimilarity } from '@/lib/ai/embeddings';

/**
 * Similarity floor and list length. Read off the stored bundle-card vectors
 * (qwen3-embedding-4b) on 2026-11-14: same-stratum pairs have a median cosine
 * of 0.35 and a 90th percentile of 0.51, so 0.5 keeps roughly the nearest
 * tenth (29 pairs across the 46 cards).
 */
export const NEIGHBOR_MIN = 0.5;
export const NEIGHBOR_TOP = 3;

export interface Related { stratum: string | null; neighbors: string[] }

/** Pure: nearest same-stratum items above the floor, nearest first. */
export function nearestNeighbors(
  items: Array<{ id: string; stratum: string; vector: number[] }>,
  opts: { min?: number; top?: number } = {},
): Map<string, string[]> {
  const min = opts.min ?? NEIGHBOR_MIN;
  const top = opts.top ?? NEIGHBOR_TOP;
  const out = new Map<string, string[]>();
  for (const a of items) {
    const scored = items
      .filter(b => b.id !== a.id && b.stratum === a.stratum && b.vector.length === a.vector.length)
      .map(b => ({ id: b.id, sim: cosineSimilarity(a.vector, b.vector) }))
      .filter(x => x.sim >= min)
      .sort((x, y) => y.sim - x.sim || x.id.localeCompare(y.id));
    out.set(a.id, scored.slice(0, top).map(x => x.id));
  }
  return out;
}

let cache: { at: number; value: Map<string, Related> } | null = null;
const TTL_MS = 10 * 60 * 1000;

/** Stratum and neighbors per competency id. A competency with no card or no vector has no neighbors. */
export async function loadCompetencyRelations(): Promise<Map<string, Related>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const [cards, vectors] = await Promise.all([
    db.select({ id: bundleCards.competencyId, stratum: bundleCards.stratum }).from(bundleCards),
    db.select({ ref: itemEmbeddings.ref, vector: itemEmbeddings.vector, createdAt: itemEmbeddings.createdAt })
      .from(itemEmbeddings).where(eq(itemEmbeddings.kind, 'bundle_card')),
  ]);
  // A card re-embedded after an edit has more than one row: the newest wins.
  const newest = new Map<string, { vector: number[]; createdAt: Date }>();
  for (const v of vectors) {
    const prev = newest.get(v.ref);
    if (!prev || v.createdAt > prev.createdAt) newest.set(v.ref, { vector: v.vector, createdAt: v.createdAt });
  }
  const items = cards.filter(c => newest.has(c.id)).map(c => ({ id: c.id, stratum: c.stratum, vector: newest.get(c.id)!.vector }));
  const neighbors = nearestNeighbors(items);
  const value = new Map<string, Related>(cards.map(c => [c.id, { stratum: c.stratum, neighbors: neighbors.get(c.id) ?? [] }]));
  cache = { at: Date.now(), value };
  return value;
}
