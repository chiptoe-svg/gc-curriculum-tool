import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { getSnapshotById, getLatestSnapshotByCourse } from '@/lib/db/capture-snapshots-queries';
import { draftCustomTarget } from '@/lib/ai/analyze/explore-draft-target';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ code: string }> }

// POST /api/explore/[code]/draft-custom?slug=...
// Body: { prose: string, snapshotId?: string }
// Returns an AI-drafted custom TargetSpec WITHOUT persisting it. The
// instructor reviews/edits before calling POST /targets to save.
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
  const prose = typeof body.prose === 'string' ? body.prose : '';
  if (!prose.trim()) return NextResponse.json({ error: 'prose is required' }, { status: 400 });

  const snapshot = typeof body.snapshotId === 'string'
    ? await getSnapshotById(body.snapshotId)
    : await getLatestSnapshotByCourse(courseCode);
  if (!snapshot) {
    return NextResponse.json(
      { error: 'no snapshot available — capture and snapshot the course before exploring' },
      { status: 400 },
    );
  }
  if (snapshot.courseCode !== courseCode) {
    return NextResponse.json({ error: 'snapshot does not belong to this course' }, { status: 403 });
  }

  const cap = await checkDailyCap();
  if (!cap.ok) return NextResponse.json({ error: 'daily cost cap reached — service paused for today' }, { status: 503 });

  try {
    const { target, model, costUsdCents } = await draftCustomTarget({
      prose,
      snapshotProfile: snapshot.profile,
    });
    await recordSpend(costUsdCents);
    return NextResponse.json({
      target,
      snapshotId: snapshot.id,
      proseInput: prose,
      model,
    });
  } catch (err) {
    console.error('draft-custom failed', err);
    return NextResponse.json(
      { error: 'draft failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
