import { authorizeRequest } from '@/lib/auth/route-auth';
import { setPointNode } from '@/lib/db/string-queries';
import { authorOf, bad, readBody, respond, str, UUID } from '@/lib/strings/api';

interface Ctx { params: Promise<{ id: string }> }

const need = (v: unknown): number | null | undefined =>
  v === null || v === undefined ? null : typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 5 ? v : undefined;

/**
 * POST /api/strings/points/[id]/node: make a requires point check against a tree skill.
 * Body: { nodeId: string | null, k?, u?, d?, authorName? } (each need 0-5 or null; nodeId null clears the check).
 * → 200 { graph, notes } | 400 | 404
 */
export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!UUID.test(id)) return bad('Point not found.', 404);
  const body = await readBody(req);
  const by = authorOf(auth.grant, body);
  if (!by) return bad('A name is required.');
  if (body.nodeId !== null && !str(body.nodeId)) return bad('Say which tree skill to check against.');
  const k = need(body.k), u = need(body.u), d = need(body.d);
  if (k === undefined || u === undefined || d === undefined) return bad('Each need is a whole number from 0 to 5.');
  const nodeId = body.nodeId === null ? null : str(body.nodeId)!.trim();
  if (nodeId !== null && k === null && u === null && d === null) return bad('Give at least one level the course needs.');
  return respond(await setPointNode({ pointId: id, nodeId, need: { k, u, d }, by }));
}
