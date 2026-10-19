import { cosineSimilarity } from '@/lib/ai/embeddings';
import type { GoldenCandidate } from '@/lib/db/schema';

/**
 * The blind panel's shortened list (owner decision 2026-10-19, docs/STATE.md
 * "P2 blind-check instrument narrowed after the first bundle"): the 20 O*NET
 * elements nearest the bundle's card, and the AI's own top-25 task groups with
 * near-duplicates folded together. Pure; the DB reads live in
 * lib/db/bundle-queries.ts. Nothing here touches AI placements.
 */

export const BLIND_ELEMENT_K = 20;
/** Same value as TASK_SHORTLIST_K: the blind list is the AI's own shortlist. */
export const BLIND_TASK_K = 25;
export const NEAR_DUPLICATE_COSINE = 0.92;

/** Element ids by descending cosine to the card; exact ties by id ascending. */
export function rankElements(cardVector: number[], elementVectors: Map<string, number[]>, k: number = BLIND_ELEMENT_K): string[] {
  return [...elementVectors.entries()]
    .map(([id, v]) => ({ id, score: cosineSimilarity(cardVector, v) }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, k)
    .map(s => s.id);
}

export interface SimilarTask { key: string; label: string; members: GoldenCandidate['members'] }
export interface BlindTaskRow { key: string; label: string; rank: number; members: GoldenCandidate['members']; similar: SimilarTask[] }

/**
 * Takes the first `keep` candidates (stored top-50 order == the AI's shortlist
 * order, enforced by map-bundles-onet's Ruling-4 check), then folds each task
 * whose cosine to an already-kept row's first task is >= `threshold` into that
 * row. Only kept rows anchor a merge. A task without a vector stays its own row.
 */
export function mergeNearDuplicates(
  candidates: GoldenCandidate[], vectors: Map<string, number[]>, keep: number = BLIND_TASK_K, threshold: number = NEAR_DUPLICATE_COSINE,
): BlindTaskRow[] {
  const rows: BlindTaskRow[] = [];
  for (const c of candidates.slice(0, keep)) {
    const v = vectors.get(c.key);
    const host = v === undefined ? undefined : rows.find(r => {
      const rv = vectors.get(r.key);
      return rv !== undefined && cosineSimilarity(rv, v) >= threshold;
    });
    if (host) host.similar.push({ key: c.key, label: c.label, members: c.members });
    else rows.push({ key: c.key, label: c.label, rank: c.rank, members: c.members, similar: [] });
  }
  return rows;
}

/** Every task-group key a pick on this row stands for: the first task's, then each merged task's. */
export function rowGroupKeys(row: BlindTaskRow): string[] {
  return [row.key, ...row.similar.map(s => s.key)];
}

/** The text embedded for an O*NET element (kind 'onet_element', ref = element_id): "name: description". Shared by embed-items and the blind list's hash lookup. */
export function elementEmbedText(def: { elementName: string; description: string }): string {
  return `${def.elementName}: ${def.description}`;
}
