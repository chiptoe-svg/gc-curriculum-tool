import { NextResponse } from 'next/server';
import { resolvePartner } from '@/lib/partners/auth';
import { getTargetById } from '@/lib/db/career-targets-queries';
import { generateCareerCaptureProfile } from '@/lib/ai/employer-capture/run';
import { getLatestEmployerSessionId, createCareerCapture } from '@/lib/db/employer-capture-queries';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap } from '@/lib/rate-limit/daily-cap';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ token: string; targetId: string }> }

/**
 * POST /api/partners/[token]/interview/[targetId]/generate
 * Body: {}
 * Returns: { captureId, createdAt, profile, telemetry }
 *
 * Runs synthesis over the latest interview session for this (partner,
 * target), persists the result as a new career_captures row, returns
 * the new row.
 */
export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const { token, targetId } = await params;

  const partner = await resolvePartner(req, token);
  if (!partner) return NextResponse.json({ error: 'invalid token' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded (ip)' }, { status: 429 });
  const dailyOk = await checkDailyCap();
  if (!dailyOk.ok) return NextResponse.json({ error: 'daily cost cap reached' }, { status: 429 });

  const target = await getTargetById(targetId);
  if (!target) return NextResponse.json({ error: 'career target not found' }, { status: 404 });

  const sessionId = await getLatestEmployerSessionId(partner.id, targetId);
  if (!sessionId) {
    return NextResponse.json({ error: 'no interview session to synthesize — start an interview first' }, { status: 400 });
  }

  try {
    const result = await generateCareerCaptureProfile({
      partnerId: partner.id,
      careerTargetId: targetId,
      sessionId,
      targetContext: {
        id: target.id,
        name: target.name,
        description: target.shortDefinition,
        subCompetencies: target.subCompetencies.map(s => ({
          id: s.id,
          name: s.name,
          description: s.doDescriptor,
        })),
      },
    });

    const created = await createCareerCapture({
      partnerId: partner.id,
      careerTargetId: targetId,
      sessionId,
      profile: result.profile,
      model: result.model,
    });

    return NextResponse.json({
      captureId: created.id,
      createdAt: created.createdAt.toISOString(),
      profile: result.profile,
      telemetry: { costUsdCents: result.costUsdCents, durationMs: result.durationMs, model: result.model },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`POST /api/partners/[token]/interview/${targetId}/generate failed:`, message);
    return NextResponse.json({ error: 'synthesis failed', detail: message.slice(0, 500) }, { status: 500 });
  }
}
