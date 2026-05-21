import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { partners } from '@/lib/db/schema';
import { createSession, SESSION_COOKIE } from '@/lib/partners/sessions';

/**
 * Issues the partner session cookie for the magic-link survey.
 *
 * This cannot live in the partner page itself: that page is a Server
 * Component, and Next.js only permits cookie mutation in middleware, Route
 * Handlers, and Server Actions. Setting it during render throws
 * "Cookies can only be modified in a Server Action or Route Handler".
 *
 * The URL token stays authoritative (see lib/partners/auth.ts) — the cookie
 * is the convenience credential for partner /api calls that don't re-send the
 * token. The landing path always mints a fresh session so a re-clicked magic
 * link always works; sub-paths only mint if no cookie is present yet.
 */
export async function middleware(req: NextRequest) {
  const segments = req.nextUrl.pathname.split('/'); // ['', 'partners', token, ...]
  const token = segments[2];
  if (!token) return NextResponse.next();

  const isLandingPath = segments.length === 3;
  if (req.cookies.has(SESSION_COOKIE) && !isLandingPath) {
    return NextResponse.next();
  }

  const [partner] = await db
    .select({ id: partners.id, active: partners.active })
    .from(partners)
    .where(eq(partners.magicToken, token))
    .limit(1);
  // Unknown / revoked token: let the page render notFound() — don't mint.
  if (!partner || !partner.active) return NextResponse.next();

  const session = await createSession(partner.id);
  const res = NextResponse.next();
  res.cookies.set(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires: session.expiresAt,
    path: '/',
  });
  return res;
}

export const config = {
  matcher: '/partners/:path*',
};
