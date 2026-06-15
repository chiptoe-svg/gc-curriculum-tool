import { NextResponse } from 'next/server';
import { createGrant, listGrants, revokeGrant } from '@/lib/sandbox/grants';

// Auth: gated by the /api/admin/* middleware (FACULTY_BASIC_AUTH) — same as
// every other admin route (e.g. v2-backfill, v2-reset), which carry no
// in-route auth by design. /api/admin is NOT a PUBLIC_PREFIX, so an
// unauthenticated request gets a 401 from middleware before reaching these
// handlers. The minted token IS the shareable secret; it's returned only to
// the authenticated operator who needs the link (mirrors partners.magicToken).

export async function POST(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({})) as { courseCode?: string; label?: string };
  if (!body.courseCode) return NextResponse.json({ error: 'courseCode required' }, { status: 400 });
  const grant = await createGrant({ courseCode: body.courseCode, label: body.label ?? null });
  return NextResponse.json({ id: grant.id, token: grant.token, courseCode: grant.courseCode, expiresAt: grant.expiresAt });
}

export async function GET(): Promise<Response> {
  return NextResponse.json({ grants: await listGrants() });
}

export async function DELETE(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await revokeGrant(id);
  return NextResponse.json({ ok: true });
}
