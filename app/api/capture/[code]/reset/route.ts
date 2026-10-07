import { NextResponse } from 'next/server';
import { authorizeCourseWrite } from '@/lib/sandbox/access';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';
import { runCourseReset, type ResetScope } from '@/lib/capture/run-course-reset';

interface RouteContext { params: Promise<{ code: string }> }

/**
 * POST /api/capture/[code]/reset?slug=...
 * Body: { scope?: 'session' | 'materials' | 'everything', includeSnapshots?: boolean }
 *
 * Course-scoped twin of POST /api/admin/v2-reset — same underlying work
 * (lib/capture/run-course-reset.ts), but classified 'course-write' by
 * lib/auth/authorize.ts so a scoped access-link holder (capture capability,
 * scope = this course) can trigger it, not just an admin/operator credential.
 * The course code comes from the PATH; a body `courseCode` that disagrees is
 * rejected rather than silently followed. See run-course-reset.ts for exactly
 * what each scope deletes — the default 'session' scope is the gentlest:
 * it drops only the working draft and preserves transcripts, indexed
 * materials, and snapshots.
 */
export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);
  if (!(await authorizeCourseWrite(req, courseCode, slug))) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const body = await req.json().catch(() => ({})) as {
    courseCode?: unknown;
    scope?: unknown;
    includeSnapshots?: unknown;
  };
  if (typeof body.courseCode === 'string' && body.courseCode.trim() && body.courseCode.trim() !== courseCode) {
    return NextResponse.json({ error: 'courseCode does not match the path' }, { status: 400 });
  }
  if (body.scope !== undefined && body.scope !== 'session' && body.scope !== 'materials' && body.scope !== 'everything') {
    return NextResponse.json({ error: "scope must be 'session', 'materials', or 'everything'" }, { status: 400 });
  }
  const scope: ResetScope = (body.scope as ResetScope | undefined) ?? 'session';
  const includeSnapshots = body.includeSnapshots === true;

  const result = await runCourseReset(courseCode, { scope, includeSnapshots });
  return NextResponse.json(result);
}
