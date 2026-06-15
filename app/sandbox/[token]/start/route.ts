import { NextResponse } from 'next/server';
import { getGrantByToken, isGrantValid } from '@/lib/sandbox/grants';
import { createScopedSession, SCOPED_SESSION_COOKIE, SCOPED_SESSION_TTL_MS } from '@/lib/sandbox/sessions';

interface Ctx { params: Promise<{ token: string }>; }

export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const { token } = await params;
  const grant = await getGrantByToken(token);
  if (!grant || !isGrantValid(grant)) {
    return new NextResponse('This link is no longer valid.', { status: 404 });
  }
  const form = await req.formData();
  const name = String(form.get('name') ?? '').trim();
  const institution = String(form.get('institution') ?? '').trim();
  if (!name) return new NextResponse('Name is required.', { status: 400 });
  const instructorName = institution ? `${name}, ${institution}` : name;

  const session = await createScopedSession({ grantId: grant.id, courseCode: grant.courseCode, instructorName });
  const res = NextResponse.redirect(new URL(`/capture/${encodeURIComponent(grant.courseCode)}`, req.url), 303);
  res.cookies.set(SCOPED_SESSION_COOKIE, session.id, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
    expires: session.expiresAt, path: '/', maxAge: Math.floor(SCOPED_SESSION_TTL_MS / 1000),
  });
  return res;
}
