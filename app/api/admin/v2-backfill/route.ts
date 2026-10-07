import { NextResponse } from 'next/server';
import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { runCourseIngest, type IngestMode } from '@/lib/capture/run-course-ingest';

/**
 * POST /api/admin/v2-backfill
 * Body: { courseCode: string, mode?: 'hybrid' | 'local' }
 *
 * Operator/CLI entry point — any course, no scope restriction. Delegates to
 * lib/capture/run-course-ingest.ts, the same logic the course-scoped
 * POST /api/capture/[code]/ingest route uses (added 2026-10-07 so a scoped
 * faculty access-link holder can trigger ingestion for their own course
 * without an admin credential — see docs/STATE.md).
 *
 * Requires COURSECAPTURE_V2_INGESTION=1 to do anything useful — when the
 * flag is off, finalizeExtraction runs the legacy compression path and
 * indexing_status is never set to 'ready'. The route still succeeds.
 *
 * Gated by /api/admin/* middleware (FACULTY_BASIC_AUTH) + checkAdminAuth.
 */
export async function POST(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({})) as { courseCode?: unknown; slug?: unknown; mode?: unknown };
  if (!checkAdminAuth(req, { slug: typeof body.slug === 'string' ? body.slug : '' })) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }
  const courseCode = typeof body.courseCode === 'string' ? body.courseCode.trim() : '';
  if (!courseCode) {
    return NextResponse.json({ error: 'courseCode required' }, { status: 400 });
  }
  const mode: IngestMode = body.mode === undefined ? 'hybrid' : (body.mode as IngestMode);
  if (mode !== 'hybrid' && mode !== 'local') {
    return NextResponse.json({ error: "mode must be 'hybrid' or 'local'" }, { status: 400 });
  }

  const result = await runCourseIngest(courseCode, { mode });
  if (!result) return NextResponse.json({ error: 'course not found' }, { status: 404 });
  return NextResponse.json(result);
}
