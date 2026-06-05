import { NextResponse } from 'next/server';
import { findPartnerByToken } from '@/lib/partners/queries';
import { getPositionCaptureById } from '@/lib/db/position-capture-queries';
import { generateRatedItems } from '@/lib/ai/position-capture/rated-items';
import { getTargetById } from '@/lib/db/career-targets-queries';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import { hashIp } from '@/lib/ip-hash';

export const maxDuration = 60;

interface RouteContext { params: Promise<{ token: string; id: string }> }

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
  if (existing.status !== 'draft') return NextResponse.json({ error: 'not editable' }, { status: 409 });
  if (!existing.positionTitle || !existing.structuredInputs) {
    return NextResponse.json({ error: 'fill in position title + Page 1 first' }, { status: 400 });
  }

  const target = await getTargetById(existing.careerTargetId);
  if (!target) return NextResponse.json({ error: 'career target not found' }, { status: 404 });

  try {
    const result = await generateRatedItems({
      positionTitle: existing.positionTitle,
      company: existing.company,
      targetContext: {
        name: target.name,
        description: target.shortDefinition ?? '',
        subCompetencies: target.subCompetencies.map(s => ({
          id: s.id,                       // A2 — the join key (REQUIRED by the Task 6 type)
          name: s.name,
          description: s.doDescriptor ?? '',
        })),
      },
      structuredInputs: existing.structuredInputs,
    });
    await recordSpend(result.costUsdCents);
    return NextResponse.json({
      items: result.items,
      telemetry: { model: result.model, costUsdCents: result.costUsdCents, durationMs: result.durationMs },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'generate failed';
    console.error('[generate-items]', msg);
    return NextResponse.json({ error: 'generate failed', detail: msg.slice(0, 300) }, { status: 500 });
  }
}
