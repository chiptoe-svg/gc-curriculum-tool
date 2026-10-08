/**
 * Grant-based authorization for route handlers that cannot rely on the
 * middleware gate (the matcher-excluded upload routes) or that need the
 * caller's capabilities (spec 2026-10-08 §4). Same grant resolution as
 * gate() (getRequestGrant) and the same scope table (authorize()), and it
 * FAILS CLOSED: no credential env set means no grant, which means 401 —
 * never the old "no-op when FACULTY_BASIC_AUTH is unset".
 */
import { NextResponse } from 'next/server';
import { authorize, type Grant } from '@/lib/auth/authorize';
import { getRequestGrant } from '@/lib/auth/viewer';
import { departmentLoginEnabled } from '@/lib/auth/auth-env';

/** 401 for a request with no usable credential. While DEPARTMENT_LOGIN is on
 * it keeps today's Basic challenge (browsers holding the department password
 * resend it); when off there is no WWW-Authenticate, so no password box. */
export function unauthorized(): Response {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (departmentLoginEnabled()) headers['WWW-Authenticate'] = 'Basic realm="GC Curriculum Tool - Faculty"';
  return NextResponse.json({ error: 'unauthorized', message: 'Sign in with your personal link.' }, { status: 401, headers });
}

export function forbidden(): Response {
  return NextResponse.json({ error: 'forbidden', message: 'This link can’t do that.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Resolve the request's grant and run it through authorize() for this
 * request's own method + path. `{ grant }` when allowed, else a ready 401
 * (no grant) or 403 (grant not allowed) response.
 */
export async function authorizeRequest(req: Request): Promise<{ grant: Grant; response?: undefined } | { grant?: undefined; response: Response }> {
  const grant = await getRequestGrant(req.headers);
  if (!grant) return { response: unauthorized() };
  let pathname: string;
  try { pathname = new URL(req.url).pathname; } catch { return { response: unauthorized() }; }
  if (!authorize(grant, req.method, pathname).ok) return { response: forbidden() };
  return { grant };
}
