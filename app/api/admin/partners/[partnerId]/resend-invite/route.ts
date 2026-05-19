import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { findPartnerById, markInvited, logPartnerEvent } from '@/lib/partners/queries';
import { sendPartnerInvite } from '@/lib/email/send-partner-invite';

interface RouteContext {
  params: Promise<{ partnerId: string }>;
}

export async function POST(req: Request, { params }: RouteContext) {
  const body = await req.json().catch(() => ({}));
  if (!isValidSlug(typeof body.slug === 'string' ? body.slug : '')) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }
  const { partnerId } = await params;
  const partner = await findPartnerById(partnerId);
  if (!partner) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (!partner.active) return NextResponse.json({ error: 'partner is deactivated' }, { status: 409 });

  await sendPartnerInvite({
    firstName: partner.firstName,
    email: partner.email,
    token: partner.magicToken,
  });
  await markInvited(partner.id);
  await logPartnerEvent(partner.id, 'admin_resent_invite', { at: new Date().toISOString() });

  return NextResponse.json({ ok: true });
}
