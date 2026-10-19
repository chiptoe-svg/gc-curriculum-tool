/**
 * Dead personal link (owner request 2026-10-19): a revoked / expired /
 * unrecognized ?key= on a gated page shows "This link is no longer active",
 * never the browser's department password box (no WWW-Authenticate).
 */
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { gate, type GateDeps } from '@/lib/auth/gate';
import { deadLinkPage } from '@/lib/auth/pages';
import { signSession, hashToken, type StoredGrant } from '@/lib/auth/grants';

const SECRET = 'x'.repeat(32);
const NOW = new Date('2026-10-19T12:00:00Z');
const base = { scope: ['GC 3730'], can: ['capture' as const], lastUsedAt: null };
const live: StoredGrant = { id: '11111111-1111-4111-8111-111111111111', label: 'Live Person', expiresAt: null, revokedAt: null, ...base };
const revoked: StoredGrant = { id: '22222222-2222-4222-8222-222222222222', label: 'Secret Person', expiresAt: null, revokedAt: new Date('2026-10-01T00:00:00Z'), ...base };
const expired: StoredGrant = { id: '44444444-4444-4444-8444-444444444444', label: 'Secret Person', expiresAt: new Date('2026-10-02T00:00:00Z'), revokedAt: null, ...base };
const byToken: Record<string, StoredGrant> = { tok_live: live, tok_revoked: revoked, tok_expired: expired };

function deps(env: Partial<GateDeps['env']> = {}): GateDeps {
  return {
    findGrantByToken: async t => Object.entries(byToken).find(([k]) => hashToken(k) === hashToken(t))?.[1] ?? null,
    findGrantById: async id => (id === live.id ? live : null),
    touch: async () => {},
    env: { sessionSecret: SECRET, faculty: 'gcfaculty:pw', creator: 'creator:pw', ...env },
    now: () => NOW,
  };
}
const req = (path: string, init: { cookie?: string; auth?: string } = {}) =>
  new NextRequest(new URL(path, 'https://gcworkflow.clemson.edu:8443'), {
    headers: { ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.auth ? { authorization: init.auth } : {}) },
  });
const basic = (s: string) => 'Basic ' + Buffer.from(s).toString('base64');
const liveCookie = `gc_session=${signSession(live.id, SECRET)}`;

async function deadPage(path: string, env: Partial<GateDeps['env']> = {}) {
  const r = await gate(req(path), deps(env));
  expect(r.kind).toBe('response');
  if (r.kind !== 'response') throw new Error('unreachable');
  expect(r.body).toContain('This link is no longer active');
  return r;
}

describe('dead ?key= on a gated page, no cookie, no Basic', () => {
  it.each([
    ['revoked', 'tok_revoked', 'has been turned off'],
    ['expired', 'tok_expired', 'has expired'],
    ['unknown', 'tok_bogus', 'wasn’t recognized'],
  ])('%s → 401 dead-link page, no WWW-Authenticate', async (_n, tok, wording) => {
    const r = await deadPage(`/capture?key=${tok}`);
    expect(r.status).toBe(401);
    expect(r.body).toContain('This link is no longer active');
    expect(r.body).toContain(wording);
    expect(Object.keys(r.headers).map(h => h.toLowerCase())).not.toContain('www-authenticate');
    expect(r.headers['Content-Type']).toContain('text/html');
  });
  it('also with DEPARTMENT_LOGIN=off (no challenge either way)', async () => {
    const r = await deadPage('/capture?key=tok_revoked', { departmentLogin: false });
    expect(r.status).toBe(401); expect(r.body).toContain('no longer active');
    expect(r.headers['WWW-Authenticate']).toBeUndefined();
  });
  it('invalid Basic credentials do not rescue it: still the dead-link page', async () => {
    const r = await gate(req('/capture?key=tok_revoked', { auth: basic('wrong:creds') }), deps());
    expect(r.kind).toBe('response');
    if (r.kind === 'response') { expect(r.headers['WWW-Authenticate']).toBeUndefined(); expect(r.body).toContain('This link is no longer active'); }
  });
  it('names the contact (SIGNIN_CONTACT) and never the grant label/id', async () => {
    const r = await deadPage('/capture?key=tok_revoked', { signinContact: 'help@example.edu' });
    expect(r.body).toContain('For a new link, contact help@example.edu.');
    expect(r.body).not.toContain('Secret Person');
    expect(r.body).not.toContain(revoked.id);
  });
  it('expired grant label never appears either', async () => {
    expect((await deadPage('/capture?key=tok_expired')).body).not.toContain('Secret Person');
  });
});

describe('dead ?key= where another credential authorizes', () => {
  it('valid Basic → proceeds as today', async () => {
    const r = await gate(req('/capture?key=tok_revoked', { auth: basic('gcfaculty:pw') }), deps());
    expect(['next', 'rewrite']).toContain(r.kind);
  });
  it('live personal cookie → proceeds as today', async () => {
    const r = await gate(req('/capture?key=tok_revoked', { cookie: liveCookie }), deps());
    expect(['next', 'rewrite']).toContain(r.kind);
  });
});

