import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { partners } from '@/lib/db/schema';
import { createSession, SESSION_COOKIE } from '@/lib/partners/sessions';
import { requiresBasicAuth, resolveRole, creatorAllowed } from '@/lib/auth/basic-auth';
import { courseFromScopedPath, resolveScopedSession } from '@/lib/sandbox/access';
import { getPrototypeSlug } from '@/lib/slug';

/**
 * Middleware does two things, dispatched by path prefix:
 *
 *   1. `/partners/*` — issues the partner session cookie for the
 *      magic-link survey (see handlePartnerSession).
 *
 *   2. Faculty surfaces (everything not under /partners, /view, or
 *      their /api/* equivalents) — gated by HTTP Basic Auth when
 *      FACULTY_BASIC_AUTH env var is set. This is the stopgap that
 *      protects the local Mac deploy (the only deploy now — Vercel was
 *      retired 2026-06-04). The HTTPS Tailscale Funnel serves it; if
 *      FACULTY_BASIC_AUTH is ever unset the gate no-ops, so it must stay
 *      set. See docs/superpowers/plans/2026-05-25-phase2-hybrid-deploy.md
 */
export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  if (path.startsWith('/partners/')) {
    return handlePartnerSession(req);
  }

  // Scoped external-tester access: a session bound to course <c> opens only
  // <c>'s allowed capture surfaces. We inject the faculty slug so the existing
  // routes authorize unchanged (see lib/sandbox/access.ts for the allowlist).
  const scopedCourse = courseFromScopedPath(path);
  if (scopedCourse) {
    const sess = await resolveScopedSession(req);
    if (sess && sess.courseCode === scopedCourse) {
      const url = req.nextUrl.clone();
      url.searchParams.set('slug', getPrototypeSlug());
      return NextResponse.rewrite(url);
    }
  }

  const facultyExpected = process.env.FACULTY_BASIC_AUTH;
  if (facultyExpected && requiresBasicAuth(path)) {
    const role = resolveRole(req.headers.get('authorization'), {
      faculty: facultyExpected,
      creator: process.env.CREATE_ONLY_AUTH,
    });
    if (role === null) {
      return new NextResponse('Authentication required.', {
        status: 401,
        headers: {
          // Realm string must be ASCII (HTTP header = ByteString).
          'WWW-Authenticate': 'Basic realm="GC Curriculum Tool - Faculty"',
        },
      });
    }
    // Create-only role: allowed on the add-course paths, forbidden elsewhere.
    if (role === 'creator' && !creatorAllowed(path, req.method)) {
      return new NextResponse('Forbidden.', { status: 403 });
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
  //
  // api/transcribe EXCLUDED (2026-06-12): Node-runtime middleware
  // buffers/replays request bodies (middlewareClientMaxBodySize), and that
  // replay deterministically breaks real-size multipart mic uploads with
  // "Response body object should not be disturbed or locked" BEFORE the
  // route runs (tiny clips pass; real recordings fail). The route enforces
  // Basic Auth itself (authorizedForBasicAuth) + slug + rate/cost caps —
  // same protection, no body proxying.
  //
  // api/courses/<code>/imscc-import EXCLUDED (2026-06-15): identical issue —
  // real .imscc cartridge uploads are tens of MB (e.g. a 65 MB Canvas
  // export), and the body replay 500'd them with the same TypeError before
  // the route ran. The route enforces Basic Auth itself (authorizedForBasicAuth)
  // + slug, mirroring transcribe. (<code> may contain %20, so [^/]+.)
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/transcribe|api/courses/[^/]+/imscc-import).*)'],
  // Run in Node runtime so we can import lib/db/client (node-postgres).
  // Edge runtime lacks Node builtins that `pg` needs.
  runtime: 'nodejs',
};
