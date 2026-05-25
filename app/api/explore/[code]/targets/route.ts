import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { listTargetsByCourse, createTarget } from '@/lib/db/explore-queries';
import { targetSpecSchema } from '@/lib/ai/explore/schema';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ code: string }> }

// GET /api/explore/[code]/targets?slug=...&includeRetired=true
export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);
  const course = await getCourseByCode(courseCode);
  if (!course) return NextResponse.json({ error: 'course not found' }, { status: 404 });

  const includeRetired = url.searchParams.get('includeRetired') === 'true';
  const targets = await listTargetsByCourse(courseCode, includeRetired);
  return NextResponse.json({ targets });
}

// POST /api/explore/[code]/targets?slug=...
// Body: { kind, spec, caption?, proseInput?, authoredAgainstSnapshotId? }
// Persists a new target. The spec is validated against the discriminated union.
export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);
  const course = await getCourseByCode(courseCode);
  if (!course) return NextResponse.json({ error: 'course not found' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const specParse = targetSpecSchema.safeParse(body.spec);
  if (!specParse.success) {
    return NextResponse.json(
      { error: 'invalid target spec', detail: specParse.error.message },
      { status: 400 },
    );
  }
  const caption = typeof body.caption === 'string' && body.caption.trim() ? body.caption.trim() : null;
  const proseInput = typeof body.proseInput === 'string' && body.proseInput.trim() ? body.proseInput.trim() : null;
  const authoredAgainstSnapshotId = typeof body.authoredAgainstSnapshotId === 'string' ? body.authoredAgainstSnapshotId : null;

  const target = await createTarget({
    courseCode,
    kind: specParse.data.kind,
    spec: specParse.data,
    caption,
    proseInput,
    authoredAgainstSnapshotId,
  });
  return NextResponse.json({ target });
}
