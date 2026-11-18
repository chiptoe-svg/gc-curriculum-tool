/**
 * Small helpers shared by the /api/strings routes: reading a JSON body, naming the author, turning a query
 * result into a response, narrowing a graph to one string, and validating a point sent by the client.
 */
import { NextResponse } from 'next/server';
import { personalName } from '@/lib/auth/viewer';
import type { Grant } from '@/lib/auth/authorize';
import { NAME_MAX } from '@/lib/builder/plan-schema';
import { textHash } from '@/lib/catalog/bundles';
import { normalizeStatement } from '@/lib/catalog/project-trail';
import type { WriteResult, PointInput } from '@/lib/db/string-queries';
import type { StringGraph } from '@/lib/builder/strings/types';

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

export const hashOf = (statement: string) => textHash(normalizeStatement(statement));

/** A point from the request body. The hash is always computed here, never taken from the client. */
export function parsePoint(v: unknown): PointInput | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Body;
  const courseCode = str(p.courseCode)?.trim();
  const statement = str(p.statement)?.trim();
  if (!courseCode || !statement || (p.role !== 'develops' && p.role !== 'requires')) return null;
  const k = depthOf(p.k), u = depthOf(p.u), d = depthOf(p.d);
  if (k === undefined || u === undefined || d === undefined) return null;
  const snapshotId = p.snapshotId === null || p.snapshotId === undefined ? null : str(p.snapshotId);
  if (p.snapshotId !== null && p.snapshotId !== undefined && !snapshotId) return null;
  return { courseCode, role: p.role, statement, statementHash: hashOf(statement), snapshotId, k, u, d };
}

export const POINT_BAD = 'Each skill needs a course, a role (develops or requires) and a statement.';
