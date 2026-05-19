import { NextResponse } from 'next/server';
import { resolvePartner } from '@/lib/partners/auth';
import { bumpLastActive } from '@/lib/partners/queries';
import { getPartnerStats } from '@/lib/partners/stats';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  const partner = await resolvePartner(req, token);
  if (!partner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  await bumpLastActive(partner.id);
  const stats = await getPartnerStats(partner.id);

  return NextResponse.json({
    partner: {
      id: partner.id,
      firstName: partner.firstName,
      lastName: partner.lastName,
      company: partner.company,
      email: partner.email,
    },
    stats,
  });
}
