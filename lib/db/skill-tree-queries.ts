/**
 * Department skill tree: load and logged writes (migration 0074). Every write is one transaction that changes its
 * rows, inserts one skill_tree_events row (before/after), and returns the reloaded tree. Readings stay pure in
 * lib/skill-tree/read.ts; this file only moves rows.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { isUndefinedTable } from '@/lib/db/pg-errors';
import {
  careerTargetRequirements, careerTargets, nodeDepths, skillLeaves, skillNodes, skillTreeEvents, stringPoints,
  type SkillTreeEventKind,
} from '@/lib/db/schema';
import { leavesSignature } from '@/lib/skill-tree/read';
import type { HandDepth, Tree, TreeLeaf, TreeNode } from '@/lib/skill-tree/types';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = typeof db | Tx;

export type TreeWrite =
  | { ok: true; tree: Tree }
  | { ok: false; status: 400 | 404 | 409; error: string };

const MASTER_REFUSAL = 'Competencies are edited in the catalog';
const LOOP = 'That would put a skill under itself.';

/** Thrown inside a transaction to abort it and return a refusal. */
class Refuse extends Error {
  constructor(readonly status: 400 | 404 | 409, readonly error: string) { super(error); }
}

// ---------------------------------------------------------------- reads

const EMPTY_TREE: Tree = { nodes: [], leaves: [], depths: [] };

/** The tree, or an empty one while migration 0074 is not applied on this database (the tree is then simply empty). */
export async function loadTree(exec: Exec = db): Promise<Tree> {
  try {
    return await loadTreeRows(exec);
  } catch (err) {
    if (isUndefinedTable(err)) return EMPTY_TREE;
    throw err;
  }
}

async function loadTreeRows(exec: Exec): Promise<Tree> {
  const nodes = await exec.select().from(skillNodes).orderBy(asc(skillNodes.name), asc(skillNodes.id));
  const leaves = await exec.select().from(skillLeaves).orderBy(asc(skillLeaves.courseCode), asc(skillLeaves.skillRef), asc(skillLeaves.nodeId));
  const depths = await exec.select().from(nodeDepths).orderBy(asc(nodeDepths.nodeId), asc(nodeDepths.courseCode), asc(nodeDepths.instructor));
  return {
    nodes: nodes.map((n): TreeNode => ({
      id: n.id, name: n.name, description: n.description, parentId: n.parentId, competencyId: n.competencyId,
      foundational: n.foundational, weight: n.weight, weightSource: n.weightSource, mergedInto: n.mergedInto, retired: n.retired,
    })),
    leaves: leaves.map((l): TreeLeaf => ({
      courseCode: l.courseCode, skillRef: l.skillRef, nodeId: l.nodeId, statement: l.statement, share: l.share, source: l.source, status: l.status,
    })),
    depths: depths.map((d): HandDepth => ({
      nodeId: d.nodeId, courseCode: d.courseCode, instructor: d.instructor, k: d.k, u: d.u, d: d.d, method: d.method,
      leavesSignature: d.leavesSignature, setBy: d.setBy,
    })),
  };
}

/** Career targets and their entry-horizon requirement rows (every weight source; read.ts careerWeights picks one per competency). */
export async function loadCareerRequirements(exec: Exec = db) {
  const targets = await exec.select({ id: careerTargets.id, name: careerTargets.name }).from(careerTargets).orderBy(asc(careerTargets.displayOrder));
  const rows = await exec.select({
    careerTargetId: careerTargetRequirements.careerTargetId, competencyId: careerTargetRequirements.competencyId,
    weight: careerTargetRequirements.weight, weightSource: careerTargetRequirements.weightSource,
  }).from(careerTargetRequirements).where(eq(careerTargetRequirements.horizon, 'entry'));
  return { targets, rows };
}

// ---------------------------------------------------------------- plumbing

interface Ctx { tx: Tx; tree: Tree }

/** Runs `fn` in one transaction (tree loaded first), then returns the reloaded tree from inside it. */
async function write(fn: (c: Ctx) => Promise<void>, extra?: () => object): Promise<TreeWrite> {
  try {
    return await db.transaction(async (tx) => {
      const tree = await loadTree(tx);
      await fn({ tx, tree });
      const after = await loadTree(tx);
      return { ok: true as const, tree: after, ...(extra ? extra() : {}) };
    });
  } catch (e) {
    if (e instanceof Refuse) return { ok: false, status: e.status, error: e.error };
    throw e;
  }
}

