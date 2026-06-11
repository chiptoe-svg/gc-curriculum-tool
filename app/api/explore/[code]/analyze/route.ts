import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { getSnapshotById } from '@/lib/db/capture-snapshots-queries';
import { getTargetById, createAnalysis } from '@/lib/db/explore-queries';
import { compareSnapshotToTarget } from '@/lib/ai/analyze/explore-compare';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ code: string }> }

export const maxDuration = 60;

// POST /api/explore/[code]/analyze?slug=...
// Body: { snapshotId: string, targetId: string }
// Runs the comparator and persists the resulting analysis row.
export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  const cap = await checkDailyCap();
  if (!cap.ok) return NextResponse.json({ error: 'daily cost cap reached — service paused for today' }, { status: 503 });

  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);
  const course = await getCourseByCode(courseCode);
  if (!course) return NextResponse.json({ error: 'course not found' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const snapshotId = typeof body.snapshotId === 'string' ? body.snapshotId : '';
  const targetId = typeof body.targetId === 'string' ? body.targetId : '';
  if (!snapshotId || !targetId) {
    return NextResponse.json({ error: 'snapshotId and targetId are required' }, { status: 400 });
  }

  const snapshot = await getSnapshotById(snapshotId);
  if (!snapshot) return NextResponse.json({ error: 'snapshot not found' }, { status: 404 });
  if (snapshot.courseCode !== courseCode) {
    return NextResponse.json({ error: 'snapshot does not belong to this course' }, { status: 403 });
  }
  const target = await getTargetById(targetId);
  if (!target) return NextResponse.json({ error: 'target not found' }, { status: 404 });
  if (target.courseCode !== courseCode) {
    return NextResponse.json({ error: 'target does not belong to this course' }, { status: 403 });
  }

  try {
    const { analysis, model, costUsdCents } = await compareSnapshotToTarget({
      snapshotId,
      targetId,
      snapshotProfile: snapshot.profile,
      targetSpec: target.spec,
    });
    await recordSpend(costUsdCents);
    const row = await createAnalysis({
      courseCode,
      snapshotId,
      targetId,
      analysis,
      model,
    });
    return NextResponse.json({ analysis: row });
  } catch (err) {
    console.error('explore analyze failed', err);
    return NextResponse.json(
      { error: 'analysis failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
