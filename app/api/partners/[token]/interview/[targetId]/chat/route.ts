import { NextResponse } from 'next/server';
import { resolvePartner } from '@/lib/partners/auth';
// Plan named this `getCareerTargetById`; actual export is `getTargetById`.
// It returns a full CareerTarget (with embedded subCompetencies) so no
// separate sub-competency query is needed.
import { getTargetById } from '@/lib/db/career-targets-queries';
import { runEmployerInterview } from '@/lib/ai/employer-capture/run';
import { getLatestEmployerSessionId, startEmployerSession } from '@/lib/db/employer-capture-queries';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap } from '@/lib/rate-limit/daily-cap';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ token: string; targetId: string }> }

/**
 * POST /api/partners/[token]/interview/[targetId]/chat
 * Body: { userMessage?: string, sessionId?: string }
 * Returns: { sessionId, response, telemetry }
 *
 * Partner-authenticated via the magic-link token. One turn of an
 * employer interview anchored to one career target.
 */
export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const { token, targetId } = await params;

  // Auth via existing partner session resolver (token from URL path param)
  const partner = await resolvePartner(req, token);
  if (!partner) return NextResponse.json({ error: 'invalid token' }, { status: 401 });

  // Rate-limit + cost cap (same pattern as capture chat route)
  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded (ip)' }, { status: 429 });
  const dailyOk = await checkDailyCap();
  if (!dailyOk.ok) return NextResponse.json({ error: 'daily cost cap reached' }, { status: 429 });

  // Resolve the target (includes sub-competencies inline via getTargetById)
  // Plan named this getCareerTargetById; actual export is getTargetById.
  // No separate listSubCompetenciesByTarget call is needed.
  const target = await getTargetById(targetId);
  if (!target) return NextResponse.json({ error: 'career target not found' }, { status: 404 });

  // Parse body
  const body = await req.json().catch(() => ({})) as { userMessage?: unknown; sessionId?: unknown };
  const userMessage = typeof body.userMessage === 'string' && body.userMessage.trim().length > 0
    ? body.userMessage.trim() : undefined;
  let sessionId = typeof body.sessionId === 'string' && body.sessionId.length > 0
    ? body.sessionId : null;

  if (!sessionId) {
    // No session passed; check if there's an open one for this (partner, target)
    sessionId = await getLatestEmployerSessionId(partner.id, targetId);
    if (!sessionId) sessionId = startEmployerSession();
  }

  try {
    const result = await runEmployerInterview({
      partnerId: partner.id,
      careerTargetId: targetId,
      sessionId,
      userMessage,
      targetContext: {
        id: target.id,
        name: target.name,
        // CareerTarget has shortDefinition, not description; plan used description.
        // shortDefinition is the canonical summary field for the target.
        description: target.shortDefinition ?? '',
        // CareerTarget.SubCompetency has per-KUD descriptor fields, not a single
        // description field. Synthesise one from the doDescriptor (primary
        // behavioral output) so the LLM has a concise per-sub-comp summary.
        subCompetencies: target.subCompetencies.map(s => ({
          id: s.id,
          name: s.name,
          description: s.doDescriptor ?? '',
        })),
      },
    });

    return NextResponse.json({
      sessionId,
      response: result.response,
      telemetry: {
        costUsdCents: result.costUsdCents,
        durationMs: result.durationMs,
        model: result.model,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`POST /api/partners/[token]/interview/${targetId}/chat failed:`, message);
    return NextResponse.json({ error: 'interview turn failed', detail: message.slice(0, 300) }, { status: 500 });
  }
}