interface Ev { kind: SkillTreeEventKind; by: string; nodeId?: string; courseCode?: string; skillRef?: string; before?: unknown; after?: unknown }
async function event(tx: Tx, e: Ev): Promise<void> {
  await tx.insert(skillTreeEvents).values({
    kind: e.kind, by: e.by, nodeId: e.nodeId ?? null, courseCode: e.courseCode ?? null, skillRef: e.skillRef ?? null,
    before: e.before ?? null, after: e.after ?? null,
  });
}

const byId = (tree: Tree) => new Map(tree.nodes.map((n) => [n.id, n]));

function need(tree: Tree, id: string): TreeNode {
  const n = byId(tree).get(id);
  if (!n) throw new Refuse(404, 'No such skill.');
  return n;
}
function needLive(tree: Tree, id: string): TreeNode {
  const n = need(tree, id);
  if (n.retired || n.mergedInto) throw new Refuse(409, 'That skill has been retired.');
  return n;
}
function notMaster(n: TreeNode): void {
  if (n.competencyId) throw new Refuse(400, MASTER_REFUSAL);
}
/** True when `candidate` is `id` or sits somewhere below it. */
function isUnder(tree: Tree, candidate: string, id: string): boolean {
  const m = byId(tree);
  const seen = new Set<string>();
  for (let cur: string | null | undefined = candidate; cur && !seen.has(cur); cur = m.get(cur)?.parentId) {
    if (cur === id) return true;
    seen.add(cur);
  }
  return false;
}
/** Confirmed beats rejected beats proposed; lower is more decided. */
const rank = (s: TreeLeaf['status']): number => (s === 'confirmed' ? 0 : s === 'rejected' ? 1 : 2);

const leafKey = (courseCode: string, skillRef: string, nodeId: string) =>
  and(eq(skillLeaves.courseCode, courseCode), eq(skillLeaves.skillRef, skillRef), eq(skillLeaves.nodeId, nodeId));

function findLeaf(tree: Tree, courseCode: string, skillRef: string, nodeId: string): TreeLeaf | undefined {
  return tree.leaves.find((l) => l.courseCode === courseCode && l.skillRef === skillRef && l.nodeId === nodeId);
}

const cleanName = (s: string): string => {
  const v = (s ?? '').trim();
  if (!v) throw new Refuse(400, 'A name is required.');
  return v;
};
const level = (v: number | null): boolean => v === null || (Number.isInteger(v) && v >= 0 && v <= 5);

// ---------------------------------------------------------------- node writes

export async function createNode(a: { name: string; description?: string | null; parentId: string; by: string }): Promise<TreeWrite> {
  return write(async ({ tx, tree }) => {
    const name = cleanName(a.name);
    needLive(tree, a.parentId);
    const id = `n-${randomUUID()}`;
    const description = a.description?.trim() || null;
    await tx.insert(skillNodes).values({ id, name, description, parentId: a.parentId, createdBy: a.by });
    await event(tx, { kind: 'created', by: a.by, nodeId: id, after: { name, description, parentId: a.parentId } });
  });
}

export async function renameNode(a: { id: string; name: string; description?: string | null; by: string }): Promise<TreeWrite> {
  return write(async ({ tx, tree }) => {
    const n = need(tree, a.id);
    notMaster(n);
    const name = cleanName(a.name);
    const description = a.description === undefined ? n.description : (a.description?.trim() || null);
    await tx.update(skillNodes).set({ name, description, updatedAt: sql`now()` }).where(eq(skillNodes.id, a.id));
    await event(tx, {
      kind: name !== n.name ? 'renamed' : 'described', by: a.by, nodeId: a.id,
      before: { name: n.name, description: n.description }, after: { name, description },
    });
  });
}

export async function reparentNode(a: { id: string; parentId: string; by: string }): Promise<TreeWrite> {
  return write(async ({ tx, tree }) => {
    const n = need(tree, a.id);
    notMaster(n);
    needLive(tree, a.parentId);
    if (isUnder(tree, a.parentId, a.id)) throw new Refuse(409, LOOP);
    await tx.update(skillNodes).set({ parentId: a.parentId, updatedAt: sql`now()` }).where(eq(skillNodes.id, a.id));
    await event(tx, { kind: 'reparented', by: a.by, nodeId: a.id, before: { parentId: n.parentId }, after: { parentId: a.parentId } });
  });
}

