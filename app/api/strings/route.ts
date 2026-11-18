import { NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/auth/route-auth';
import { loadGraph, lockString } from '@/lib/db/string-queries';
import { NAME_MAX } from '@/lib/builder/plan-schema';
import { authorOf, bad, CAP, overLongText, parsePoint, readBody, respond, str } from '@/lib/strings/api';

/**
 * POST /api/strings
 * Body: { name, description?, points: [{ courseCode, role, statement, snapshotId?, k?, u?, d? }], whys: string[], authorName? }
 * `whys` has one entry per link, so one fewer than `points`. → 201 { graph, notes } | 400/409 { error }
 */
export async function POST(req: Request): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  const body = await readBody(req);
  const name = str(body.name)?.trim().slice(0, NAME_MAX);
  if (!name) return bad('A string needs a name.');
  const by = authorOf(auth.grant, body);
  if (!by) return bad('A name is required.');
  if (!Array.isArray(body.points) || !Array.isArray(body.whys)) return bad('A string needs its skills and a reason for each link.');
  if (body.points.length > CAP.points) return bad(`A string can have at most ${CAP.points} skills.`);
  if (body.whys.length !== body.points.length - 1) return bad('Each link needs a reason.');
  const long = overLongText(body) ?? (body.whys.some((w) => typeof w === 'string' && w.length > CAP.text) ? `A reason is too long (${CAP.text} characters at most).` : null);
  if (long) return bad(long);
  const parsed = body.points.map(parsePoint);
  const failed = parsed.find((p) => 'error' in p);
  if (failed && 'error' in failed) return bad(failed.error);
  const points = parsed.map((p) => ('point' in p ? p.point : null!));
  const whys = body.whys.map((w) => (typeof w === 'string' ? w : ''));
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  return respond(await lockString({ name, description, points, whys, by }), 201);
}

/**
 * GET /api/strings[?all=1] → { strings: [{ id, name, status, path, stops, end, mergedInto }] }
 * Active strings; `?all=1` adds unlocked ones. `path` is the course codes in order.
 */
export async function GET(req: Request): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  const includeUnlocked = new URL(req.url).searchParams.get('all') === '1';
  const g = await loadGraph({ includeUnlocked });
  const strings = g.strings.map((s) => {
    const path = s.path.map((p) => g.points[p]?.courseCode ?? '');
    return { id: s.id, name: s.name, status: s.status, path, stops: path.length, end: path[path.length - 1] ?? null, mergedInto: s.mergedInto };
  });
  return NextResponse.json({ strings });
}
