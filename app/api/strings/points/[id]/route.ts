import { authorizeRequest } from '@/lib/auth/route-auth';
import { confirmReword, loadGraph } from '@/lib/db/string-queries';
import { loadLibrary } from '@/lib/builder/library';
import { roleSkills } from '@/lib/builder/strings/resolve';
import { authorOf, bad, BAD_SNAPSHOT, CAP, hashOf, parseSnapshotId, TOO_LONG, readBody, respond, str, UUID } from '@/lib/strings/api';

interface Ctx { params: Promise<{ id: string }> }

/**
 * POST /api/strings/points/[id]: accept a reword.
 * Body: { candidate: { statement, hash }, snapshotId?, authorName? }. The depth comes from the course's current
 * capture (the candidate must still be in it), never from the request. An absent snapshotId means the course's
 * current capture; a present one must be a UUID.
 * → 200 { graph, notes } | 400 | 404 | 409 { error }
 */
export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!UUID.test(id)) return bad('Point not found.', 404);
  const body = await readBody(req);
  const by = authorOf(auth.grant, body);
  if (!by) return bad('A name is required.');
  const c = body.candidate as { statement?: unknown; hash?: unknown } | null;
  const statement = c && typeof c === 'object' ? str(c.statement)?.trim() : undefined;
  const hash = c && typeof c === 'object' ? str(c.hash) : null;
  if (!statement || !hash) return bad('Send the new wording and its hash.');
  if (statement.length > CAP.statement) return bad(TOO_LONG);
  const sent = parseSnapshotId(body.snapshotId);
  if (sent === undefined) return bad(BAD_SNAPSHOT);

  const point = (await loadGraph({ includeUnlocked: true })).points[id];
  if (!point) return bad('Point not found.', 404);
  const gone = 'That wording is no longer in the course\'s capture.';
  const hit = roleSkills(point, await loadLibrary());
  if ('why' in hit || hashOf(statement) !== hash) return bad(gone, 409);
  const skill = hit.skills.find((s) => s.hash === hash);
  if (!skill) return bad(gone, 409);
  const snapshotId = sent ?? hit.snapshotId;
  return respond(await confirmReword({ pointId: id, candidate: { statement, hash }, snapshotId, depth: skill.depth, by }));
}