/** Moves one leaf row to another node; on a clash the more decided row survives (the existing one on a tie). */
async function relocateLeaf(tx: Tx, tree: Tree, l: TreeLeaf, to: string): Promise<void> {
  const clash = findLeaf(tree, l.courseCode, l.skillRef, to);
  if (!clash) {
    await tx.update(skillLeaves).set({ nodeId: to }).where(leafKey(l.courseCode, l.skillRef, l.nodeId));
    return;
  }
  if (rank(l.status) < rank(clash.status)) {
    await tx.delete(skillLeaves).where(leafKey(clash.courseCode, clash.skillRef, clash.nodeId));
    await tx.update(skillLeaves).set({ nodeId: to }).where(leafKey(l.courseCode, l.skillRef, l.nodeId));
  } else {
    await tx.delete(skillLeaves).where(leafKey(l.courseCode, l.skillRef, l.nodeId));
  }
}

export async function mergeNode(a: { from: string; into: string; by: string }): Promise<TreeWrite> {
  return write(async ({ tx, tree }) => {
    const from = need(tree, a.from);
    const into = need(tree, a.into);
    notMaster(from);
    if (from.id === into.id || isUnder(tree, into.id, from.id)) throw new Refuse(409, 'A skill cannot merge into itself or something under it.');
    if (into.retired || into.mergedInto) throw new Refuse(409, 'That skill has been retired.');
    const kids = tree.nodes.filter((n) => n.parentId === from.id);
    const fromLeaves = tree.leaves.filter((l) => l.nodeId === from.id);
    if (kids.length) await tx.update(skillNodes).set({ parentId: into.id, updatedAt: sql`now()` }).where(eq(skillNodes.parentId, from.id));
    for (const l of fromLeaves) await relocateLeaf(tx, tree, l, into.id);
    await tx.update(skillNodes).set({ retired: true, mergedInto: into.id, updatedAt: sql`now()` }).where(eq(skillNodes.id, from.id));
    await event(tx, {
      kind: 'merged', by: a.by, nodeId: from.id,
      before: { retired: false, mergedInto: null, childNodes: kids.map((k) => k.id), leaves: fromLeaves.length },
      after: { retired: true, mergedInto: into.id },
    });
  });
}

export async function splitNode(a: {
  id: string; newName: string; moveNodes: string[]; moveLeaves: Array<{ courseCode: string; skillRef: string }>; by: string;
}): Promise<TreeWrite & { repoint?: { stringPointIds: string[]; depths: Array<{ courseCode: string; instructor: string }> } }> {
  let repoint: { stringPointIds: string[]; depths: Array<{ courseCode: string; instructor: string }> } | undefined;
  const r = await write(async ({ tx, tree }) => {
    const n = needLive(tree, a.id);
    notMaster(n);
    const name = cleanName(a.newName);
    for (const m of a.moveNodes) {
      if (tree.nodes.find((x) => x.id === m)?.parentId !== a.id) throw new Refuse(400, 'Only skills directly under this one can move.');
    }
    for (const m of a.moveLeaves) {
      if (!findLeaf(tree, m.courseCode, m.skillRef, a.id)) throw new Refuse(400, 'Only skills placed directly here can move.');
    }
    const id = `n-${randomUUID()}`;
    await tx.insert(skillNodes).values({ id, name, parentId: n.parentId, createdBy: a.by });
    for (const m of a.moveNodes) await tx.update(skillNodes).set({ parentId: id, updatedAt: sql`now()` }).where(eq(skillNodes.id, m));
    for (const m of a.moveLeaves) await tx.update(skillLeaves).set({ nodeId: id }).where(leafKey(m.courseCode, m.skillRef, a.id));
    const points = await tx.select({ id: stringPoints.id }).from(stringPoints).where(eq(stringPoints.nodeId, a.id));
    repoint = {
      stringPointIds: points.map((p) => p.id),
      depths: tree.depths.filter((d) => d.nodeId === a.id).map((d) => ({ courseCode: d.courseCode, instructor: d.instructor })),
    };
    await event(tx, {
      kind: 'split', by: a.by, nodeId: a.id,
      after: { newNodeId: id, newName: name, moveNodes: a.moveNodes, moveLeaves: a.moveLeaves, repoint },
    });
  });
  return r.ok ? { ...r, repoint } : r;
}

