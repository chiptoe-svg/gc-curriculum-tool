import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { ilike } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courses } from '@/lib/db/schema';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { getLatestSnapshotByCourse } from '@/lib/db/capture-snapshots-queries';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ code: string }> }

// GET /api/explore/[code]/downstream-candidates?slug=...
// Reverse-lookup: which courses list this course's code in their
// `prerequisites` text? Each candidate carries a flag indicating whether
// it has a usable snapshot for downstream comparison.
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

  // Substring match on the prerequisites text. Crude but reliable: prereqs
  // are stored as freeform strings ("GC 1040 or GC 1020"), so we look for
  // any course whose prerequisites field contains this course's code.
  const candidates = await db
    .select({
      code: courses.code,
      title: courses.title,
      level: courses.level,
      prerequisites: courses.prerequisites,
    })
    .from(courses)
    .where(ilike(courses.prerequisites, `%${courseCode}%`));

  // For each candidate, check whether a non-retired snapshot exists.
  const enriched = await Promise.all(
    candidates
      .filter(c => c.code !== courseCode)
      .map(async c => {
        const snap = await getLatestSnapshotByCourse(c.code);
        return {
          code: c.code,
          title: c.title,
          level: c.level,
          prerequisites: c.prerequisites,
          hasSnapshot: snap !== null,
          snapshotId: snap?.id ?? null,
          snapshotCaption: snap?.caption ?? null,
          snapshotCreatedAt: snap?.createdAt ?? null,
          // Disable downstream comparison when the snapshot lacks the
          // incoming_expectations field (legacy profiles produced before
          // the v1 completion shipped).
          hasIncomingExpectations: snap !== null && Array.isArray(snap.profile?.incoming_expectations),
        };
      }),
  );

  return NextResponse.json({ candidates: enriched });
}
