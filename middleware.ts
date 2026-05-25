import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { partners } from '@/lib/db/schema';
import { createSession, SESSION_COOKIE } from '@/lib/partners/sessions';
import { requiresBasicAuth, authorizedForBasicAuth } from '@/lib/auth/basic-auth';

/**
 * Middleware does two things, dispatched by path prefix:
 *
 *   1. `/partners/*` — issues the partner session cookie for the
 *      magic-link survey (see handlePartnerSession).
 *
 *   2. Faculty surfaces (everything not under /partners, /preview, or
 *      their /api/* equivalents) — gated by HTTP Basic Auth when
 *      FACULTY_BASIC_AUTH env var is set. This is the Phase 2 hybrid-
 *      deploy stopgap that protects the local Mac LAN deploy; the
 *      Vercel deploy doesn't set the env var, so the gate no-ops
 *      there. See docs/superpowers/plans/2026-05-25-phase2-hybrid-deploy.md
 */
export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  if (path.startsWith('/partners/')) {
    return handlePartnerSession(req);
  }

  const expected = process.env.FACULTY_BASIC_AUTH;
  if (expected && requiresBasicAuth(path)) {
    if (!authorizedForBasicAuth(req.headers.get('authorization'), expected)) {
      return new NextResponse('Authentication required.', {
        status: 401,
        headers: {
          'WWW-Authenticate': 'Basic realm="GC Curriculum Tool — Faculty"',
        },
      });
    }
  }

  return NextResponse.next();
}

/**
 * Partner session-cookie minting — split out of middleware() so the
 * dispatch reads cleanly. Behavior unchanged from before the Basic
 * Auth addition.
 *
 * Cookie mutation must live here: the partner page is a Server
 * Component, and Next.js only permits cookie writes in middleware,
 * route handlers, or server actions. The URL token (see
 * lib/partners/auth.ts) stays the authoritative credential; this
 * cookie is the convenience credential for /api calls that don't
 * re-send it. Landing path always mints a fresh session (re-clicked
 * magic link works); sub-paths only mint if no cookie is present.
 */
async function handlePartnerSession(req: NextRequest): Promise<NextResponse> {
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
  // Broadened from /partners/:path* to cover faculty routes for Basic
  // Auth. Standard Next.js exclusion list keeps middleware off of
  // _next assets and the favicon.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