export async function setWeight(a: { id: string; weight: number; by: string }): Promise<TreeWrite> {
  return write(async ({ tx, tree }) => {
    const n = need(tree, a.id);
    if (typeof a.weight !== 'number' || !Number.isFinite(a.weight) || a.weight <= 0) throw new Refuse(400, 'Weight must be a number above zero.');
    await tx.update(skillNodes).set({ weight: a.weight, weightSource: 'faculty', updatedAt: sql`now()` }).where(eq(skillNodes.id, a.id));
    await event(tx, { kind: 'weight', by: a.by, nodeId: a.id, before: { weight: n.weight, weightSource: n.weightSource }, after: { weight: a.weight, weightSource: 'faculty' } });
  });
}

// ---------------------------------------------------------------- leaf writes

export async function placeLeaf(a: { courseCode: string; skillRef: string; statement: string; nodeId: string; by: string }): Promise<TreeWrite> {
  return write(async ({ tx, tree }) => {
    needLive(tree, a.nodeId);
    const statement = (a.statement ?? '').trim();
    if (!statement) throw new Refuse(400, 'A skill statement is required.');
    const existing = findLeaf(tree, a.courseCode, a.skillRef, a.nodeId);
    if (existing) {
      await tx.update(skillLeaves).set({ status: 'confirmed', decidedBy: a.by, decidedAt: sql`now()` }).where(leafKey(a.courseCode, a.skillRef, a.nodeId));
    } else {
      await tx.insert(skillLeaves).values({ courseCode: a.courseCode, skillRef: a.skillRef, nodeId: a.nodeId, statement, source: 'faculty', status: 'confirmed', decidedBy: a.by, decidedAt: sql`now()` });
    }
    await event(tx, {
      kind: existing ? 'leaf_confirmed' : 'leaf_placed', by: a.by, nodeId: a.nodeId, courseCode: a.courseCode, skillRef: a.skillRef,
      before: existing ? { status: existing.status } : null, after: { status: 'confirmed', source: existing?.source ?? 'faculty' },
    });
  });
}

export async function decideLeaf(a: { courseCode: string; skillRef: string; nodeId: string; decision: 'confirm' | 'reject'; by: string }): Promise<TreeWrite> {
  return write(async ({ tx, tree }) => {
    const l = findLeaf(tree, a.courseCode, a.skillRef, a.nodeId);
    if (!l) throw new Refuse(404, 'No such placed skill.');
    const status = a.decision === 'confirm' ? 'confirmed' : 'rejected';
    await tx.update(skillLeaves).set({ status, decidedBy: a.by, decidedAt: sql`now()` }).where(leafKey(a.courseCode, a.skillRef, a.nodeId));
    await event(tx, {
      kind: status === 'confirmed' ? 'leaf_confirmed' : 'leaf_rejected', by: a.by, nodeId: a.nodeId, courseCode: a.courseCode, skillRef: a.skillRef,
      before: { status: l.status }, after: { status },
    });
  });
}

export async function moveLeaf(a: { courseCode: string; skillRef: string; from: string; to: string; by: string }): Promise<TreeWrite> {
  return write(async ({ tx, tree }) => {
    const l = findLeaf(tree, a.courseCode, a.skillRef, a.from);
    if (!l) throw new Refuse(404, 'No such placed skill.');
    needLive(tree, a.to);
    if (a.to === a.from) throw new Refuse(400, 'That skill is already there.');
    await relocateLeaf(tx, tree, l, a.to);
    await event(tx, { kind: 'leaf_moved', by: a.by, nodeId: a.to, courseCode: a.courseCode, skillRef: a.skillRef, before: { nodeId: a.from }, after: { nodeId: a.to } });
  });
}

export async function setShare(a: { courseCode: string; skillRef: string; nodeId: string; share: number | null; by: string }): Promise<TreeWrite> {
  return write(async ({ tx, tree }) => {
    const l = findLeaf(tree, a.courseCode, a.skillRef, a.nodeId);
    if (!l) throw new Refuse(404, 'No such placed skill.');
    if (a.share !== null && (typeof a.share !== 'number' || !Number.isFinite(a.share) || a.share <= 0)) throw new Refuse(400, 'A share must be a number above zero, or blank.');
    await tx.update(skillLeaves).set({ share: a.share }).where(leafKey(a.courseCode, a.skillRef, a.nodeId));
    await event(tx, { kind: 'leaf_share', by: a.by, nodeId: a.nodeId, courseCode: a.courseCode, skillRef: a.skillRef, before: { share: l.share }, after: { share: a.share } });
  });
}

