import type { Depth } from '@/lib/builder/types';
import { textHash } from '@/lib/catalog/bundles';
import type { HandDepth, NodeReading, Tree, TreeLeaf, TreeNode, VersionSkills } from './types';

/** Confirmed, or proposed with a source other than a bare embedding match. */
export const counts = (l: TreeLeaf): boolean =>
  l.status === 'confirmed' || (l.status === 'proposed' && l.source !== 'embedding');

/** Follows merged_into to the survivor (guarded against cycles). */
export function resolveNode(tree: Tree, id: string): string {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  let cur = id;
  while (!seen.has(cur)) {
    seen.add(cur);
    const next = byId.get(cur)?.mergedInto;
    if (!next) break;
    cur = next;
  }
  return cur;
}

const liveChildren = (tree: Tree, id: string): TreeNode[] =>
  tree.nodes
    .filter((n) => n.parentId === id && !n.retired && !n.mergedInto)
    .sort((a, b) => a.name.localeCompare(b.name));

function subtreeIds(tree: Tree, id: string): Set<string> {
  const out = new Set<string>([id]);
  const stack = [id];
  while (stack.length) {
    for (const c of liveChildren(tree, stack.pop()!)) {
      if (!out.has(c.id)) { out.add(c.id); stack.push(c.id); }
    }
  }
  return out;
}

/** Sorted counting skillRefs of this course under the node's subtree, hashed. */
export function leavesSignature(tree: Tree, nodeId: string, courseCode: string): string {
  const ids = subtreeIds(tree, nodeId);
  const refs = new Set<string>();
  for (const l of tree.leaves) {
    if (l.courseCode === courseCode && counts(l) && ids.has(resolveNode(tree, l.nodeId))) refs.add(l.skillRef);
  }
  return textHash([...refs].sort().join('\n'));
}

type DirectItem = NodeReading['direct'][number];
interface Placed { value: Depth; direct: DirectItem[] }

/** Computes a node reading; `placed` supplies the "Skills placed here" value, `handFor` any hand-set row. */
function build(
  tree: Tree,
  nodeId: string,
  placed: (nodeId: string) => Placed,
  handFor: ((nodeId: string) => HandDepth | undefined) | null,
  review: ((nodeId: string, row: HandDepth) => boolean) | null,
  ancestorFoundational: boolean,
): NodeReading {
  const n = tree.nodes.find((x) => x.id === nodeId);
  const foundational = ancestorFoundational || !!n?.foundational;
  const kids = liveChildren(tree, nodeId);
  const childReadings = kids.map((c) => build(tree, c.id, placed, handFor, review, foundational));

  const hasDirect = tree.leaves.some((l) => counts(l) && resolveNode(tree, l.nodeId) === nodeId);
  const kidWeightMean = kids.length ? kids.reduce((s, c) => s + c.weight, 0) / kids.length : 1;
  const directWeight = hasDirect ? kidWeightMean : null;
  const here = hasDirect ? placed(nodeId) : { value: { k: null, u: null, d: null } as Depth, direct: [] as DirectItem[] };

  const parts: Array<{ w: number; v: Depth }> = kids.map((c, i) => ({ w: c.weight, v: childReadings[i]! }));
  if (directWeight !== null) parts.push({ w: directWeight, v: here.value });
  const total = parts.reduce((s, p) => s + p.w, 0);
  const dim = (key: 'k' | 'u' | 'd'): number =>
    total > 0 ? parts.reduce((s, p) => s + p.w * (p.v[key] ?? 0), 0) / total : 0;
  const computed: Depth = { k: foundational ? null : dim('k'), u: foundational ? null : dim('u'), d: dim('d') };

  const row = handFor?.(nodeId);
  const value: Depth = row
    ? { k: foundational ? null : row.k, u: foundational ? null : row.u, d: row.d }
    : computed;
  return {
    ...value,
    nodeId,
    byHand: !!row,
    computed,
    needsReview: row && review ? review(nodeId, row) : false,
    children: childReadings,
    direct: here.direct,
    directWeight,
  };
}

/** Weight of each counting leaf row: its share, or 1 / (counting parents of that skill in that course). */
function leafWeights(tree: Tree): (l: TreeLeaf) => number {
  const parents = new Map<string, number>();
  const key = (l: TreeLeaf) => `${l.courseCode}\u0000${l.skillRef}`;
  for (const l of tree.leaves) if (counts(l)) parents.set(key(l), (parents.get(key(l)) ?? 0) + 1);
  return (l) => l.share ?? 1 / (parents.get(key(l)) ?? 1);
}

