import { NextResponse } from 'next/server';
import { authorizeCourseWrite } from '@/lib/sandbox/access';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';
import { runCourseIngest, type IngestMode } from '@/lib/capture/run-course-ingest';

interface RouteContext { params: Promise<{ code: string }> }

/**
 * POST /api/capture/[code]/ingest?slug=...
 * Body: { mode?: 'hybrid' | 'local' }
 *
 * Course-scoped twin of POST /api/admin/v2-backfill — same underlying work
 * (lib/capture/run-course-ingest.ts), but classified 'course-write' by
 * lib/auth/authorize.ts so a scoped access-link holder (capture capability,
 * scope = this course) can trigger it, not just an admin/operator credential.
 * The course code comes from the PATH; a body `courseCode` that disagrees is
 * rejected rather than silently followed.
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

  const body = await req.json().catch(() => ({})) as { courseCode?: unknown; mode?: unknown };
  if (typeof body.courseCode === 'string' && body.courseCode.trim() && body.courseCode.trim() !== courseCode) {
    return NextResponse.json({ error: 'courseCode does not match the path' }, { status: 400 });
  }
  const mode: IngestMode = body.mode === undefined ? 'hybrid' : (body.mode as IngestMode);
  if (mode !== 'hybrid' && mode !== 'local') {
    return NextResponse.json({ error: "mode must be 'hybrid' or 'local'" }, { status: 400 });
  }

  const result = await runCourseIngest(courseCode, { mode });
  if (!result) return NextResponse.json({ error: 'course not found' }, { status: 404 });
  return NextResponse.json(result);
}
