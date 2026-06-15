import { NextResponse } from 'next/server';
import { createGrant, listGrants, revokeGrant } from '@/lib/sandbox/grants';

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
