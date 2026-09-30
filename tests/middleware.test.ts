import { createHmac } from 'node:crypto';
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Prevent the real node-postgres pool + session module from loading.
vi.mock('@/lib/db/client', () => ({ db: {} }));
vi.mock('@/lib/partners/sessions', () => ({ SESSION_COOKIE: 'gc_partner', createSession: vi.fn() }));

import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
import { signSession } from '@/lib/auth/grants';

const auth = (cred: string) => 'Basic ' + Buffer.from(cred).toString('base64');
function reqFor(path: string, opts: { method?: string; cred?: string; cookie?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = auth(opts.cred);
  if (opts.cookie) headers.cookie = opts.cookie;
  return new NextRequest(`http://localhost${path}`, { method: opts.method ?? 'GET', headers });
}

beforeEach(() => {
  vi.stubEnv('FACULTY_BASIC_AUTH', 'gcfaculty:godfrey');
  vi.stubEnv('CREATE_ONLY_AUTH', 'cufaculty:tigers');
});
afterEach(() => vi.unstubAllEnvs());

describe('middleware role enforcement', () => {
  it('401s with no credentials on a faculty path', async () => {
    expect((await middleware(reqFor('/capture/GC%201040'))).status).toBe(401);
  });
  it('lets faculty reach an edit surface', async () => {
    expect((await middleware(reqFor('/capture/GC%201040', { cred: 'gcfaculty:godfrey' }))).status).toBe(200);
  });
  // Superseded by the 2026-09-30 scoped-access-links design (gate()/authorize()):
  // reads are free for any live grant (see tests/auth/authorize.test.ts "reads
  // are free for any grant"); only writes are capability/scope-gated. A creator
  // credential is still forbidden from WRITING outside /courses/new and the
  // roster create API — see "lets a creator GET the add-course form" /
  // "lets a creator POST the create API" below, and the 403 case covered
  // directly in tests/auth/authorize.test.ts ('needs-capture').
  it('lets a creator read an edit surface (reads are free for any live grant)', async () => {
    expect((await middleware(reqFor('/capture/GC%201040', { cred: 'cufaculty:tigers' }))).status).toBe(200);
  });
  it('lets a creator read /program (reads are free for any live grant)', async () => {
    expect((await middleware(reqFor('/program', { cred: 'cufaculty:tigers' }))).status).toBe(200);
  });
  it('lets a creator GET the add-course form', async () => {
    expect((await middleware(reqFor('/courses/new', { cred: 'cufaculty:tigers' }))).status).toBe(200);
  });
  it('lets a creator POST the create API', async () => {
    expect((await middleware(reqFor('/api/admin/courses/roster', { method: 'POST', cred: 'cufaculty:tigers' }))).status).toBe(200);
  });
});

describe('middleware cookie ordering', () => {
  // Regression for Task 6 fix round 1: gate() can return BOTH setCookie
  // and clearCookie: true on the same result — a stale/dead session
  // cookie plus a fresh Basic-Auth login. NextResponse.cookies.set()
  // called twice with the same cookie name keeps only the LAST call, so
  // the two writes must be ordered clear-then-set; set-then-clear (the
  // brief's original snippet) silently clobbers the fresh cookie with
  // the empty/maxAge-0 clear.
  it('replaces a stale session cookie with a fresh one on successful Basic Auth, not clears it', async () => {
    vi.stubEnv('SESSION_SECRET', 'test-secret');
    const res = await middleware(reqFor('/capture/GC%201040', {
      cred: 'gcfaculty:godfrey',
      // Well-formed `<id>.<mac>` shape but a bad MAC — verifySession()
      // rejects it, so gate() treats the cookie as dead (clearCookie: true)
      // while the valid Basic Auth header still authorizes (setCookie).
      cookie: 'gc_session=some-stale-id.badmac',
    }));
    expect(res.status).toBe(200);
    const cookie = res.cookies.get('gc_session');
    expect(cookie).toBeDefined();
    expect(cookie!.value).not.toBe('');
    const fp = createHmac('sha256', 'test-secret').update('gcfaculty:godfrey').digest('hex').slice(0, 16);
    expect(cookie!.value.startsWith(`builtin:faculty:${fp}.`)).toBe(true);
    expect(cookie!.maxAge).toBeGreaterThan(0);
  });
  // Regression (final review tail): a pre-fix built-in cookie — the old id
  // shape `builtin:faculty` with NO fingerprint but a VALID MAC — is dead:
  // 401 with the cookie cleared, never honoured.
  it('old-shape builtin:faculty.<valid mac> cookie → 401 and cleared', async () => {
    vi.stubEnv('SESSION_SECRET', 'test-secret');
    const res = await middleware(reqFor('/capture/GC%201040', { cookie: `gc_session=${signSession('builtin:faculty', 'test-secret')}` }));
    expect(res.status).toBe(401);
    const cookie = res.cookies.get('gc_session');
    expect(cookie?.value).toBe('');
    expect(cookie?.maxAge).toBe(0);
  });
});
