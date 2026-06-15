import { NextResponse } from 'next/server';
import { authorizeCourseWrite } from '@/lib/sandbox/access';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { getSnapshotById, setSnapshotRetired } from '@/lib/db/capture-snapshots-queries';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ code: string; id: string }> }

// GET /api/capture/[code]/snapshots/[id]?slug=...
// Returns the full snapshot row including profile, inputs_meta, and transcript.
export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
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

  return NextResponse.json({ snapshot });
}

// PATCH /api/capture/[code]/snapshots/[id]?slug=...
// Body: { retired: boolean }
// Toggle the retired status of a snapshot (soft-delete / restore).
export async function PATCH(req: Request, { params }: RouteContext): Promise<Response> {
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

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  if (typeof body.retired !== 'boolean') {
    return NextResponse.json({ error: 'retired must be a boolean' }, { status: 400 });
  }

  const updated = await setSnapshotRetired(id, body.retired);
  if (!updated) return NextResponse.json({ error: 'no row updated' }, { status: 404 });
  return NextResponse.json({ ok: true, retired: body.retired });
}
