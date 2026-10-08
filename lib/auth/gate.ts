import type { NextRequest } from 'next/server';
import { authorize, type Grant } from '@/lib/auth/authorize';
import { SESSION_COOKIE, builtinGrant, cookieMaxAge, grantFromSessionCookie, isLive, pickActiveGrant, signSession, type StoredGrant } from '@/lib/auth/grants';
import { forbiddenPage, signinPage, unauthorizedPage } from '@/lib/auth/pages';
import { DEFAULT_SIGNIN_CONTACT } from '@/lib/auth/auth-env';
import { requiresBasicAuth, resolveRole } from '@/lib/auth/basic-auth';

export interface CookieSpec { name: string; value: string; maxAge: number }
export interface GateDeps {
  findGrantByToken(token: string): Promise<StoredGrant | null>;
  findGrantById(id: string): Promise<StoredGrant | null>;
  touch(id: string): Promise<void>;
  /** `departmentLogin`: the DEPARTMENT_LOGIN switch (spec 2026-10-08).
   * Absent = on (today's behavior); only an explicit `false` retires the
   * shared password. `signinContact`: SIGNIN_CONTACT for the sign-in page. */
  env: { sessionSecret?: string; faculty?: string; creator?: string; slug?: string; publicOrigin?: string; departmentLogin?: boolean; signinContact?: string };
  now?: () => Date;
}
export type GateResult =
  | { kind: 'next'; setCookie?: CookieSpec; clearCookie?: true }
  | { kind: 'rewrite'; url: URL; setCookie?: CookieSpec; clearCookie?: true }
  | { kind: 'redirect'; url: URL; setCookie: CookieSpec }
  | { kind: 'response'; status: 401 | 403 | 503; body: string; headers: Record<string, string>; clearCookie?: true };

const CHALLENGE = { 'WWW-Authenticate': 'Basic realm="GC Curriculum Tool - Faculty"', 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };
const HTML = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

const departmentOn = (deps: GateDeps) => deps.env.departmentLogin !== false;

type Resolved = { grant: Grant; setCookie?: CookieSpec };

function cookieFor(grant: Grant, live: { expiresAt: Date | null }, deps: GateDeps): CookieSpec | undefined {
  const secret = deps.env.sessionSecret;
  if (!secret) return undefined;
  const maxAge = cookieMaxAge(live, deps.now?.());
  return maxAge > 0 ? { name: SESSION_COOKIE, value: signSession(grant.id, secret), maxAge } : undefined;
}

/**
 * ?key= → grant, or null. `?slug=` is NEVER a credential (2026-09-30 spec
 * amendment) — PROTOTYPE_SLUG grants nothing by itself.
 * Caller (`gate`) has already confirmed eligibility (GET/HEAD, non-/api/,
 * no live personal session cookie already present) before calling this.
 * On a public path a DB failure during the lookup is swallowed (key
 * treated as absent, `next`); on a gated path it propagates so the
 * request fails closed (503).
 */
async function fromKey(req: NextRequest, gated: boolean, deps: GateDeps): Promise<Resolved | null> {
  const key = req.nextUrl.searchParams.get('key');
  if (!key) return null;
  try {
    const stored = await deps.findGrantByToken(key);
    if (!stored || !isLive(stored, deps.now?.())) return null;
    return { grant: stored, setCookie: cookieFor(stored, stored, deps) };
  } catch (err) {
    if (gated) throw err;
    return null;
  }
}

async function fromCookie(req: NextRequest, deps: GateDeps): Promise<Resolved | null | 'dead'> {
  const g = await grantFromSessionCookie(req.cookies.get(SESSION_COOKIE)?.value, deps);
  if (!g || g === 'dead') return g;
  if (!g.id.startsWith('builtin:')) {
    // Fire-and-forget: deferred to a microtask so even a synchronous throw
    // inside deps.touch() can never turn into a 503 for this request.
    void Promise.resolve().then(() => deps.touch(g.id)).catch(() => {});
  }
  return { grant: g };
}

function fromBasic(req: NextRequest, deps: GateDeps): Resolved | null {
  if (!departmentOn(deps)) return null; // DEPARTMENT_LOGIN=off: Basic is never a credential
  const role = resolveRole(req.headers.get('authorization'), { faculty: deps.env.faculty, creator: deps.env.creator });
  if (!role) return null;
  const credential = role === 'faculty' ? deps.env.faculty : deps.env.creator;
  if (!credential) return null; // unreachable: resolveRole only matches a set credential
  const g = builtinGrant(role, credential, deps.env.sessionSecret);
  return { grant: g, setCookie: cookieFor(g, { expiresAt: null }, deps) };
}

/** Redirect target for a key exchange: PUBLIC_HTTPS_ORIGIN (falling back to
 * the request's own origin) so it lands on the public origin behind the
 * proxy, never wherever the request happened to arrive from. `key` removed. */
