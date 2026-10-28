import { NextResponse } from 'next/server';
import { authorizeCourseWrite } from '@/lib/sandbox/access';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { getCaptureConversation, deleteCaptureConversation } from '@/lib/db/capture-conversations-queries';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ code: string }> }

// Auth check + course existence in one place.
async function authAndCourse(req: Request, codeParam: string): Promise<{ ok: true; courseCode: string } | { ok: false; res: Response }> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  const courseCode = decodeURIComponent(codeParam);
  if (!(await authorizeCourseWrite(req, courseCode, slug))) return { ok: false, res: NextResponse.json({ error: 'invalid slug' }, { status: 401 }) };
  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return { ok: false, res: NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 }) };
  const course = await getCourseByCode(courseCode);
  if (!course) return { ok: false, res: NextResponse.json({ error: 'course not found' }, { status: 404 }) };
  return { ok: true, courseCode };
}

// GET /api/capture/[code]/conversation?slug=...
// Returns the saved conversation (messages + last readiness) for the course,
// or { messages: [], readiness: null } if none.
export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  const { code: rawCode } = await params;
  const gate = await authAndCourse(req, rawCode);
  if (!gate.ok) return gate.res;

  const conv = await getCaptureConversation(gate.courseCode);
  if (!conv) return NextResponse.json({ messages: [], readiness: null, updatedAt: null });
  return NextResponse.json({
    messages: conv.messages,
    readiness: conv.readiness,
    updatedAt: conv.updatedAt,
  });
}

// DELETE /api/capture/[code]/conversation?slug=...
// Clears the saved conversation. Used after a successful Generate or by
// a manual "clear conversation" action.
export async function DELETE(req: Request, { params }: RouteContext): Promise<Response> {
  const { code: rawCode } = await params;
  const gate = await authAndCourse(req, rawCode);
  if (!gate.ok) return gate.res;

  const deleted = await deleteCaptureConversation(gate.courseCode);
  return NextResponse.json({ ok: true, deleted });
}
