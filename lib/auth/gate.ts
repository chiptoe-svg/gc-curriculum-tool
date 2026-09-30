import type { NextRequest } from 'next/server';
import { authorize, type Grant } from '@/lib/auth/authorize';
import { SESSION_COOKIE, builtinGrant, cookieMaxAge, isLive, signSession, verifySession, type StoredGrant } from '@/lib/auth/grants';
import { forbiddenPage, unauthorizedPage } from '@/lib/auth/pages';
import { requiresBasicAuth, resolveRole } from '@/lib/auth/basic-auth';

export interface CookieSpec { name: string; value: string; maxAge: number }
export interface GateDeps {
  findGrantByToken(token: string): Promise<StoredGrant | null>;
  findGrantById(id: string): Promise<StoredGrant | null>;
  touch(id: string): Promise<void>;
  env: { sessionSecret?: string; faculty?: string; creator?: string; slug?: string };
  now?: () => Date;
}
export type GateResult =
  | { kind: 'next'; setCookie?: CookieSpec; clearCookie?: true }
  | { kind: 'rewrite'; url: URL; setCookie?: CookieSpec }
  | { kind: 'redirect'; url: URL; setCookie: CookieSpec }
  | { kind: 'response'; status: 401 | 403 | 503; body: string; headers: Record<string, string>; clearCookie?: true };

const CHALLENGE = { 'WWW-Authenticate': 'Basic realm="GC Curriculum Tool - Faculty"', 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };
const HTML = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };

type Resolved = { grant: Grant; setCookie?: CookieSpec };

function cookieFor(grant: Grant, live: { expiresAt: Date | null }, deps: GateDeps): CookieSpec | undefined {
  const secret = deps.env.sessionSecret;
  if (!secret) return undefined;
  const maxAge = cookieMaxAge(live, deps.now?.());
  return maxAge > 0 ? { name: SESSION_COOKIE, value: signSession(grant.id, secret), maxAge } : undefined;
}

/** ?key= (any path) or legacy ?slug= (gated path) → grant, or null. */
async function fromKey(req: NextRequest, gated: boolean, deps: GateDeps): Promise<Resolved | null> {
  const key = req.nextUrl.searchParams.get('key') ?? (gated ? req.nextUrl.searchParams.get('slug') : null);
  if (!key) return null;
  if (deps.env.slug && key === deps.env.slug) {
    const g = builtinGrant('faculty');
    return { grant: g, setCookie: cookieFor(g, { expiresAt: null }, deps) };
  }
  const stored = await deps.findGrantByToken(key);
  if (!stored || !isLive(stored, deps.now?.())) return null;
  return { grant: stored, setCookie: cookieFor(stored, stored, deps) };
}

async function fromCookie(req: NextRequest, deps: GateDeps): Promise<Resolved | null | 'dead'> {
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const id = deps.env.sessionSecret ? verifySession(raw, deps.env.sessionSecret) : null;
  if (!id) return 'dead';
  if (id === 'builtin:faculty' || id === 'builtin:creator') return { grant: builtinGrant(id.slice(8) as 'faculty' | 'creator') };
  const stored = await deps.findGrantById(id);
  if (!stored || !isLive(stored, deps.now?.())) return 'dead';
  void deps.touch(id).catch(() => {});
  return { grant: stored };
}

function fromBasic(req: NextRequest, deps: GateDeps): Resolved | null {
  const role = resolveRole(req.headers.get('authorization'), { faculty: deps.env.faculty, creator: deps.env.creator });
  if (!role) return null;
  const g = builtinGrant(role);
  return { grant: g, setCookie: cookieFor(g, { expiresAt: null }, deps) };
}

function stripKeys(url: URL): URL {
  const u = new URL(url.toString());
  u.searchParams.delete('key'); u.searchParams.delete('slug');
  return u;
}

export async function gate(req: NextRequest, deps: GateDeps): Promise<GateResult> {
  const path = req.nextUrl.pathname;
  const gated = requiresBasicAuth(path);
  try {
    // 1. Magic-link exchange — on ANY path (the link lands on the public /).
    const keyed = await fromKey(req, gated, deps);
    if (keyed) {
      if (keyed.setCookie) return { kind: 'redirect', url: stripKeys(req.nextUrl), setCookie: keyed.setCookie };
      if (!gated) return { kind: 'next' };
      // No cookie possible (no SESSION_SECRET): authorize this request only.
      return decide(req, keyed.grant, undefined, deps);
    }
    if (!gated) return { kind: 'next' };

    // 2. Cookie, then Basic.
    const c = await fromCookie(req, deps);
    if (c && c !== 'dead') return decide(req, c.grant, undefined, deps);
    const b = fromBasic(req, deps);
    if (b) return decide(req, b.grant, b.setCookie, deps);
    return { kind: 'response', status: 401, body: unauthorizedPage(), headers: CHALLENGE, ...(c === 'dead' ? { clearCookie: true as const } : {}) };
  } catch {
    return { kind: 'response', status: 503, body: 'Sign-in is temporarily unavailable.', headers: HTML };
  }
}

function decide(req: NextRequest, grant: Grant, setCookie: CookieSpec | undefined, deps: GateDeps): GateResult {
  const d = authorize(grant, req.method, req.nextUrl.pathname);
  if (!d.ok) return { kind: 'response', status: 403, body: forbiddenPage(grant.label, d.code), headers: HTML };
  const isPage = !req.nextUrl.pathname.startsWith('/api/');
  if (isPage && deps.env.slug && !req.nextUrl.searchParams.has('slug')) {
    const u = new URL(req.nextUrl.toString()); u.searchParams.set('slug', deps.env.slug);
    return { kind: 'rewrite', url: u, setCookie };
  }
  return { kind: 'next', setCookie };
}
