import { NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/auth/route-auth';
import { loadLibrary } from '@/lib/builder/library';
import { counts } from '@/lib/skill-tree/read';
import * as q from '@/lib/db/skill-tree-queries';
import { suggestNewWordings, suggestParents } from '@/lib/skill-tree/suggest';
import { authorOf, bad, readBody, str, type Body } from '@/lib/strings/api';

/**
 * GET /api/skill-tree[?course=<code>] → { tree } or, with a course,
 * { tree, versions: [{ instructor, snapshotId, skills, gone: [{ skillRef, statement, suggestion }] }], suggestions }.
 * `gone` are the course's non-rejected leaves whose skill is in none of its captures; `suggestions` (parents) and the new-wording pool cover only skills with no counting leaf (confirmed, or proposed by a person).
 */
export async function GET(req: Request): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  const tree = await q.loadTree();
  const course = new URL(req.url).searchParams.get('course');
  if (!course) return NextResponse.json({ tree });

  const lib = await loadLibrary();
  const versionsRaw = lib.courses.find((c) => c.code === course)?.versions ?? [];
  const inCapture = new Set(versionsRaw.flatMap((v) => v.skills.map((s) => s.skillRef)));
  const live = tree.leaves.filter((l) => l.courseCode === course && l.status !== 'rejected');
  const placed = new Set(live.filter(counts).map((l) => l.skillRef));
  const goneLeaves = new Map<string, { skillRef: string; statement: string }>();
  for (const l of live) if (!inCapture.has(l.skillRef) && !goneLeaves.has(l.skillRef)) goneLeaves.set(l.skillRef, { skillRef: l.skillRef, statement: l.statement });
  const gone = [...goneLeaves.values()];
  const unplaced = new Map<string, (typeof versionsRaw)[number]['skills'][number]>();
  for (const v of versionsRaw) for (const s of v.skills) if (!placed.has(s.skillRef) && !unplaced.has(s.skillRef)) unplaced.set(s.skillRef, s);
  const pool = [...unplaced.values()].map((s) => ({ skillRef: s.skillRef, statement: s.statement }));

  const [suggestions, wordings] = await Promise.all([suggestParents(tree, pool), suggestNewWordings(gone, pool)]);
  const versions = versionsRaw.map((v) => ({
    instructor: v.instructorName ?? '',
    snapshotId: v.snapshotId,
    skills: v.skills.map((s) => ({ skillRef: s.skillRef, statement: s.statement, k: s.k, u: s.u, d: s.d })),
    gone: gone.map((g) => ({ ...g, suggestion: wordings[g.skillRef] ?? null })),
  }));
  return NextResponse.json({ tree, versions, suggestions });
}

const MISSING = 'Some required fields are missing.';
const NOT_IN_CAPTURE = "That skill is not in this course's capture.";

/** A depth level: integer 0-5, or null (also when absent); undefined when it is anything else. */
const level = (v: unknown): number | null | undefined =>
  v === null || v === undefined ? null : typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 5 ? v : undefined;

const strs = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null);

/** The statement as the course's captures hold it; the client's statement is never trusted. */
async function captureStatement(courseCode: string, skillRef: string): Promise<string | null> {
  const lib = await loadLibrary();
  for (const v of lib.courses.find((c) => c.code === courseCode)?.versions ?? []) {
    const s = v.skills.find((x) => x.skillRef === skillRef);
    if (s) return s.statement;
  }
  return null;
}

