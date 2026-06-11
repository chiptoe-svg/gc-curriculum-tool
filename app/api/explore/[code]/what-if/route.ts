import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { getSnapshotById } from '@/lib/db/capture-snapshots-queries';
import { getTargetById, getAnalysisById, createWhatIf, listWhatIfsByTarget } from '@/lib/db/explore-queries';
import { simulateWhatIf } from '@/lib/ai/analyze/explore-what-if';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ code: string }> }

export const maxDuration = 60;

// POST /api/explore/[code]/what-if?slug=...
// Body: { snapshotId, targetId, changeProse, analysisId? }
// Simulates the effect of a proposed change against (snapshot, target).
// Optionally pulls a prior analysis to anchor the before-state.
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
  const snapshotId = typeof body.snapshotId === 'string' ? body.snapshotId : '';
  const targetId = typeof body.targetId === 'string' ? body.targetId : '';
  const changeProse = typeof body.changeProse === 'string' ? body.changeProse : '';
  const analysisId = typeof body.analysisId === 'string' ? body.analysisId : null;

  if (!snapshotId || !targetId || !changeProse.trim()) {
    return NextResponse.json({ error: 'snapshotId, targetId, and changeProse are required' }, { status: 400 });
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

  let priorAnalysis = null;
  if (analysisId) {
    const a = await getAnalysisById(analysisId);
    if (a && a.courseCode === courseCode) priorAnalysis = a.analysis;
  }

  const cap = await checkDailyCap();
  if (!cap.ok) return NextResponse.json({ error: 'daily cost cap reached — service paused for today' }, { status: 503 });

  try {
    const { result, model, costUsdCents } = await simulateWhatIf({
      snapshotId,
      targetId,
      snapshotProfile: snapshot.profile,
      targetSpec: target.spec,
      priorAnalysis,
      changeProse,
    });
    await recordSpend(costUsdCents);
    const row = await createWhatIf({
      courseCode,
      snapshotId,
      targetId,
      analysisId,
      changeProse,
      result,
      model,
    });
    return NextResponse.json({ whatIf: row });
  } catch (err) {
    console.error('explore what-if failed', err);
    return NextResponse.json(
      { error: 'simulation failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// GET /api/explore/[code]/what-if?slug=...&targetId=...
// Returns saved what-ifs for a target.
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

  const targetId = url.searchParams.get('targetId');
  if (!targetId) return NextResponse.json({ error: 'targetId is required' }, { status: 400 });

  const whatIfs = await listWhatIfsByTarget(targetId);
  return NextResponse.json({ whatIfs: whatIfs.filter(w => w.courseCode === courseCode) });
}
