import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { getLatestSnapshotByCourse } from '@/lib/db/capture-snapshots-queries';
import { downstreamTargetSpecSchema, type DownstreamTargetSpec } from '@/lib/ai/explore/schema';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ code: string }> }

// POST /api/explore/[code]/build-downstream?slug=...
// Body: { downstreamCodes: string[] }
// Returns a constructed downstream TargetSpec — the union of each
// downstream course's latest-snapshot incoming_expectations. Does NOT
// persist; caller saves via POST /targets.
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
  if (!Array.isArray(body.downstreamCodes) || body.downstreamCodes.length === 0) {
    return NextResponse.json({ error: 'downstreamCodes must be a non-empty array' }, { status: 400 });
  }

  const downstreamCodes = (body.downstreamCodes as unknown[])
    .filter((c): c is string => typeof c === 'string')
    .map(c => c.trim())
    .filter(Boolean);

  const courseEntries: Array<{
    code: string;
    title: string;
    snapshot_id: string;
    incoming_expectations: NonNullable<DownstreamTargetSpec['courses'][0]['incoming_expectations']>;
  }> = [];

  const skipped: Array<{ code: string; reason: string }> = [];

  for (const code of downstreamCodes) {
    const c = await getCourseByCode(code);
    if (!c) { skipped.push({ code, reason: 'course not found' }); continue; }
    const snap = await getLatestSnapshotByCourse(code);
    if (!snap) { skipped.push({ code, reason: 'no snapshot' }); continue; }
    const ie = snap.profile.incoming_expectations;
    if (!Array.isArray(ie)) {
      skipped.push({ code, reason: 'snapshot lacks incoming_expectations — re-run CourseCapture' });
      continue;
    }
    courseEntries.push({
      code: c.code,
      title: c.title,
      snapshot_id: snap.id,
      incoming_expectations: ie,
    });
  }

  if (courseEntries.length === 0) {
    return NextResponse.json(
      { error: 'no usable downstream courses', skipped },
      { status: 400 },
    );
  }

  const spec: DownstreamTargetSpec = {
    kind: 'downstream',
    courses: courseEntries,
  };

  // Sanity-check against the schema before returning.
  const parsed = downstreamTargetSpecSchema.safeParse(spec);
  if (!parsed.success) {
    return NextResponse.json({ error: 'constructed spec failed validation', detail: parsed.error.message }, { status: 500 });
  }

  return NextResponse.json({ target: parsed.data, skipped });
}
