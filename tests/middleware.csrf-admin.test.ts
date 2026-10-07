// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/db/client', () => ({ db: {} }));
vi.mock('@/lib/partners/sessions', () => ({ SESSION_COOKIE: 'gc_partner', createSession: vi.fn() }));

import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

/**
 * CSRF defense for state-changing requests on any Basic-Auth-gated path
 * (security review fix round 1, M2; broadened in fix round 2, N2 — the
 * review's "N1"). A scoped faculty grant-holder knows PROTOTYPE_SLUG (it's
 * rewritten into every gated page they view), so the slug alone is not a
 * cross-site defense; a simple cross-site <form method=POST> targeting a
 * gated route rides the admin's cached Basic Auth credentials. This block
 * runs in middleware, before gate()/auth, so it applies uniformly and can't
 * be bypassed by a route that forgets to add it.
 *
 * Fix round 1 scoped this to a literal `path.startsWith('/api/admin/')`
 * prefix test, which the round-2 review showed is itself bypassable by
 * percent-encoding the path (`/api/%61dmin/access`, `/api%2Fadmin/access`)
 * — Next's own router still resolves those to the real admin route, but
 * the literal-prefix test never matched, so the guard silently didn't
 * fire. The fix scopes the guard by `requiresBasicAuth(path)` instead: a
 * DEFAULT-DENY check (gated unless the path *literally* matches one of a
 * short public allowlist), so no encoding of a gated path can make it look
 * public — at worst it makes an already-public path look gated, which
 * fails closed, not open. This also broadens the guard to every gated
 * surface, not just `/api/admin/**`, per the review's "prefer the broader
 * safe rule."
 */
const HOST = 'gcworkflow.clemson.edu:8443';
const PUBLIC_ORIGIN = `https://${HOST}`;

function reqFor(path: string, opts: { method?: string; secFetchSite?: string; origin?: string; host?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.secFetchSite) headers['sec-fetch-site'] = opts.secFetchSite;
  if (opts.origin) headers['origin'] = opts.origin;
  headers.host = opts.host ?? HOST;
  headers['x-forwarded-proto'] = 'https';
  return new NextRequest(`https://${opts.host ?? HOST}${path}`, { method: opts.method ?? 'POST', headers });
}

beforeEach(() => {
  vi.stubEnv('PUBLIC_HTTPS_ORIGIN', PUBLIC_ORIGIN);
  vi.stubEnv('FACULTY_BASIC_AUTH', 'gcfaculty:godfrey');
});
afterEach(() => vi.unstubAllEnvs());

describe('CSRF guard on non-GET /api/admin/**', () => {
  it('blocks a cross-site Sec-Fetch-Site', async () => {
    const res = await middleware(reqFor('/api/admin/access', { secFetchSite: 'cross-site' }));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('cross_origin_blocked');
  });

  it('blocks a same-site Sec-Fetch-Site too (per the review: same-site is still blocked)', async () => {
    const res = await middleware(reqFor('/api/admin/access', { secFetchSite: 'same-site' }));
    expect(res.status).toBe(403);
  });

  it('blocks an Origin header whose host does not match the request host or PUBLIC_HTTPS_ORIGIN', async () => {
    const res = await middleware(reqFor('/api/admin/access/some-id/revoke', { origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
  });

  it('allows a same-origin Sec-Fetch-Site (passes the CSRF layer; falls through to normal auth)', async () => {
    const res = await middleware(reqFor('/api/admin/access', { secFetchSite: 'same-origin' }));
    expect(res.status).not.toBe(403);
  });

  it('allows an Origin header matching the request host', async () => {
    const res = await middleware(reqFor('/api/admin/access', { origin: PUBLIC_ORIGIN }));
    expect(res.status).not.toBe(403);
  });

  it('allows an Origin header matching PUBLIC_HTTPS_ORIGIN even if it differs from the request host', async () => {
    const res = await middleware(reqFor('/api/admin/access', { origin: PUBLIC_ORIGIN, host: 'internal-hostname:3000' }));
    expect(res.status).not.toBe(403);
  });

  it('allows a curl-style request with neither Origin nor Sec-Fetch-Site', async () => {
    const res = await middleware(reqFor('/api/admin/access'));
    expect(res.status).not.toBe(403);
  });

  it('does not apply the guard to GET requests (reads are not state-changing)', async () => {
    const res = await middleware(reqFor('/api/admin/access', { method: 'GET', secFetchSite: 'cross-site' }));
    expect(res.status).not.toBe(403);
  });

  it('applies the guard to any gated path, not just /api/admin/** (fix round 2, N1 — the "broader safe rule")', async () => {
    const res = await middleware(reqFor('/api/ask', { secFetchSite: 'cross-site' }));
    expect(res.status).toBe(403);
  });

  it('exempts the explicitly public prefixes (their own auth model), even cross-site', async () => {
    expect((await middleware(reqFor('/api/partners/some-token', { secFetchSite: 'cross-site' }))).status).not.toBe(403);
    expect((await middleware(reqFor('/api/mcp', { secFetchSite: 'cross-site' }))).status).not.toBe(403);
    expect((await middleware(reqFor('/api/curriculum/search', { secFetchSite: 'cross-site' }))).status).not.toBe(403);
  });

  describe('N1 red-proof: percent-encoded admin paths must not bypass the guard', () => {
    it('blocks /api/%61dmin/access (encoded "a") cross-site', async () => {
      const res = await middleware(reqFor('/api/%61dmin/access', { secFetchSite: 'cross-site' }));
      expect(res.status).toBe(403);
    });

    it('blocks /api%2Fadmin/access (encoded slash) cross-site', async () => {
      const res = await middleware(reqFor('/api%2Fadmin/access', { secFetchSite: 'cross-site' }));
      expect(res.status).toBe(403);
    });

    it('blocks a double-encoded admin path cross-site', async () => {
      const res = await middleware(reqFor('/api/%2561dmin/access', { secFetchSite: 'cross-site' })); // %25 61 -> %61 -> a
      expect(res.status).toBe(403);
    });

    it('blocks a mixed-case-encoded admin path cross-site', async () => {
      const res = await middleware(reqFor('/api/%61DMIN/access', { secFetchSite: 'cross-site' }));
      expect(res.status).toBe(403);
    });

    it('blocks the review\'s representative non-access admin route (v2-reset) under every encoded form', async () => {
      for (const path of ['/api/admin/v2-reset', '/api/%61dmin/v2-reset', '/api%2Fadmin/v2-reset']) {
        const res = await middleware(reqFor(path, { secFetchSite: 'cross-site' }));
        expect(res.status).toBe(403);
      }
    });
  });
});
