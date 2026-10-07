import { NextResponse } from 'next/server';
import { authorizeCourseWrite } from '@/lib/sandbox/access';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';
import { runCourseReset } from '@/lib/capture/run-course-reset';

interface RouteContext { params: Promise<{ code: string }> }

/**
 * POST /api/capture/[code]/reset?slug=...
 * Body: { scope?: 'session', includeSnapshots?: false }
 *
 * Course-scoped twin of POST /api/admin/v2-reset — same underlying work
 * (lib/capture/run-course-reset.ts), but classified 'course-write' by
 * lib/auth/authorize.ts so a scoped access-link holder (capture capability,
 * scope = this course) can trigger it, not just an admin/operator credential.
 * The course code comes from the PATH; a body `courseCode` that disagrees is
 * rejected rather than silently followed.
 *
 * SESSION-ONLY, BY DESIGN (owner must-fix, 2026-10-07 follow-up review): this
 * route accepts ONLY scope 'session' (the working-draft-only delete the
 * "Reset interview" button uses) with includeSnapshots false/absent — it
 * drops just the course_capture_profiles row and preserves transcripts,
 * indexed materials, and snapshots. Any deeper scope ('materials',
 * 'everything') or includeSnapshots:true is refused with 403, NOT silently
 * downgraded or passed through — a scoped single-course access-link holder
 * (or the department login) must not be able to self-trigger a destructive
 * reset (dropping the Weaviate index, prior transcripts, or the snapshot
 * system of record) without an admin credential. Deeper resets stay
 * admin-only via POST /api/admin/v2-reset, which is unchanged. See
 * run-course-reset.ts for exactly what each scope deletes.
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
  const scope = body.scope ?? 'session';
  const includeSnapshots = body.includeSnapshots === true;

  // Deeper resets are admin-only — refuse rather than silently downgrade or
  // pass through. This route never calls runCourseReset with anything but
  // scope:'session', includeSnapshots:false.
  if (scope !== 'session' || includeSnapshots) {
    return NextResponse.json({ error: 'Deeper resets are admin-only — use /api/admin/v2-reset' }, { status: 403 });
  }

  const result = await runCourseReset(courseCode, { scope: 'session', includeSnapshots: false });
  return NextResponse.json(result);
}