export async function retargetLeaf(a: { courseCode: string; oldRef: string; newRef: string; newStatement: string; by: string }): Promise<TreeWrite> {
  return write(async ({ tx, tree }) => {
    const newStatement = (a.newStatement ?? '').trim();
    if (!newStatement) throw new Refuse(400, 'A skill statement is required.');
    const olds = tree.leaves.filter((l) => l.courseCode === a.courseCode && l.skillRef === a.oldRef);
    if (olds.length === 0) throw new Refuse(404, 'No such placed skill.');
    if (a.oldRef === a.newRef) throw new Refuse(400, 'Nothing to change.');
    for (const o of olds) {
      const clash = findLeaf(tree, a.courseCode, a.newRef, o.nodeId);
      if (!clash) {
        await tx.update(skillLeaves).set({ skillRef: a.newRef, statement: newStatement }).where(leafKey(a.courseCode, a.oldRef, o.nodeId));
      } else if (rank(o.status) < rank(clash.status)) {
        await tx.delete(skillLeaves).where(leafKey(a.courseCode, a.newRef, o.nodeId));
        await tx.update(skillLeaves).set({ skillRef: a.newRef, statement: newStatement }).where(leafKey(a.courseCode, a.oldRef, o.nodeId));
      } else {
        await tx.delete(skillLeaves).where(leafKey(a.courseCode, a.oldRef, o.nodeId));
        await tx.update(skillLeaves).set({ statement: newStatement }).where(leafKey(a.courseCode, a.newRef, o.nodeId));
      }
    }
    await event(tx, {
      kind: 'leaf_retargeted', by: a.by, courseCode: a.courseCode, skillRef: a.newRef,
      before: { skillRef: a.oldRef, nodes: olds.map((o) => o.nodeId) }, after: { skillRef: a.newRef, statement: newStatement },
    });
  });
}

// ---------------------------------------------------------------- depth writes

export async function setDepth(a: { nodeId: string; courseCode: string; instructor: string; k: number | null; u: number | null; d: number | null; by: string }): Promise<TreeWrite> {
  return write(async ({ tx, tree }) => {
    need(tree, a.nodeId);
    if (!level(a.k) || !level(a.u) || !level(a.d)) throw new Refuse(400, 'Levels are whole numbers from 0 to 5, or blank.');
    const before = tree.depths.find((x) => x.nodeId === a.nodeId && x.courseCode === a.courseCode && x.instructor === a.instructor) ?? null;
    const signature = leavesSignature(tree, a.nodeId, a.courseCode);
    const row = { k: a.k, u: a.u, d: a.d, method: 'faculty' as const, leavesSignature: signature, setBy: a.by };
    await tx.insert(nodeDepths).values({ nodeId: a.nodeId, courseCode: a.courseCode, instructor: a.instructor, ...row })
      .onConflictDoUpdate({ target: [nodeDepths.nodeId, nodeDepths.courseCode, nodeDepths.instructor], set: { ...row, setAt: sql`now()` } });
    await event(tx, {
      kind: 'depth_set', by: a.by, nodeId: a.nodeId, courseCode: a.courseCode,
      before: before && { instructor: before.instructor, k: before.k, u: before.u, d: before.d, method: before.method },
      after: { instructor: a.instructor, k: a.k, u: a.u, d: a.d, method: 'faculty', leavesSignature: signature },
    });
  });
}

export async function clearDepth(a: { nodeId: string; courseCode: string; instructor: string; by: string }): Promise<TreeWrite> {
  return write(async ({ tx, tree }) => {
    const before = tree.depths.find((x) => x.nodeId === a.nodeId && x.courseCode === a.courseCode && x.instructor === a.instructor);
    if (!before) throw new Refuse(404, 'No set depth to clear.');
    await tx.delete(nodeDepths).where(and(eq(nodeDepths.nodeId, a.nodeId), eq(nodeDepths.courseCode, a.courseCode), eq(nodeDepths.instructor, a.instructor)));
    await event(tx, { kind: 'depth_cleared', by: a.by, nodeId: a.nodeId, courseCode: a.courseCode, before: { instructor: a.instructor, k: before.k, u: before.u, d: before.d, method: before.method } });
  });
}
