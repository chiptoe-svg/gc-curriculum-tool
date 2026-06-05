// app/api/partners/[token]/positions/route.ts
import { NextResponse } from 'next/server';
import { findPartnerByToken } from '@/lib/partners/queries';
import { createPositionDraft, listPositionsByPartner } from '@/lib/db/position-capture-queries';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ token: string }> }

export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const { token } = await params;
  const partner = await findPartnerByToken(token);
  if (!partner || !partner.active) return NextResponse.json({ error: 'invalid token' }, { status: 401 });

  const { allowed } = await checkIpRateLimit(hashIp(req));
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const body = await req.json().catch(() => ({})) as { careerTargetId?: unknown; supersedes?: unknown };
  if (typeof body.careerTargetId !== 'string' || body.careerTargetId.length === 0) {
    return NextResponse.json({ error: 'careerTargetId required' }, { status: 400 });
  }
  const supersedes = typeof body.supersedes === 'string' && body.supersedes.length > 0 ? body.supersedes : null;

  const draft = await createPositionDraft({
    partnerId: partner.id,
    careerTargetId: body.careerTargetId,
    company: partner.company,
    supersedes,
  });

  return NextResponse.json({ id: draft.id, status: 'draft', careerTargetId: body.careerTargetId });
}

export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  const { token } = await params;
  const partner = await findPartnerByToken(token);
  if (!partner || !partner.active) return NextResponse.json({ error: 'invalid token' }, { status: 401 });

  const { allowed } = await checkIpRateLimit(hashIp(req));
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const positions = await listPositionsByPartner(partner.id);
  return NextResponse.json({
    positions: positions.map(p => ({
      id: p.id,
      status: p.status,
      careerTargetId: p.careerTargetId,
      positionTitle: p.positionTitle,
      completeness: p.completeness,
      createdAt: p.createdAt.toISOString(),
      submittedAt: p.submittedAt?.toISOString() ?? null,
    })),
  });
}
