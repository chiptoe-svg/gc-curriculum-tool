import type { Depth } from '@/lib/builder/types';
import type { HandDepth, NodeReading, Tree, TreeLeaf, TreeNode, VersionSkills } from './types';

/** Confirmed, or proposed with a source other than a bare embedding match. */
export const counts = (l: TreeLeaf): boolean =>
  l.status === 'confirmed' || (l.status === 'proposed' && l.source !== 'embedding');

/** One id -> node map per Tree object (trees are replaced, never edited in place), so per-leaf loops do not rebuild it. */
const nodeMaps = new WeakMap<Tree, Map<string, TreeNode>>();
function nodeMap(tree: Tree): Map<string, TreeNode> {
  let m = nodeMaps.get(tree);
  if (!m) { m = new Map(tree.nodes.map((n) => [n.id, n])); nodeMaps.set(tree, m); }
  return m;
}

/** Follows merged_into to the survivor (guarded against cycles). */
export function resolveNode(tree: Tree, id: string): string {
  const byId = nodeMap(tree);
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

/** FNV-1a 32-bit as hex: pure JS so this file can run in the browser (no node:crypto). */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Sorted counting skillRefs of this course under the node's subtree, hashed. */
export function leavesSignature(tree: Tree, nodeId: string, courseCode: string): string {
  const ids = subtreeIds(tree, nodeId);
  const refs = new Set<string>();
  for (const l of tree.leaves) {
    if (l.courseCode === courseCode && counts(l) && ids.has(resolveNode(tree, l.nodeId))) refs.add(l.skillRef);
  }
  return fnv1a([...refs].sort().join('\n'));
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

/** True when the node (after following a merge) or any ancestor is foundational: such nodes read D only. */
export function isFoundational(tree: Tree, nodeId: string): boolean {
  const id = resolveNode(tree, nodeId);
  return !!nodeMap(tree).get(id)?.foundational || ancestorFoundational(tree, id);
}

function ancestorFoundational(tree: Tree, nodeId: string): boolean {
  const byId = nodeMap(tree);
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

/** Weighted average over the given master nodes' program readings. K and U average over the non-foundational masters only (null on every master stays null); D averages over all. */
export function readCareer(tree: Tree, versions: VersionSkills[], weights: Array<{ nodeId: string; weight: number }>): Depth {
  const rs = weights.map((w) => ({ w: w.weight, v: readProgram(tree, versions, w.nodeId) as Depth }));
  return weightedMean(rs);
}

/** True when every non-null need is met; foundational nodes ignore K and U. */
export function meets(reading: Depth, need: Depth, foundational: boolean): boolean {
  const ok = (key: 'k' | 'u' | 'd') => need[key] === null || (reading[key] ?? 0) >= need[key]!;
  return ok('d') && (foundational || (ok('k') && ok('u')));
}

const SOURCE_RANK: Record<string, number> = { employer: 0, faculty: 1, onet: 2, ai: 3 };

/** One weight per competency from career_target_requirements rows: employer, then faculty, then onet, then ai; a null weight counts as 1. */
export function careerWeights(
  rows: Array<{ competencyId: string; weight: number | null; weightSource: string }>,
): Array<{ nodeId: string; weight: number }> {
  const best = new Map<string, { rank: number; weight: number }>();
  for (const r of rows) {
    const rank = SOURCE_RANK[r.weightSource] ?? 99;
    const cur = best.get(r.competencyId);
    if (!cur || rank < cur.rank) best.set(r.competencyId, { rank, weight: r.weight ?? 1 });
  }
  return [...best].map(([nodeId, b]) => ({ nodeId, weight: b.weight }));
}