function weightedMean(items: Array<{ w: number; v: Depth }>): Depth {
  const dim = (key: 'k' | 'u' | 'd'): number | null => {
    const have = items.filter((i) => i.v[key] !== null);
    if (!have.length) return null;
    const tw = have.reduce((s, i) => s + i.w, 0);
    return tw > 0 ? have.reduce((s, i) => s + i.w * (i.v[key] as number), 0) / tw : 0;
  };
  return { k: dim('k'), u: dim('u'), d: dim('d') };
}

function placedForVersions(tree: Tree, versions: VersionSkills[]): (nodeId: string) => Placed {
  const weightOf = leafWeights(tree);
  return (nodeId) => {
    const perVersion: Depth[] = [];
    const direct: DirectItem[] = [];
    for (const v of versions) {
      const items: Array<{ w: number; v: Depth }> = [];
      for (const l of tree.leaves) {
        if (!counts(l) || l.courseCode !== v.courseCode || resolveNode(tree, l.nodeId) !== nodeId) continue;
        const depth = v.skills.get(l.skillRef);
        if (!depth) continue;
        const weight = weightOf(l);
        items.push({ w: weight, v: depth });
        direct.push({ skillRef: l.skillRef, statement: l.statement, courseCode: l.courseCode, depth, weight });
      }
      if (items.length) perVersion.push(weightedMean(items));
    }
    if (!perVersion.length) return { value: { k: 0, u: 0, d: 0 }, direct };
    if (versions.length === 1) return { value: perVersion[0]!, direct };
    // Program: the stronger version counts, per dimension.
    const max = (key: 'k' | 'u' | 'd'): number | null => {
      const vals = perVersion.map((p) => p[key]).filter((x): x is number => x !== null);
      return vals.length ? Math.max(...vals) : null;
    };
    return { value: { k: max('k'), u: max('u'), d: max('d') }, direct };
  };
}

export function readCourse(tree: Tree, v: VersionSkills, nodeId: string): NodeReading {
  const handFor = (id: string) =>
    tree.depths.find((h) => resolveNode(tree, h.nodeId) === id && h.courseCode === v.courseCode && h.instructor === v.instructor);
  const review = (id: string, row: HandDepth) => leavesSignature(tree, id, v.courseCode) !== row.leavesSignature;
  return build(tree, resolveNode(tree, nodeId), placedForVersions(tree, [v]), handFor, review, ancestorFoundational(tree, nodeId));
}

export function readProgram(tree: Tree, versions: VersionSkills[], nodeId: string): NodeReading {
  return build(tree, resolveNode(tree, nodeId), placedForVersions(tree, versions), null, null, ancestorFoundational(tree, nodeId));
}

function ancestorFoundational(tree: Tree, nodeId: string): boolean {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  let cur = byId.get(resolveNode(tree, nodeId))?.parentId ?? null;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const n = byId.get(cur);
    if (!n) break;
    if (n.foundational) return true;
    cur = n.parentId;
  }
  return false;
}

/** Weighted average over the given master nodes' program readings; null counts as 0 unless null on every master. */
export function readCareer(tree: Tree, versions: VersionSkills[], weights: Array<{ nodeId: string; weight: number }>): Depth {
  const rs = weights.map((w) => ({ w: w.weight, v: readProgram(tree, versions, w.nodeId) as Depth }));
  const total = rs.reduce((s, r) => s + r.w, 0);
  const dim = (key: 'k' | 'u' | 'd'): number | null => {
    if (rs.every((r) => r.v[key] === null)) return null;
    return total > 0 ? rs.reduce((s, r) => s + r.w * (r.v[key] ?? 0), 0) / total : 0;
  };
  return { k: dim('k'), u: dim('u'), d: dim('d') };
}

/** True when every non-null need is met; foundational nodes ignore K and U. */
export function meets(reading: Depth, need: Depth, foundational: boolean): boolean {
  const ok = (key: 'k' | 'u' | 'd') => need[key] === null || (reading[key] ?? 0) >= need[key]!;
  return ok('d') && (foundational || (ok('k') && ok('u')));
}
