import { NextResponse } from 'next/server';
import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { createPartner, findPartnerByEmail, magicLinkUrl, logPartnerEvent } from '@/lib/partners/queries';

// POST /api/admin/partners/create — add a single partner from the admin UI's
// "Add partner" form (the seamless alternative to a CSV import for one-offs).
// Slug-gated behind faculty Basic Auth, mirroring the CSV import route.
export async function POST(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  if (!checkAdminAuth(req, { slug: typeof body.slug === 'string' ? body.slug : '' })) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const email = (typeof body.email === 'string' ? body.email : '').trim().toLowerCase();
  const firstName = (typeof body.firstName === 'string' ? body.firstName : '').trim();
  const lastName = (typeof body.lastName === 'string' ? body.lastName : '').trim();
  const company = (typeof body.company === 'string' ? body.company : '').trim();
  if (!email || !firstName || !company) {
    return NextResponse.json({ error: 'email, firstName, and company are required' }, { status: 400 });
  }

  const existing = await findPartnerByEmail(email);
  if (existing) {
    return NextResponse.json({ error: 'a partner with that email already exists' }, { status: 409 });
  }

  const roleTitle = typeof body.roleTitle === 'string' && body.roleTitle.trim() ? body.roleTitle.trim() : null;
  const weight = typeof body.weight === 'number' && Number.isFinite(body.weight) ? body.weight : 1;
  const careerTargetHints = Array.isArray(body.careerTargetHints)
    ? body.careerTargetHints.filter((h): h is string => typeof h === 'string' && h.trim().length > 0).map(h => h.trim())
    : [];

  const created = await createPartner({ email, firstName, lastName, company, roleTitle, weight, careerTargetHints });
  await logPartnerEvent(created.id, 'admin_added_partner', { email });

  return NextResponse.json({ id: created.id, magicLinkUrl: magicLinkUrl(created) });
}
