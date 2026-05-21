import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseKud, acceptCourseKud } from '@/lib/db/course-kud-queries';
import { updateBuilderStatus } from '@/lib/db/courses-queries';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ code: string }> }

export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);

  const existing = await getCourseKud(courseCode);
  if (!existing) return NextResponse.json({ error: 'no KUD record — generate KUDs first' }, { status: 404 });

  const ipHash = hashIp(req);
  const now = new Date();

  try {
    await acceptCourseKud(courseCode, now, ipHash);
    await updateBuilderStatus(courseCode, 'approved');
    return NextResponse.json({ ok: true, approvedAt: now.toISOString() });
  } catch (err) {
    console.error(`POST /api/courses/${courseCode}/kuds/accept failed`, err);
    return NextResponse.json({ error: 'internal server error' }, { status: 500 });
  }
}
