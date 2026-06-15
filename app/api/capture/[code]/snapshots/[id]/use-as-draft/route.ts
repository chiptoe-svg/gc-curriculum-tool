import { NextResponse } from 'next/server';
import { authorizeCourseWrite } from '@/lib/sandbox/access';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { getSnapshotById, loadSnapshotAsDraft } from '@/lib/db/capture-snapshots-queries';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ code: string; id: string }> }

// POST /api/capture/[code]/snapshots/[id]/use-as-draft?slug=...
// Copies the snapshot's profile back into the working draft for its course.
// The transcript is NOT loaded into chat; only the structured profile.
// Caller is responsible for clearing the conversation if they want a clean
// chat surface — see DELETE /api/capture/[code]/conversation.
export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  const { code: rawCode, id } = await params;
  const courseCode = decodeURIComponent(rawCode);
  if (!(await authorizeCourseWrite(req, courseCode, slug))) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });


  const course = await getCourseByCode(courseCode);
  if (!course) return NextResponse.json({ error: 'course not found' }, { status: 404 });

  const snapshot = await getSnapshotById(id);
  if (!snapshot) return NextResponse.json({ error: 'snapshot not found' }, { status: 404 });
  if (snapshot.courseCode !== courseCode) {
    return NextResponse.json({ error: 'snapshot does not belong to this course' }, { status: 403 });
  }

  const ok = await loadSnapshotAsDraft(id);
  if (!ok) return NextResponse.json({ error: 'failed to load snapshot as draft' }, { status: 500 });

  return NextResponse.json({ ok: true });
}
