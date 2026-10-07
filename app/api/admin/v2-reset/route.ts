import { NextResponse } from 'next/server';
import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { runCourseReset, type ResetScope } from '@/lib/capture/run-course-reset';

/**
 * POST /api/admin/v2-reset
 * Body: {
 *   courseCode: string,
 *   scope?: 'session' | 'materials' | 'everything',  // default 'session'
 *   includeSnapshots?: boolean,
 * }
 *
 * Operator/CLI entry point — any course, any scope. Delegates to
 * lib/capture/run-course-reset.ts (see that file's docstring for exactly
 * what each scope deletes), the same logic the course-scoped
 * POST /api/capture/[code]/reset route uses (added 2026-10-07 so a scoped
 * faculty access-link holder can trigger a 'session'-scope reset for their
 * own course without an admin credential — see docs/STATE.md). The
 * course-scoped route does NOT expose 'everything' or includeSnapshots any
 * differently than this one does; both call the same function with the
 * same semantics.
 *
 * Gated by /api/admin/* middleware (FACULTY_BASIC_AUTH) + checkAdminAuth —
 * this is a one-request, irrecoverable data-loss endpoint (scope='everything'
 * or includeSnapshots=true can delete the system of record), so the slug
 * second factor matters.
 */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as {
    courseCode?: unknown;
    scope?: unknown;
    includeSnapshots?: unknown;
    slug?: unknown;
  };
  if (!checkAdminAuth(req, { slug: typeof body.slug === 'string' ? body.slug : '' })) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }
  const courseCode = typeof body.courseCode === 'string' ? body.courseCode.trim() : '';
  if (!courseCode) {
    return NextResponse.json({ error: 'courseCode required' }, { status: 400 });
  }
  const scope: ResetScope =
    body.scope === 'materials' ? 'materials'
      : body.scope === 'everything' ? 'everything'
      : 'session';
  const includeSnapshots = body.includeSnapshots === true;

  const result = await runCourseReset(courseCode, { scope, includeSnapshots });
  return NextResponse.json(result);
}
