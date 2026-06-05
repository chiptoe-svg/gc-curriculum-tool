import { NextResponse } from 'next/server';
import { findPartnerByToken } from '@/lib/partners/queries';
import { getPositionCaptureById, startPositionSession, isPositionSessionOwnedBy, getPositionSession } from '@/lib/db/position-capture-queries';
import { runPositionInterview, generatePositionProfile } from '@/lib/ai/position-capture/run';
import { getTargetById } from '@/lib/db/career-targets-queries';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import { hashIp } from '@/lib/ip-hash';

export const maxDuration = 60;

interface RouteContext { params: Promise<{ token: string; id: string }> }

/**
 * GET /api/partners/[token]/positions/[id]/chat?sessionId=<sid>
 * Loads the stored transcript for an existing session so Page6Section
 * can rehydrate after a remount / refresh.
 */
export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  const { token, id } = await params;
  const partner = await findPartnerByToken(token);
  if (!partner || !partner.active) return NextResponse.json({ error: 'invalid token' }, { status: 401 });

  const existing = await getPositionCaptureById(id);
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (existing.partnerId !== partner.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 });

  if (!await isPositionSessionOwnedBy(sessionId, partner.id, id)) {
    return NextResponse.json({ error: 'invalid session' }, { status: 403 });
  }

  const rows = await getPositionSession(id, sessionId);
  return NextResponse.json({
    messages: rows.map(r => ({ role: r.role, content: r.content, turnIndex: r.turnIndex })),
  });
}

/**
 * POST /api/partners/[token]/positions/[id]/chat
 * Body: { userMessage?: string, sessionId?: string, finalize?: true }
 *
 * If finalize=true, runs synthesis instead of a turn — caller must
 * supply sessionId. Returns { profile, model, sessionId } on finalize;
 * { response, sessionId, telemetry } on turn.
 */
export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const { token, id } = await params;
  const partner = await findPartnerByToken(token);
  if (!partner || !partner.active) return NextResponse.json({ error: 'invalid token' }, { status: 401 });

  const { allowed } = await checkIpRateLimit(hashIp(req));
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  const dailyOk = await checkDailyCap();
  if (!dailyOk.ok) return NextResponse.json({ error: 'daily cost cap reached' }, { status: 429 });

  const existing = await getPositionCaptureById(id);
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (existing.partnerId !== partner.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const target = await getTargetById(existing.careerTargetId);
  if (!target) return NextResponse.json({ error: 'career target not found' }, { status: 404 });

  const bundle = {
    positionTitle: existing.positionTitle ?? '(untitled)',
    company: existing.company,
    targetContext: {
      id: target.id,
      name: target.name,
      description: target.shortDefinition ?? '',
      subCompetencies: target.subCompetencies.map(s => ({ id: s.id, name: s.name, description: s.doDescriptor ?? '' })),
    },
    structuredInputs: existing.structuredInputs ?? null,
    ratedSkills: existing.ratedSkills ?? null,
  };

  const body = await req.json().catch(() => ({})) as { userMessage?: unknown; sessionId?: unknown; finalize?: unknown };

  if (body.finalize === true) {
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null;
    if (!sessionId) return NextResponse.json({ error: 'sessionId required for finalize' }, { status: 400 });
    if (!await isPositionSessionOwnedBy(sessionId, partner.id, id)) {
      return NextResponse.json({ error: 'invalid session' }, { status: 403 });
    }
    try {
      const result = await generatePositionProfile({
        ...bundle,
        partnerId: partner.id,
        positionCaptureId: id,
        sessionId,
      });
      await recordSpend(result.costUsdCents);
      return NextResponse.json({
        profile: result.profile,
        model: result.model,
        sessionId,
        telemetry: { costUsdCents: result.costUsdCents, durationMs: result.durationMs },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'synthesis failed';
      console.error('[chat finalize]', msg);
      return NextResponse.json({ error: 'synthesis failed', detail: msg.slice(0, 300) }, { status: 500 });
    }
  }

  // Turn path
  const userMessage = typeof body.userMessage === 'string' && body.userMessage.trim().length > 0 ? body.userMessage.trim() : undefined;
  let sessionId = typeof body.sessionId === 'string' && body.sessionId.length > 0 ? body.sessionId : null;

  if (sessionId) {
    if (!await isPositionSessionOwnedBy(sessionId, partner.id, id)) {
      return NextResponse.json({ error: 'invalid session' }, { status: 403 });
    }
  } else {
    sessionId = startPositionSession();
  }

  try {
    const result = await runPositionInterview({
      ...bundle,
      partnerId: partner.id,
      positionCaptureId: id,
      sessionId,
      userMessage,
    });
    await recordSpend(result.costUsdCents);
    return NextResponse.json({
      sessionId,
      response: result.response,
      telemetry: { costUsdCents: result.costUsdCents, durationMs: result.durationMs, model: result.model },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'turn failed';
    console.error('[chat turn]', msg);
    return NextResponse.json({ error: 'turn failed', detail: msg.slice(0, 300) }, { status: 500 });
  }
}
