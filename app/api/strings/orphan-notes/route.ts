import { authorizeRequest } from '@/lib/auth/route-auth';
import { setOrphanNote } from '@/lib/db/string-queries';
import { authorOf, bad, CAP, hashOf, overLongText, readBody, respond, str, TOO_LONG } from '@/lib/strings/api';

/**
 * POST /api/strings/orphan-notes: say why a skill that left its course's capture is not on any string.
 * Body: { courseCode, role, statement, reason, authorName? } (the hash is computed here) → 200 { graph, notes } | 400
 */
export async function POST(req: Request): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  const body = await readBody(req);
  const by = authorOf(auth.grant, body);
  if (!by) return bad('A name is required.');
  const courseCode = str(body.courseCode)?.trim();
  const statement = str(body.statement)?.trim();
  const reason = str(body.reason)?.trim();
  if (!courseCode || !statement || (body.role !== 'develops' && body.role !== 'requires')) {
    return bad('Say which skill the note is about.');
  }
  if (!reason) return bad('A reason is required.');
  if (courseCode.length > CAP.code || statement.length > CAP.statement) return bad(TOO_LONG);
  const long = overLongText(body);
  if (long) return bad(long);
  return respond(await setOrphanNote({ courseCode, role: body.role, statementHash: hashOf(statement), statement, reason, by }));
}