describe('dead ?key= and stale session cookies', () => {
  async function builtinCookie() {
    const login = await gate(req('/capture', { auth: basic('gcfaculty:pw') }), deps());
    if (login.kind !== 'next' && login.kind !== 'rewrite') throw new Error('login failed');
    return `gc_session=${login.setCookie!.value}`;
  }
  it('(a) real built-in cookie + dead key, department on → next', async () => {
    const r = await gate(req('/capture?key=tok_revoked', { cookie: await builtinCookie() }), deps());
    expect(r.kind).toBe('next');
  });
  it('(b) built-in cookie + dead key, DEPARTMENT_LOGIN=off → dead-link page, cookie cleared, no challenge', async () => {
    const r = await gate(req('/capture?key=tok_revoked', { cookie: await builtinCookie() }), deps({ departmentLogin: false }));
    expect(r.kind).toBe('response'); if (r.kind !== 'response') return;
    expect(r.body).toContain('This link is no longer active');
    expect(r.clearCookie).toBe(true);
    expect(r.headers['WWW-Authenticate']).toBeUndefined();
  });
  it('(c) dead personal cookie + dead key → dead-link page with clearCookie', async () => {
    const r = await gate(req('/capture?key=tok_revoked', { cookie: `gc_session=${signSession(revoked.id, SECRET)}` }), deps());
    expect(r.kind).toBe('response'); if (r.kind !== 'response') return;
    expect(r.body).toContain('This link is no longer active');
    expect(r.clearCookie).toBe(true);
    expect(r.headers['WWW-Authenticate']).toBeUndefined();
  });
  it('(c) forged cookie + dead key → dead-link page with clearCookie', async () => {
    const r = await gate(req('/capture?key=tok_revoked', { cookie: 'gc_session=forged.value' }), deps());
    expect(r.kind).toBe('response'); if (r.kind !== 'response') return;
    expect(r.body).toContain('This link is no longer active');
    expect(r.clearCookie).toBe(true);
  });
});

describe('visitor line', () => {
  it('links to the public course list and wiki, with or without department login', async () => {
    for (const env of [{}, { departmentLogin: false }]) {
      const b = (await deadPage('/capture?key=tok_revoked', env)).body;
      expect(b).toContain('<a href="/">course list</a>'); expect(b).toContain('<a href="/wiki">curriculum wiki</a>');
    }
  });
});

describe('unchanged behavior', () => {
  it('dead key on a public path → next', async () => {
    expect(await gate(req('/?key=tok_revoked'), deps())).toEqual({ kind: 'next' });
  });
  it('no key, department on → Basic challenge', async () => {
    const r = await gate(req('/capture'), deps());
    expect(r.kind).toBe('response');
    if (r.kind === 'response') { expect(r.status).toBe(401); expect(r.headers['WWW-Authenticate']).toContain('Basic realm='); }
  });
  it('no key, department off → sign-in page, no challenge', async () => {
    const r = await gate(req('/capture'), deps({ departmentLogin: false }));
    expect(r.kind).toBe('response');
    if (r.kind === 'response') { expect(r.body).toContain('Sign in with your link'); expect(r.headers['WWW-Authenticate']).toBeUndefined(); }
  });
  it('live key still exchanges for a redirect', async () => {
    expect((await gate(req('/capture?key=tok_live'), deps())).kind).toBe('redirect');
  });
  it('gated dead key with DB down → 503', async () => {
    const d = deps(); d.findGrantByToken = async () => { throw new Error('db'); };
    const r = await gate(req('/capture?key=tok_x'), d);
    expect(r.kind === 'response' && r.status).toBe(503);
  });
});

describe('the "department login" continue link', () => {
  const href = (body: string) => body.match(/<a href="([^"]*)">Sign in<\/a>/)?.[1];
  it('present when department on; no key param; relative', async () => {
    const r = await deadPage('/capture?course=GC%203730&key=tok_revoked&x=1');
    const h = href(r.body)!;
    expect(h).toBeDefined();
    expect(h.startsWith('/')).toBe(true); expect(h.startsWith('//')).toBe(false);
    expect(h).not.toMatch(/[?&]key=/);
    expect(h).toContain('x=1');
    expect(r.body).toContain('Have the department login?');
  });
  it('bare path when key was the only param', async () => {
    expect(href((await deadPage('/capture?key=tok_revoked')).body)).toBe('/capture');
  });
  it('absent when department off', async () => {
    const r = await deadPage('/capture?key=tok_revoked', { departmentLogin: false });
    expect(r.body).not.toContain('department login'); expect(r.body).not.toContain('>Sign in<');
  });
  it('a // path cannot become protocol-relative', async () => {
    const r = await gate(new NextRequest(new URL('https://gcworkflow.clemson.edu:8443//evil.example/capture?key=tok_revoked')), deps());
    expect(r.kind).toBe('response');
    if (r.kind === 'response') expect(href(r.body)!.startsWith('//')).toBe(false);
  });
  it('page escapes a continue URL containing quotes and angle brackets', () => {
    const body = deadLinkPage('revoked', 'help@example.edu', '/x?a="><script>alert(1)</script>');
    expect(body).not.toContain('<script>'); expect(body).not.toContain('a="><');
    expect(body).toContain('&quot;&gt;&lt;script&gt;');
  });
  it('page escapes the contact', () => {
    expect(deadLinkPage('unknown', '<b>x</b>', null)).not.toContain('<b>');
  });
  it('page omits the continue link when none is given', () => {
    expect(deadLinkPage('expired', 'a@b.c', null)).not.toContain('Have the department login?');
  });
});
