import { NextResponse } from 'next/server';
import { authorizeCourseWrite } from '@/lib/sandbox/access';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import { reconcileFeedback } from '@/lib/ai/analyze/reconcile-feedback';
import type { ReconcileSection } from '@/lib/ai/schemas';

interface RouteContext { params: Promise<{ code: string }>; }

export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);
  if (!(await authorizeCourseWrite(req, courseCode, slug))) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const section = body.section as ReconcileSection;
  const feedback = typeof body.feedback === 'string' ? body.feedback.trim() : '';
  const items = Array.isArray(body.items) ? body.items : [];
  // Validate inputs before touching the rate-limit DB so malformed requests
  // don't consume a cap read.
  if (!['apparent_outcomes', 'incoming', 'outgoing'].includes(section)) {
    return NextResponse.json({ error: 'invalid section' }, { status: 400 });
  }
  if (!feedback) return NextResponse.json({ error: 'feedback is required' }, { status: 400 });

  const dailyOk = await checkDailyCap();
  if (!dailyOk.ok) return NextResponse.json({ error: 'daily cost cap reached' }, { status: 429 });

  try {
    const out = await reconcileFeedback({ section, items, feedback, courseContext: { code: courseCode } });
    await recordSpend(out.costUsdCents);
    return NextResponse.json({ proposals: out.proposals, telemetry: { costUsdCents: out.costUsdCents, model: out.model } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'reconcile failed';
    console.error(`POST /api/capture/${courseCode}/reconcile failed:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
