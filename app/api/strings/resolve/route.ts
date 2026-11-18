import { NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/auth/route-auth';
import { listOrphanNotes, loadGraph } from '@/lib/db/string-queries';
import { loadLibrary } from '@/lib/builder/library';
import { orphansOf } from '@/lib/builder/strings/touch';
import { resolveAll } from '@/lib/strings/resolve-all';
import { bad, CAP, readBody, subGraph, UUID } from '@/lib/strings/api';

/**
 * POST /api/strings/resolve
 * Body: { courseCodes } → the active strings through those courses; or { stringId } → that one string, unlocked included.
 * → { graph, status, levels, notes }: `status` is each point's standing against the course's current capture,
 * `levels` the catalog level of each course in the graph (and of each requested course), `notes` the orphan notes
 * for the requested courses and `orphans` each requested course's skills on no active string (both empty for a stringId request). A POST only because the course list can be long; it reads.
 */
export async function POST(req: Request): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  const body = await readBody(req);

  let graph;
  let requested: string[] = [];
  if (typeof body.stringId === 'string') {
    if (!UUID.test(body.stringId)) return bad('String not found.', 404);
    graph = subGraph(await loadGraph({ includeUnlocked: true }), body.stringId);
    if (!graph) return bad('String not found.', 404);
  } else if (Array.isArray(body.courseCodes) && body.courseCodes.every((c) => typeof c === 'string')) {
    if (body.courseCodes.length > CAP.courses) return bad('Too many courses.');
    if (body.courseCodes.some((c) => c.length > CAP.code)) return bad('Course code too long.');
    requested = [...new Set(body.courseCodes as string[])];
    graph = await loadGraph({ courseCodes: requested });
  } else {
    return bad('Send courseCodes or a stringId.');
  }

  const lib = await loadLibrary();
  const points = Object.values(graph.points);
  const status = await resolveAll(lib, points);
  const levels: Record<string, number> = {};
  for (const code of [...points.map((p) => p.courseCode), ...requested]) {
    const c = lib.courses.find((x) => x.code === code);
    if (c) levels[code] = c.level;
  }
  const notes = await listOrphanNotes(requested);
  const orphans = Object.fromEntries(requested.map((code) => [code, orphansOf(lib, graph, notes, code)]));
  return NextResponse.json({ graph, status, levels, notes, orphans });
}
