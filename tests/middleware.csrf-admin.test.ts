// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/db/client', () => ({ db: {} }));
vi.mock('@/lib/partners/sessions', () => ({ SESSION_COOKIE: 'gc_partner', createSession: vi.fn() }));

import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

/**
 * CSRF defense for state-changing /api/admin/** requests (security review
 * fix round 1, M2). A scoped faculty grant-holder knows PROTOTYPE_SLUG (it's
 * rewritten into every gated page they view), so the slug alone is not a
 * cross-site defense; a simple cross-site <form method=POST> targeting
 * these routes rides the admin's cached Basic Auth credentials. This block
 * runs in middleware, before gate()/auth, so it applies uniformly and can't
 * be bypassed by a route that forgets to add it.
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

  it('does not apply the guard outside /api/admin/**', async () => {
    const res = await middleware(reqFor('/api/ask', { secFetchSite: 'cross-site' }));
    expect(res.status).not.toBe(403);
  });
});
