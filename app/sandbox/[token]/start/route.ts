import { NextResponse } from 'next/server';
import { getGrantByToken, isGrantValid } from '@/lib/sandbox/grants';
import { createSandboxCourse } from '@/lib/sandbox/courses';
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
  const courseCode = String(form.get('courseCode') ?? '').trim();
  const title = String(form.get('title') ?? '').trim();
  if (!name) return new NextResponse('Name is required.', { status: 400 });
  if (!title && !courseCode) return new NextResponse('A course title or code is required.', { status: 400 });
  const instructorName = institution ? `${name}, ${institution}` : name;

  // The tester defines their course → create a namespaced sandbox course and
  // bind the session to its generated internal code (never a real GC course).
  const { code } = await createSandboxCourse({ enteredCode: courseCode, title });

  const session = await createScopedSession({ grantId: grant.id, courseCode: code, instructorName });
  const res = NextResponse.redirect(new URL(`/capture/${encodeURIComponent(code)}`, req.url), 303);
  res.cookies.set(SCOPED_SESSION_COOKIE, session.id, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
    expires: session.expiresAt, path: '/', maxAge: Math.floor(SCOPED_SESSION_TTL_MS / 1000),
  });
  return res;
}
