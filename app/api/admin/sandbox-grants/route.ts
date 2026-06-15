import { NextResponse } from 'next/server';
import { createGrant, listGrants, revokeGrant } from '@/lib/sandbox/grants';
import { checkAdminAuth } from '@/lib/auth/admin-auth';

// Auth: two factors, like every /api/admin/* route. (1) middleware HTTP Basic
// Auth (FACULTY_BASIC_AUTH) is the primary gate; (2) checkAdminAuth is the
// in-route second factor (Authorization: Bearer ADMIN_TOKEN or slug) that
// tests/api/admin-routes-gated.test.ts asserts every admin route enforces.
// The minted token is the shareable secret; it's returned only to the
// authenticated operator who needs the link (mirrors partners.magicToken).

export async function POST(req: Request): Promise<Response> {
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { courseCode?: string; label?: string };
  if (!body.courseCode) return NextResponse.json({ error: 'courseCode required' }, { status: 400 });
  const grant = await createGrant({ courseCode: body.courseCode, label: body.label ?? null });
  return NextResponse.json({ id: grant.id, token: grant.token, courseCode: grant.courseCode, expiresAt: grant.expiresAt });
}

export async function GET(req: Request): Promise<Response> {
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ grants: await listGrants() });
}

export async function DELETE(req: Request): Promise<Response> {
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await revokeGrant(id);
  return NextResponse.json({ ok: true });
}