async function run(action: unknown, b: Body, by: string): Promise<q.TreeWrite | Response> {
  const course = str(b.courseCode);
  const ref = str(b.skillRef);
  const node = str(b.nodeId);
  switch (action) {
    case 'create': {
      const name = str(b.name)?.trim(), parentId = str(b.parentId);
      if (!name || !parentId) return bad(MISSING);
      return q.createNode({ name, description: typeof b.description === 'string' ? b.description : null, parentId, by });
    }
    case 'rename': {
      const id = str(b.id), name = str(b.name)?.trim();
      if (!id || !name) return bad(MISSING);
      return q.renameNode({ id, name, description: typeof b.description === 'string' ? b.description : null, by });
    }
    case 'reparent': {
      const id = str(b.id), parentId = str(b.parentId);
      if (!id || !parentId) return bad(MISSING);
      return q.reparentNode({ id, parentId, by });
    }
    case 'merge': {
      const from = str(b.from), into = str(b.into);
      if (!from || !into) return bad(MISSING);
      return q.mergeNode({ from, into, by });
    }
    case 'split': {
      const id = str(b.id), newName = str(b.newName)?.trim(), moveNodes = strs(b.moveNodes);
      const ml = b.moveLeaves;
      if (!id || !newName || !moveNodes || !Array.isArray(ml)) return bad(MISSING);
      const moveLeaves: Array<{ courseCode: string; skillRef: string }> = [];
      for (const x of ml) {
        const c = str((x as Body | null)?.courseCode), r = str((x as Body | null)?.skillRef);
        if (!c || !r) return bad(MISSING);
        moveLeaves.push({ courseCode: c, skillRef: r });
      }
      return q.splitNode({ id, newName, moveNodes, moveLeaves, by });
    }
    case 'weight': {
      const id = str(b.id);
      if (!id || typeof b.weight !== 'number' || !Number.isFinite(b.weight)) return bad(MISSING);
      return q.setWeight({ id, weight: b.weight, by });
    }
    case 'place': {
      if (!course || !ref || !node) return bad(MISSING);
      const statement = await captureStatement(course, ref);
      if (statement === null) return bad(NOT_IN_CAPTURE, 404);
      return q.placeLeaf({ courseCode: course, skillRef: ref, statement, nodeId: node, by });
    }
    case 'confirm':
    case 'reject':
      if (!course || !ref || !node) return bad(MISSING);
      return q.decideLeaf({ courseCode: course, skillRef: ref, nodeId: node, decision: action, by });
    case 'move': {
      const from = str(b.from), to = str(b.to);
      if (!course || !ref || !from || !to) return bad(MISSING);
      return q.moveLeaf({ courseCode: course, skillRef: ref, from, to, by });
    }
    case 'share': {
      if (!course || !ref || !node) return bad(MISSING);
      const share = b.share === null || b.share === undefined ? null : typeof b.share === 'number' && Number.isFinite(b.share) ? b.share : undefined;
      if (share === undefined) return bad(MISSING);
      return q.setShare({ courseCode: course, skillRef: ref, nodeId: node, share, by });
    }
    case 'retarget': {
      const oldRef = str(b.oldRef), newRef = str(b.newRef);
      if (!course || !oldRef || !newRef) return bad(MISSING);
      const newStatement = await captureStatement(course, newRef);
      if (newStatement === null) return bad(NOT_IN_CAPTURE, 404);
      return q.retargetLeaf({ courseCode: course, oldRef, newRef, newStatement, by });
    }
    case 'depth': {
      const instructor = typeof b.instructor === 'string' ? b.instructor : null;
      if (!node || !course || instructor === null) return bad(MISSING);
      const k = level(b.k), u = level(b.u), d = level(b.d);
      if (k === undefined || u === undefined || d === undefined) return bad('Depth levels are whole numbers from 0 to 5.');
      return q.setDepth({ nodeId: node, courseCode: course, instructor, k, u, d, by });
    }
    case 'depth-clear': {
      const instructor = typeof b.instructor === 'string' ? b.instructor : null;
      if (!node || !course || instructor === null) return bad(MISSING);
      return q.clearDepth({ nodeId: node, courseCode: course, instructor, by });
    }
    default:
      return bad('Unknown action.');
  }
}

/** POST /api/skill-tree  Body: { action, ...args, authorName? } → 200 { tree, repoint? } | 400/404/409 { error } */
export async function POST(req: Request): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  const body = await readBody(req);
  const by = authorOf(auth.grant, body);
  if (!by) return bad('Add your name first.');
  const r = await run(body.action, body, by);
  if (r instanceof Response) return r;
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ tree: r.tree, ...('repoint' in r ? { repoint: r.repoint } : {}) });
}
