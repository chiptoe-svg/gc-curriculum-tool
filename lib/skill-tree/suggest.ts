import { db } from '@/lib/db/client';
import { embedMissing, readVectors } from '@/lib/db/bundle-queries';
import { embedBatch, DEFAULT_EMBEDDING_MODEL } from '@/lib/ai/embeddings';
import { hashOf } from '@/lib/strings/hash';
import { cosine } from '@/lib/builder/candidates';
import { counts } from './read';
import type { Tree, TreeNode } from './types';

export interface ParentSuggestion { nodeId: string; similarity: number }

const NEW_WORDING_CUTOFF = 0.8;

const isLive = (n: TreeNode): boolean => !n.retired && !n.mergedInto;
const nodeText = (n: TreeNode): string => (n.description ? `${n.name} — ${n.description}` : n.name);

/** Top `top` live nodes (masters included) for a skill: max cosine of the skill against the node's text and its counting leaves. */
export function rankParents(
  skillVec: number[], tree: Tree, nodeVecs: Map<string, number[]>, leafVecs: Map<string, number[]>, top: number,
): ParentSuggestion[] {
  const leavesByNode = new Map<string, string[]>();
  for (const l of tree.leaves) {
    if (!counts(l)) continue;
    const arr = leavesByNode.get(l.nodeId) ?? [];
    arr.push(l.skillRef);
    leavesByNode.set(l.nodeId, arr);
  }
  const out: ParentSuggestion[] = [];
  for (const n of tree.nodes) {
    if (!isLive(n)) continue;
    const vecs = [nodeVecs.get(n.id), ...(leavesByNode.get(n.id) ?? []).map((r) => leafVecs.get(r))];
    let best = -Infinity;
    for (const v of vecs) if (v) best = Math.max(best, cosine(skillVec, v));
    if (best > -Infinity) out.push({ nodeId: n.id, similarity: best });
  }
  return out.sort((a, b) => b.similarity - a.similarity).slice(0, top);
}

/** For a leaf gone from the capture, the closest unplaced skill of the same course version, if cosine >= 0.80. */
export function closestNewWording(
  oldVec: number[], pool: Array<{ skillRef: string; statement: string; vec: number[] }>,
): { skillRef: string; statement: string; similarity: number } | null {
  let best: { skillRef: string; statement: string; similarity: number } | null = null;
  for (const p of pool) {
    const similarity = cosine(oldVec, p.vec);
    if (!best || similarity > best.similarity) best = { skillRef: p.skillRef, statement: p.statement, similarity };
  }
  return best && best.similarity >= NEW_WORDING_CUTOFF ? best : null;
}

/** Embeds what is missing (campus, free) and returns suggestions per skillRef; any embedding error returns {}. */
export async function suggestParents(
  tree: Tree, skills: Array<{ skillRef: string; statement: string }>, top = 3,
): Promise<Record<string, ParentSuggestion[]>> {
  try {
    const live = tree.nodes.filter(isLive);
    const nodeRef = new Map(live.map((n) => [n.id, hashOf(nodeText(n))]));
    const all = new Map<string, { kind: 'course_skill'; ref: string; text: string }>();
    for (const n of live) all.set(nodeRef.get(n.id)!, { kind: 'course_skill', ref: nodeRef.get(n.id)!, text: nodeText(n) });
    for (const l of tree.leaves) if (counts(l)) all.set(l.skillRef, { kind: 'course_skill', ref: l.skillRef, text: l.statement });
    for (const s of skills) all.set(s.skillRef, { kind: 'course_skill', ref: s.skillRef, text: s.statement });
    const wanted = [...all.values()];
    await embedMissing(db, wanted, DEFAULT_EMBEDDING_MODEL, (t) => embedBatch(t));
    const vecs = await readVectors(db, 'course_skill', wanted, DEFAULT_EMBEDDING_MODEL);
    const nodeVecs = new Map<string, number[]>();
    for (const n of live) { const v = vecs.get(nodeRef.get(n.id)!); if (v) nodeVecs.set(n.id, v); }
    const out: Record<string, ParentSuggestion[]> = {};
    for (const s of skills) {
      const v = vecs.get(s.skillRef);
      if (v) out[s.skillRef] = rankParents(v, tree, nodeVecs, vecs, top);
    }
    return out;
  } catch {
    return {};
  }
}