function redirectUrl(req: NextRequest, deps: GateDeps): URL {
  const base = deps.env.publicOrigin ?? req.nextUrl.origin;
  // Never let the path influence the origin: a pathname beginning with
  // `//` (or a backslash variant normalised to `//`) parses as
  // protocol-relative when combined with a base via `new URL(path, base)`,
  // letting an attacker redirect off-origin. Assigning `.pathname`/
  // `.search` on an already-anchored URL can't be reinterpreted that way.
  const u = new URL(base);
  u.pathname = req.nextUrl.pathname;
  u.search = req.nextUrl.search;
  u.searchParams.delete('key');
  return u;
}

export async function gate(req: NextRequest, deps: GateDeps): Promise<GateResult> {
  const path = req.nextUrl.pathname;
  const gated = requiresBasicAuth(path);
  const method = req.method.toUpperCase();
  const isApi = path.startsWith('/api/');
  const keyEligible = (method === 'GET' || method === 'HEAD') && !isApi && req.nextUrl.searchParams.has('key');

  try {
    // Cookie resolution: always for gated paths (it's the primary auth
    // source there); for public paths, only when a key is in play and
    // might need to be overridden by an established session — and a DB
    // failure here must never leak into a public response.
    let c: Resolved | null | 'dead' = null;
    if (gated) {
      c = await fromCookie(req, deps);
    } else if (keyEligible) {
      try { c = await fromCookie(req, deps); } catch { c = null; }
    }
    // A live PERSONAL session — the only kind a stray ?key= must never swap.
    // A built-in ("Department login") session is not one: a personal link
    // replaces it (spec 2026-10-08 §1 — the owner's fresh admin link was
    // ignored in a browser holding a department cookie).
    const livePersonal = !!c && c !== 'dead' && !c.grant.id.startsWith('builtin:');

    // 1. Magic-link exchange — GET/HEAD, non-/api/ only, and only when no
    // live personal session cookie is already present. Runs on public paths
    // too (the link lands on the public /). A key that does not resolve
    // leaves an existing built-in session in place.
    if (keyEligible && !livePersonal) {
      const keyed = await fromKey(req, gated, deps);
      if (keyed) {
        if (keyed.setCookie) return { kind: 'redirect', url: redirectUrl(req, deps), setCookie: keyed.setCookie };
        if (!gated) return { kind: 'next' };
        // No cookie possible (no SESSION_SECRET): authorize this request only.
        return decide(req, keyed.grant, undefined, deps, false);
      }
    }
    if (!gated) return { kind: 'next' };

    // 2. Cookie, then Basic — the ordering is the shared `pickActiveGrant`
    // rule (security re-review G1), so this can't drift from
    // getViewerAccess's resolution of the same two credentials.
    const b = fromBasic(req, deps);
    const picked = pickActiveGrant(c === 'dead' ? 'dead' : (c ? c.grant : null), b ? b.grant : null);
    if (picked.source === 'cookie') return decide(req, picked.grant, undefined, deps, false);
    if (picked.source === 'basic') return decide(req, picked.grant, b!.setCookie, deps, c === 'dead');
    const clear = c === 'dead' ? { clearCookie: true as const } : {};
    if (departmentOn(deps)) return { kind: 'response', status: 401, body: unauthorizedPage(), headers: CHALLENGE, ...clear };
    // DEPARTMENT_LOGIN=off: no WWW-Authenticate anywhere, so no browser
    // password box. Pages get the sign-in page; APIs get JSON.
    if (isApi) {
      return { kind: 'response', status: 401, body: JSON.stringify({ error: 'unauthorized', message: 'Sign in with your personal link.' }), headers: JSON_HEADERS, ...clear };
    }
    return { kind: 'response', status: 401, body: signinPage(deps.env.signinContact || DEFAULT_SIGNIN_CONTACT), headers: HTML, ...clear };
  } catch {
    return { kind: 'response', status: 503, body: 'Sign-in is temporarily unavailable.', headers: HTML };
  }
}

function decide(req: NextRequest, grant: Grant, setCookie: CookieSpec | undefined, deps: GateDeps, clearStale: boolean): GateResult {
  const d = authorize(grant, req.method, req.nextUrl.pathname);
  const clear = clearStale ? { clearCookie: true as const } : {};
  if (!d.ok) return { kind: 'response', status: 403, body: forbiddenPage(grant.label, d.code), headers: HTML, ...clear };
  const isPage = !req.nextUrl.pathname.startsWith('/api/');
  if (isPage && deps.env.slug && !req.nextUrl.searchParams.has('slug')) {
    const u = new URL(req.nextUrl.toString()); u.searchParams.set('slug', deps.env.slug);
    // Behind Caddy (X-Forwarded-Proto: https) Next's router and render server
    // disagree on the app's own origin (`--hostname 127.0.0.1` vs the render
    // server's `localhost`), so it classifies this rewrite as EXTERNAL and
    // proxies it to itself — over TLS to a plain-HTTP port, which fails with
    // EPROTO and a 500 (observed 2026-09-30). The self-proxy works over plain
    // HTTP, so pin the scheme. Cost: one loopback hop per gated page view.
    // Tracked in STATE.md Deferred/debt — the durable fix is dropping the
    // 11 page-level slug checks so no rewrite is needed.
    u.protocol = 'http:';
    return { kind: 'rewrite', url: u, setCookie, ...clear };
  }
  return { kind: 'next', setCookie, ...clear };
}
