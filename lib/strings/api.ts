/**
 * Small helpers shared by the /api/strings routes: reading a JSON body, naming the author, turning a query
 * result into a response, narrowing a graph to one string, and validating a point sent by the client.
 */
import { NextResponse } from 'next/server';
import { personalName } from '@/lib/auth/viewer';
import type { Grant } from '@/lib/auth/authorize';
import { NAME_MAX } from '@/lib/builder/plan-schema';
import { hashOf } from './hash';
import type { WriteResult, PointInput } from '@/lib/db/string-queries';
import { roleSkills } from '@/lib/builder/strings/resolve';
import type { Library } from '@/lib/builder/types';
import type { PointRow, StringGraph } from '@/lib/builder/strings/types';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Body = Record<string, unknown>;

export async function readBody(req: Request): Promise<Body> {
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Body;
  } catch { /* an unreadable body is treated as empty; the caller's field checks answer 400 */ }
  return {};
}

export const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** The signed-in person's name, or the name typed for a login that names nobody; null when there is neither. */
export function authorOf(grant: Grant | null, body: Body): string | null {
  const name = personalName(grant)
    ?? (typeof body.authorName === 'string' ? body.authorName.trim().slice(0, NAME_MAX) : '');
  return name || null;
}

export const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** A write result as a response: the refusal's status, message and (on a stale version) the current row pass straight through. */
export function respond(r: WriteResult, okStatus = 200): Response {
  if (r.ok) return NextResponse.json({ graph: r.graph, notes: r.notes ?? [] }, { status: okStatus });
  return NextResponse.json({ error: r.error, ...(r.current ? { current: r.current } : {}) }, { status: r.status });
}

/** The graph narrowed to one string: its row, its points, the links among them and the events about either. */
export function subGraph(g: StringGraph, id: string): StringGraph | null {
  const s = g.strings.find((x) => x.id === id);
  if (!s) return null;
  const ids = new Set(s.path);
  return {
    strings: [s],
    points: Object.fromEntries(s.path.filter((p) => g.points[p]).map((p) => [p, g.points[p]!])),
    links: g.links.filter((l) => ids.has(l.from) && ids.has(l.to)),
    events: g.events.filter((e) => e.stringId === id || (e.pointId !== null && ids.has(e.pointId))),
  };
}

const depthOf = (v: unknown): number | null | undefined =>
  v === null || v === undefined ? null : typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 5 ? v : undefined;

export { hashOf };

/** Size limits for text and lists sent to the string routes. */
export const CAP = { text: 1000, statement: 2000, code: 40, points: 50, courses: 200 } as const;
export const TOO_LONG = 'That text is too long.';
export const BAD_SNAPSHOT = 'Invalid snapshot id.';

/** First free-text field in `b` (why, reason, description, note) over the cap, or null. */
export function overLongText(b: Body): string | null {
  for (const k of ['why', 'reason', 'description', 'note']) {
    const v = b[k];
    if (typeof v === 'string' && v.length > CAP.text) return `The ${k === 'note' ? 'note' : k} is too long (${CAP.text} characters at most).`;
  }
  return null;
}

/** A snapshot id from the request: null when absent, the id when it is a UUID, undefined when it is anything else. */
export function parseSnapshotId(v: unknown): string | null | undefined {
  if (v === null || v === undefined) return null;
  return typeof v === 'string' && UUID.test(v) ? v : undefined;
}

/** A point from the request body, or the sentence to show. The hash is always computed here, never taken from the client. */
export function parsePoint(v: unknown): { point: PointInput } | { error: string } {
  const err = (error: string) => ({ error });
  if (!v || typeof v !== 'object') return err(POINT_BAD);
  const p = v as Body;
  const courseCode = str(p.courseCode)?.trim();
  const statement = str(p.statement)?.trim();
  if (!courseCode || !statement || (p.role !== 'develops' && p.role !== 'requires')) return err(POINT_BAD);
  if (courseCode.length > CAP.code || statement.length > CAP.statement) return err(TOO_LONG);
  const k = depthOf(p.k), u = depthOf(p.u), d = depthOf(p.d);
  if (k === undefined || u === undefined || d === undefined) return err(POINT_BAD);
  const snapshotId = parseSnapshotId(p.snapshotId);
  if (snapshotId === undefined) return err(BAD_SNAPSHOT);
  return { point: { courseCode, role: p.role, statement, statementHash: hashOf(statement), snapshotId, k, u, d } };
}

export const POINT_BAD = 'Each skill needs a course, a role (develops or requires) and a statement.';

export const NOT_CAPTURED = 'Strings can only run through captured courses.';

/**
 * The point as the captured course holds it: the course must have a capture and the statement (by server hash) must be
 * in its newest capture for that role. The snapshot and the depths come from that capture, never from the client.
 */
export function anchorPoint(p: PointInput, lib: Library): PointInput | null {
  const hit = roleSkills({ courseCode: p.courseCode, role: p.role } as PointRow, lib);
  if ('why' in hit) return null;
  const skill = hit.skills.find((s) => s.hash === p.statementHash);
  if (!skill) return null;
  return { ...p, statement: skill.statement.trim(), snapshotId: hit.snapshotId, k: skill.depth.k, u: skill.depth.u, d: skill.depth.d };
}
