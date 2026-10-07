import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { partners } from '@/lib/db/schema';
import { createSession, SESSION_COOKIE } from '@/lib/partners/sessions';
import { requiresBasicAuth } from '@/lib/auth/basic-auth';
import { courseFromScopedPath, resolveScopedSession } from '@/lib/sandbox/access';
import { gate } from '@/lib/auth/gate';
import { findGrantByToken, findGrantById, touchLastUsed, SESSION_COOKIE as GRANT_SESSION_COOKIE } from '@/lib/auth/grants';

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
  // <c>'s allowed capture surfaces (see lib/sandbox/access.ts for the
  // allowlist). Skip faculty Basic Auth for it — the route/page then authorizes
  // via authorizeCourseWrite (the session cookie). We deliberately do NOT inject
  // the faculty slug: it's a client-exposed credential, so injecting it would
  // leak it to the tester (capture-page client props / fetch URLs) and into
  // request URLs + logs. The session cookie is the credential; the slug is never
  // materialized for a scoped tester.
  const scopedCourse = courseFromScopedPath(path);
  if (scopedCourse) {
    const sess = await resolveScopedSession(req);
    if (sess && sess.courseCode === scopedCourse) {
      return NextResponse.next();
    }
  }

  // --- HTTP → HTTPS interstitial for gated faculty surfaces -----------------
  // Gating used to be by PATH only, so the full editable CourseCapture page —
  // Canvas API token field included — served over plain LAN HTTP on
  // 0.0.0.0:3000 (verified 2026-09-07: 200 with Basic Auth + slug). Over
  // cleartext that exposes the SHARED faculty password and the slug, which are
  // worse to lose than the per-user, self-revocable Canvas token.
  //
  // This block sits BEFORE the Basic Auth challenge deliberately: after it,
  // the browser would already have sent the password in cleartext by the time
  // the interstitial rendered.
  //
  // Scope + exemptions, each load-bearing:
  //   • /api/* — gets a machine-readable 426 instead of HTML (below): an MCP or
  //     HTTP client cannot follow an interstitial, so it must fail LOUDLY
  //     rather than silently sending a bearer token in the clear. This was a
  //     blanket exemption until 2026-09-07, held while gcdept_agents' 8 groups
  //     were still on cleartext; they migrated to /gc_wiki/ over 8443 and
  //     confirmed with a read_wiki trace, so the exemption is gone.
  //   • "/" and /view/* — intentionally public read-only over LAN HTTP
  //     ("transparent curriculum, anyone can read"); requiresBasicAuth already
  //     excludes them.
  //   • loopback — local tooling, the watchdog health probe, and unit tests.
  //   • unset PUBLIC_HTTPS_ORIGIN — fail OPEN, so a config gap can never lock
  //     everyone out of a headless machine.
  //
  // Detection is x-forwarded-proto, verified empirically on this deploy:
  //   direct LAN HTTP → xfp=http   |   via Caddy :8443 → xfp=https
  const httpsOrigin = process.env.PUBLIC_HTTPS_ORIGIN?.trim();
  if (httpsOrigin) {
    const proto = req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '');
    const host = (req.headers.get('host') ?? '').toLowerCase();
    const isLoopback = host.startsWith('127.0.0.1') || host.startsWith('localhost') || host.startsWith('[::1]');
    const cleartext = proto !== 'https' && !isLoopback;
    const target = `${httpsOrigin.replace(/\/$/, '')}${path}${req.nextUrl.search}`;

    // Machine clients: 426, never HTML. /api/partners is excluded because it is
    // driven by the public browser-based survey page, not a machine client — a
    // JSON 426 would just break the form. Every other cleartext API call is
    // wrong now, so this is a default-deny rule with one named exception rather
    // than an allowlist that goes stale as routes are added.
    if (cleartext && path.startsWith('/api/') && !path.startsWith('/api/partners')) {
      return NextResponse.json(
        {
          error: 'upgrade_required',
          message: 'This API is HTTPS-only. Cleartext HTTP is no longer served — reconnect over HTTPS. Any bearer token is unchanged.',
          https_url: target,
        },
        { status: 426, headers: { 'Upgrade': 'TLS/1.3, HTTP/1.1', 'Connection': 'Upgrade', 'Cache-Control': 'no-store' } },
      );
    }

    if (cleartext && requiresBasicAuth(path)) {
      const esc = target.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      return new NextResponse(
        `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
        `<meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<meta http-equiv="refresh" content="3;url=${esc}">` +
        `<title>Switch to HTTPS</title>` +
        `<style>body{font:16px/1.55 system-ui,-apple-system,sans-serif;max-width:34rem;margin:12vh auto;padding:0 1.5rem;color:#1b1d21}` +
        `h1{font-size:1.4rem;margin:0 0 .75rem}a.btn{display:inline-block;margin:1.25rem 0;padding:.7rem 1.15rem;background:#f56600;color:#fff;` +
        `text-decoration:none;border-radius:6px;font-weight:600}p{color:#4b5563}code{background:#f3f4f6;padding:.1rem .3rem;border-radius:3px}</style>` +
        `</head><body><h1>Switch to HTTPS to continue</h1>` +
        `<p>This page handles credentials — including your Canvas API token — so it is only served over a secure connection. ` +
        `You reached it over plain <code>http</code>.</p>` +
        `<p><a class="btn" href="${esc}">Continue securely</a></p>` +
        `<p>Redirecting automatically in a moment. Please update any bookmark to the secure address.</p>` +
        `</body></html>`,
        { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
      );
    }
  }

  // --- CSRF guard for state-changing requests on any gated path -------------
  // Security review fix round 1 (M2), broadened in fix round 2 (N1). A
  // scoped (non-admin) faculty grant holder learns PROTOTYPE_SLUG — it's
  // rewritten into every gated page they view (see the slug-rewrite note in
  // decide(), lib/auth/gate.ts) — so the slug second factor alone is not a
  // cross-site defense: a simple cross-site <form method=POST> targeting a
  // gated route rides the admin's cached Basic Auth credentials straight
  // past it. This runs in middleware, before gate()/auth, so it applies
  // uniformly and can't be skipped by a route that forgets to add its own
  // check.
  //
  // Round 1 scoped this to a literal `path.startsWith('/api/admin/')`
  // prefix test. The round-2 review showed that's bypassable by
  // percent-encoding the path (`/api/%61dmin/...`, `/api%2Fadmin/...`) —
  // Next's own router still resolves those to the real admin route, but the
  // literal-prefix test never matched, so the guard silently didn't fire,
  // while 14 OTHER mutating /api/admin/** routes (v2-reset, sandbox-grants,
  // courses/roster, …) have no JSON-content-type check of their own to fall
  // back on. Scoping by `requiresBasicAuth(path)` instead closes that class
  // structurally rather than by decoding: it is a DEFAULT-DENY check (gated
  // unless the path *literally* matches one of a short public allowlist —
  // lib/auth/basic-auth.ts's PUBLIC_PREFIXES), so no encoding of a gated
  // path can make it look public; at worst it makes an already-public path
  // look gated, which fails closed, not open. This also broadens the guard
  // to every gated surface, not just `/api/admin/**`, per the review's
  // "prefer the broader safe rule."
  //
  // Exemptions, all via requiresBasicAuth's own PUBLIC_PREFIXES (not
  // re-listed here so there's one place to keep in sync): `/partners/**` +
  // `/api/partners/**` (their own magic-link auth model, not Basic Auth);
  // `/sandbox/**` (scoped session tokens, handled above this block anyway);
  // `/api/mcp` + `/api/curriculum/search` (bearer-token self-auth for
  // non-browser machine callers that may legitimately be cross-origin);
  // `/wiki/**`, `/view/**`, and the static procurement/sme-questions pages
  // + `/api/procurement-intake` (public by design). The matcher-excluded
  // routes (api/transcribe, imscc-import, materials, vision-proxy) never
  // reach this function at all — see `config.matcher` below — so they need
  // no exemption here; each self-authenticates in its own route handler.
  //
  // GET/HEAD are exempt (reads aren't state-changing). A request with
  // neither header (curl, server-to-server, most non-browser HTTP clients)
  // is allowed through — browsers always send at least one of the two on a
  // cross-origin request, so their absence is not itself suspicious.
  if (requiresBasicAuth(path) && !['GET', 'HEAD'].includes(req.method.toUpperCase())) {
    const secFetchSite = req.headers.get('sec-fetch-site');
    const blocked =
      secFetchSite === 'cross-site' || secFetchSite === 'same-site'
        ? true
        : (() => {
            const origin = req.headers.get('origin');
            if (!origin) return false;
            const originHost = hostOf(origin);
            const requestHost = req.headers.get('host') ?? req.nextUrl.host;
            const publicHost = process.env.PUBLIC_HTTPS_ORIGIN ? hostOf(process.env.PUBLIC_HTTPS_ORIGIN) : null;
            return !(originHost && (originHost === requestHost || (publicHost && originHost === publicHost)));
          })();
    if (blocked) {
      return NextResponse.json(
        { error: 'cross_origin_blocked', message: 'This request looks cross-site; admin changes must come from the app itself.' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      );
    }
  }

  const result = await gate(req, {
    findGrantByToken, findGrantById, touch: touchLastUsed,
    env: {
      sessionSecret: process.env.SESSION_SECRET?.trim() || undefined,
      faculty: process.env.FACULTY_BASIC_AUTH,
      creator: process.env.CREATE_ONLY_AUTH,
      slug: process.env.PROTOTYPE_SLUG?.trim(),
      publicOrigin: process.env.PUBLIC_HTTPS_ORIGIN?.trim() || undefined,
    },
  });
  const cookieOpts = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/' };
  let res: NextResponse;
  switch (result.kind) {
    case 'next': res = NextResponse.next(); break;
    case 'rewrite': res = NextResponse.rewrite(result.url); break;
    case 'redirect': res = NextResponse.redirect(result.url, 302); break;
    case 'response': res = new NextResponse(result.body, { status: result.status, headers: result.headers }); break;
  }
  // clearCookie first, setCookie second: both can be present on the same
  // result (stale/dead cookie + a fresh Basic-Auth login), and
  // NextResponse.cookies.set() with the same name keeps only the LAST
  // call. Setting after clearing means a real replacement always wins;
  // the reverse order would leave the browser with the cookie cleared
  // instead of replaced.
  if ('clearCookie' in result && result.clearCookie) {
    res.cookies.set({ name: GRANT_SESSION_COOKIE, value: '', maxAge: 0, ...cookieOpts });
  }
  if ('setCookie' in result && result.setCookie) {
    res.cookies.set({ name: result.setCookie.name, value: result.setCookie.value, maxAge: result.setCookie.maxAge, ...cookieOpts });
  }
  return res;
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
/** The `host` (hostname[:port]) of a URL/origin string, or null if it doesn't parse. */
function hostOf(value: string): string | null {
  try { return new URL(value).host; } catch { return null; }
}

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
  //
  // api/courses/<code>/materials EXCLUDED (2026-06-16): same body-replay
  // TypeError, hit intermittently on real PDF uploads (worsens under
  // concurrent load — the GC 2400 500s). The route's POST + DELETE enforce
  // Basic Auth themselves (authorizedForBasicAuth) + slug/scoped, mirroring
  // imscc-import. The trailing (?!/) makes this EXACT-PATH ONLY: the bare
  // /materials path is excluded, but its subpaths (/materials/<id>,
  // /materials/compress) still pass through middleware Basic Auth — they have
  // no large-body problem and do NOT self-auth, so they must stay gated.
  //
  // api/vision-proxy EXCLUDED: the Docling caption proxy self-authenticates
  // (Bearer DOCLING_VLM_API_KEY) and forwards an image payload — keep it off the
  // Node-runtime middleware body buffering, same rationale as api/transcribe.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/vision-proxy|api/transcribe|api/courses/[^/]+/imscc-import|api/courses/[^/]+/materials(?!/)).*)'],
  // Run in Node runtime so we can import lib/db/client (node-postgres).
  // Edge runtime lacks Node builtins that `pg` needs.
  runtime: 'nodejs',
};
