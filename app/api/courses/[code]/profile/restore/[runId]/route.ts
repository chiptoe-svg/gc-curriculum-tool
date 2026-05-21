import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getRunById, upsertCourseProfile } from '@/lib/db/course-profile-queries';
import type { CourseProfileResult } from '@/lib/ai/course-profile/schema';

interface Ctx {
  params: Promise<{ code: string; runId: string }>;
}

export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const { code: rawCode, runId } = await params;
  const courseCode = decodeURIComponent(rawCode);

  const run = await getRunById(runId);
  if (!run) {
    return NextResponse.json({ error: 'run not found' }, { status: 404 });
  }

  if (run.courseCode !== courseCode) {
    return NextResponse.json({ error: 'run does not belong to this course' }, { status: 403 });
  }

  try {
    await upsertCourseProfile({
      courseCode,
      result: run.result as CourseProfileResult,
      runId: run.id,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`POST restore failed for ${courseCode}/${runId}`, err);
    return NextResponse.json({ error: 'internal server error' }, { status: 500 });
  }
}
