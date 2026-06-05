// app/api/partners/[token]/positions/[id]/route.ts
import { NextResponse } from 'next/server';
import { findPartnerByToken } from '@/lib/partners/queries';
import {
  getPositionCaptureById,
  updatePositionDraft,
  finalizePosition,
} from '@/lib/db/position-capture-queries';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';
import { PositionProfile } from '@/lib/ai/position-capture/schema';

interface RouteContext { params: Promise<{ token: string; id: string }> }

export async function PATCH(req: Request, { params }: RouteContext): Promise<Response> {
  const { token, id } = await params;
  const partner = await findPartnerByToken(token);
  if (!partner || !partner.active) return NextResponse.json({ error: 'invalid token' }, { status: 401 });

  const { allowed } = await checkIpRateLimit(hashIp(req));
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const existing = await getPositionCaptureById(id);
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (existing.partnerId !== partner.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (existing.status !== 'draft') return NextResponse.json({ error: 'not editable' }, { status: 409 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  try {
    await updatePositionDraft({
      id,
      partnerId: partner.id,
      ...(typeof body.positionTitle === 'string' && { positionTitle: body.positionTitle }),
      ...(typeof body.structuredInputs === 'object' && body.structuredInputs !== null && { structuredInputs: body.structuredInputs as Record<string, unknown> }),
      ...(typeof body.ratedSkills === 'object' && body.ratedSkills !== null && { ratedSkills: body.ratedSkills as Parameters<typeof updatePositionDraft>[0]['ratedSkills'] }),
      ...(Array.isArray(body.sourceFiles) && { sourceFiles: body.sourceFiles as Parameters<typeof updatePositionDraft>[0]['sourceFiles'] }),
      ...(typeof body.completeness === 'string' && { completeness: body.completeness as Parameters<typeof updatePositionDraft>[0]['completeness'] }),
      ...(typeof body.sessionId === 'string' && { sessionId: body.sessionId }),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'update failed' }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const { token, id } = await params;
  const partner = await findPartnerByToken(token);
  if (!partner || !partner.active) return NextResponse.json({ error: 'invalid token' }, { status: 401 });

  const { allowed } = await checkIpRateLimit(hashIp(req));
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const existing = await getPositionCaptureById(id);
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (existing.partnerId !== partner.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (existing.status !== 'draft') return NextResponse.json({ error: 'not editable' }, { status: 409 });

  const body = await req.json().catch(() => ({})) as { completeness?: unknown; profile?: unknown; model?: unknown; sessionId?: unknown };
  const validCompleteness = ['title-only', 'structured', 'rated', 'interviewed'] as const;
  if (typeof body.completeness !== 'string' || !validCompleteness.includes(body.completeness as typeof validCompleteness[number])) {
    return NextResponse.json({ error: 'invalid completeness' }, { status: 400 });
  }
  const completeness = body.completeness as typeof validCompleteness[number];

  let validatedProfile: ReturnType<typeof PositionProfile.parse> | undefined;
  if (completeness === 'interviewed') {
    if (typeof body.model !== 'string' || typeof body.sessionId !== 'string') {
      return NextResponse.json({ error: 'model + sessionId required for interviewed' }, { status: 400 });
    }
    const parsed = PositionProfile.safeParse(body.profile);
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid profile', detail: parsed.error.message.slice(0, 300) }, { status: 400 });
    }
    validatedProfile = parsed.data;
  }

  try {
    await finalizePosition({
      id,
      partnerId: partner.id,
      completeness,
      ...(completeness === 'interviewed' && {
        profile: validatedProfile,
        model: body.model as string,
        sessionId: body.sessionId as string,
      }),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'finalize failed' }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
