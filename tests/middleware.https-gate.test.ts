// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/db/client', () => ({ db: {} }));
vi.mock('@/lib/partners/sessions', () => ({ SESSION_COOKIE: 'gc_partner', createSession: vi.fn() }));

import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

/**
 * HTTP → HTTPS interstitial for gated faculty surfaces.
 *
 * 2026-09-07: middleware gated by PATH only, so the full editable CourseCapture
 * page (Canvas API token field included) served over plain LAN HTTP on
 * 0.0.0.0:3000 — verified live: 200 with Basic Auth + slug. Over HTTP that
 * leaks the SHARED faculty password and the slug, not just the per-user Canvas
 * token. The interstitial must sit BEFORE the Basic Auth challenge so the
 * password is never even requested over cleartext.
 *
 * Detection is by x-forwarded-proto, empirically verified on this deploy:
 *   direct LAN HTTP → xfp=http    | via Caddy :8443 → xfp=https
 * Loopback is exempt (local tooling, health probes, these tests).
 * /api/* is exempt — gcdept_agents' containers call
 * http://gcworkflow.clemson.edu:3000/api/mcp with a bearer token and would
 * not follow an HTML interstitial.
 */

const HTTPS_ORIGIN = 'https://gcworkflow.clemson.edu:8443';
const auth = (cred: string) => 'Basic ' + Buffer.from(cred).toString('base64');

function reqFor(
  url: string,
  opts: { proto?: string; host?: string; cred?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (opts.proto) headers['x-forwarded-proto'] = opts.proto;
  if (opts.host) headers.host = opts.host;
  if (opts.cred) headers.authorization = auth(opts.cred);
  return new NextRequest(url, { headers });
}

beforeEach(() => {
  vi.stubEnv('FACULTY_BASIC_AUTH', 'gcfaculty:godfrey');
  vi.stubEnv('PUBLIC_HTTPS_ORIGIN', HTTPS_ORIGIN);
});
afterEach(() => vi.unstubAllEnvs());

describe('http→https interstitial', () => {
  it('serves the interstitial for a gated page over plain LAN HTTP', async () => {
    const res = await middleware(reqFor('http://130.127.162.67:3000/capture/GC%203800?slug=abcdefgh', { proto: 'http', host: '130.127.162.67:3000' }));
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain(HTTPS_ORIGIN);
    expect(body).toContain('/capture/GC%203800?slug=abcdefgh');
  });

  it('never issues a Basic Auth challenge over HTTP — the password must not be requested in cleartext', async () => {
    const res = await middleware(reqFor('http://130.127.162.67:3000/capture/GC%203800', { proto: 'http', host: '130.127.162.67:3000' }));
    expect(res.status).not.toBe(401);
    expect(res.headers.get('www-authenticate')).toBeNull();
  });

  it('does not interfere when the request arrived over HTTPS (Caddy sets xfp=https)', async () => {
    const res = await middleware(reqFor('https://gcworkflow.clemson.edu:8443/capture/GC%203800', { proto: 'https', host: 'gcworkflow.clemson.edu:8443', cred: 'gcfaculty:godfrey' }));
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain('Switch to HTTPS');
  });

  // The /api/* exemption was TEMPORARY, held only while gcdept_agents' 8 groups
  // were still on cleartext. Their migration + a read_wiki trace over
  // /gc_wiki/ landed 2026-09-07, so cleartext API calls now fail LOUDLY and
  // machine-readably instead of silently shipping a bearer token in the clear.
  it('426s a cleartext API call — machine-readable, never HTML', async () => {
    const res = await middleware(reqFor('http://gcworkflow.clemson.edu:3000/api/mcp', { proto: 'http', host: 'gcworkflow.clemson.edu:3000' }));
    expect(res.status).toBe(426);
    const body = await res.text();
    expect(body).not.toContain('<html');
    const json = JSON.parse(body);
    expect(json.error).toBe('upgrade_required');
    expect(json.https_url).toBe(`${HTTPS_ORIGIN}/api/mcp`);
  });

  it('426 preserves the path so the caller is told exactly where to go', async () => {
    const res = await middleware(reqFor('http://gcworkflow.clemson.edu:3000/api/curriculum/search?q=ink', { proto: 'http', host: 'gcworkflow.clemson.edu:3000' }));
    expect(res.status).toBe(426);
    expect(JSON.parse(await res.text()).https_url).toContain('/api/curriculum/search?q=ink');
  });

  it('does NOT 426 the partner API — browser-driven public survey, not a machine client', async () => {
    const res = await middleware(reqFor('http://gcworkflow.clemson.edu:3000/api/partners/transcribe', { proto: 'http', host: 'gcworkflow.clemson.edu:3000' }));
    expect(res.status).not.toBe(426);
  });

  it('does NOT 426 an API call over HTTPS', async () => {
    const res = await middleware(reqFor('https://gcworkflow.clemson.edu:8443/api/mcp', { proto: 'https', host: 'gcworkflow.clemson.edu:8443' }));
    expect(res.status).not.toBe(426);
  });

  it('does NOT 426 loopback — internal callers (docling vision-proxy, health probes) keep working', async () => {
    const res = await middleware(reqFor('http://127.0.0.1:3000/api/mcp', { proto: 'http', host: '127.0.0.1:3000' }));
    expect(res.status).not.toBe(426);
  });

  it('exempts loopback so local tooling and health probes still work', async () => {
    const res = await middleware(reqFor('http://127.0.0.1:3000/capture/GC%203800', { proto: 'http', host: '127.0.0.1:3000' }));
    expect(res.status).toBe(401); // reaches the normal auth gate, not the interstitial
  });

  it('fails OPEN when PUBLIC_HTTPS_ORIGIN is unset — never lock anyone out on a config gap', async () => {
    vi.stubEnv('PUBLIC_HTTPS_ORIGIN', '');
    const res = await middleware(reqFor('http://130.127.162.67:3000/capture/GC%203800', { proto: 'http', host: '130.127.162.67:3000' }));
    expect(res.status).toBe(401);
  });

  it('leaves the public read-only surfaces alone over HTTP', async () => {
    const res = await middleware(reqFor('http://130.127.162.67:3000/view/GC%203800', { proto: 'http', host: '130.127.162.67:3000' }));
    expect(await res.text()).not.toContain(HTTPS_ORIGIN);
  });
});
