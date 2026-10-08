/**
 * Retire the shared department password (spec 2026-10-08,
 * docs/superpowers/specs/2026-10-08-retire-shared-password-design.md).
 *
 * R1: a valid ?key= replaces a BUILT-IN ("Department login") session; a live
 *     PERSONAL session is still never swapped by a stray key.
 * R2: DEPARTMENT_LOGIN=off — Basic is never accepted, built-in cookies are
 *     dead (cleared), gated pages get the sign-in page (401, no
 *     WWW-Authenticate), gated APIs get 401 JSON (no WWW-Authenticate).
 * R3: the sign-in page text + SIGNIN_CONTACT.
 * R5: /board works for a personal admin grant with the switch on and off.
 */
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { createHmac } from 'node:crypto';
import { gate, type GateDeps } from '@/lib/auth/gate';
import { signSession, hashToken, type StoredGrant } from '@/lib/auth/grants';

const SECRET = 'x'.repeat(32), SLUG = 'prototypeslug123';
const fp = (cred: string) => createHmac('sha256', SECRET).update(cred).digest('hex').slice(0, 16);
const owner: StoredGrant = { id: '33333333-3333-4333-8333-333333333333', label: 'Chip Tonkin', scope: ['*'], can: ['capture', 'create', 'admin'], expiresAt: null, revokedAt: null, lastUsedAt: null };
const danita: StoredGrant = { id: '11111111-1111-4111-8111-111111111111', label: 'Danita — GC 3730', scope: ['GC 3730'], can: ['capture'], expiresAt: null, revokedAt: null, lastUsedAt: null };
const OWNER_TOKEN = 'tok_owner', DANITA_TOKEN = 'tok_danita';

function deps(env: Partial<GateDeps['env']> = {}): GateDeps {
  return {
    findGrantByToken: async t => (hashToken(t) === hashToken(OWNER_TOKEN) ? owner : hashToken(t) === hashToken(DANITA_TOKEN) ? danita : null),
    findGrantById: async id => (id === owner.id ? owner : id === danita.id ? danita : null),
    touch: async () => {},
    env: { sessionSecret: SECRET, faculty: 'gcfaculty:pw', creator: 'creator:pw', slug: SLUG, ...env },
    now: () => new Date('2026-10-08T12:00:00Z'),
  };
}
const OFF = { departmentLogin: false } as const;
const req = (path: string, init: { method?: string; cookie?: string; auth?: string } = {}) =>
  new NextRequest(new URL(path, 'https://gcworkflow.clemson.edu:8443'), {
    method: init.method ?? 'GET',
    headers: { ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.auth ? { authorization: init.auth } : {}) },
  });
const basic = (s: string) => 'Basic ' + Buffer.from(s).toString('base64');
const deptCookie = `gc_session=${signSession(`builtin:faculty:${fp('gcfaculty:pw')}`, SECRET)}`;
const ownerCookie = `gc_session=${signSession(owner.id, SECRET)}`;
const danitaCookie = `gc_session=${signSession(danita.id, SECRET)}`;

describe('R1 — a personal link replaces a department session (DEPARTMENT_LOGIN on)', () => {
  it('builtin cookie + valid ?key= on a gated page → redirect with the personal cookie', async () => {
    const r = await gate(req(`/admin/access?key=${OWNER_TOKEN}`, { cookie: deptCookie }), deps());
    expect(r.kind).toBe('redirect'); if (r.kind !== 'redirect') return;
    expect(r.setCookie.value.startsWith(owner.id + '.')).toBe(true);
    expect(r.url.pathname).toBe('/admin/access');
    expect(r.url.searchParams.has('key')).toBe(false);
  });
  it('builtin cookie + valid ?key= on the public / → redirect with the personal cookie', async () => {
    const r = await gate(req(`/?key=${OWNER_TOKEN}`, { cookie: deptCookie }), deps());
    expect(r.kind).toBe('redirect'); if (r.kind !== 'redirect') return;
    expect(r.setCookie.value.startsWith(owner.id + '.')).toBe(true);
  });
  it('builtin cookie + a dead ?key= → stays on the department session (no swap, no lockout)', async () => {
    const r = await gate(req('/courses?key=nope', { cookie: deptCookie }), deps());
    expect(r.kind).toBe('rewrite'); if (r.kind === 'rewrite') expect(r.setCookie).toBeUndefined();
  });
  it('a live PERSONAL session is never swapped by a stray ?key= (gated page)', async () => {
    const r = await gate(req(`/courses?key=${OWNER_TOKEN}`, { cookie: danitaCookie }), deps());
    expect(r.kind).toBe('rewrite'); if (r.kind === 'rewrite') expect(r.setCookie).toBeUndefined();
  });
  it('a live PERSONAL session is never swapped by a stray ?key= (public /)', async () => {
    expect(await gate(req(`/?key=${OWNER_TOKEN}`, { cookie: danitaCookie }), deps())).toEqual({ kind: 'next' });
  });
  it('unset departmentLogin = on: Basic still works', async () => {
    const r = await gate(req('/courses', { auth: basic('gcfaculty:pw') }), deps());
    expect(r.kind).toBe('rewrite');
  });
  it('on: no credential still gets the Basic challenge (today’s behavior)', async () => {
    const r = await gate(req('/courses'), deps({ departmentLogin: true }));
    expect(r.kind).toBe('response'); if (r.kind !== 'response') return;
    expect(r.status).toBe(401); expect(r.headers['WWW-Authenticate']).toContain('Basic realm=');
  });
});

describe('R2 — DEPARTMENT_LOGIN=off', () => {
  it('Basic faculty on a gated page → 401 sign-in page, no WWW-Authenticate, no cookie', async () => {
    const r = await gate(req('/courses', { auth: basic('gcfaculty:pw') }), deps(OFF));
    expect(r.kind).toBe('response'); if (r.kind !== 'response') return;
    expect(r.status).toBe(401);
    expect(Object.keys(r.headers).map(h => h.toLowerCase())).not.toContain('www-authenticate');
    expect(r.body).toContain('Sign in with your link');
  });
  it('Basic creator on the create API → 401 JSON, no WWW-Authenticate', async () => {
    const r = await gate(req('/api/admin/courses/roster', { method: 'POST', auth: basic('creator:pw') }), deps(OFF));
    expect(r.kind).toBe('response'); if (r.kind !== 'response') return;
    expect(r.status).toBe(401);
    expect(Object.keys(r.headers).map(h => h.toLowerCase())).not.toContain('www-authenticate');
    expect(r.headers['Content-Type']).toContain('application/json');
    expect(() => JSON.parse(r.body)).not.toThrow();
  });
  it('Basic faculty on a gated GET API → 401 JSON', async () => {
    const r = await gate(req('/api/capture/GC%203730/context', { auth: basic('gcfaculty:pw') }), deps(OFF));
    expect(r.kind).toBe('response'); if (r.kind === 'response') { expect(r.status).toBe(401); expect(r.headers['Content-Type']).toContain('application/json'); }
  });
  it('builtin cookie → treated as dead: 401 sign-in page + cookie cleared', async () => {
    const r = await gate(req('/courses', { cookie: deptCookie }), deps(OFF));
    expect(r.kind).toBe('response'); if (r.kind !== 'response') return;
    expect(r.status).toBe(401); expect(r.clearCookie).toBe(true);
    expect(r.body).toContain('Sign in with your link');
  });
  it('builtin cookie + Basic → still 401 (Basic never re-mints a department session)', async () => {
    const r = await gate(req('/courses', { cookie: deptCookie, auth: basic('gcfaculty:pw') }), deps(OFF));
    expect(r.kind).toBe('response'); if (r.kind === 'response') { expect(r.status).toBe(401); expect(r.clearCookie).toBe(true); }
  });
  it('builtin cookie + valid ?key= → redirect with the personal cookie', async () => {
    const r = await gate(req(`/courses?key=${DANITA_TOKEN}`, { cookie: deptCookie }), deps(OFF));
    expect(r.kind).toBe('redirect'); if (r.kind === 'redirect') expect(r.setCookie.value.startsWith(danita.id + '.')).toBe(true);
  });
  it('personal cookie still works', async () => {
    expect((await gate(req('/capture/GC%203730', { cookie: danitaCookie }), deps(OFF))).kind).toBe('rewrite');
    expect((await gate(req('/api/capture/GC%203730/chat', { cookie: danitaCookie, method: 'POST' }), deps(OFF))).kind).toBe('next');
  });
  it('no credential at all → sign-in page, 401, no WWW-Authenticate', async () => {
    const r = await gate(req('/program'), deps(OFF));
    expect(r.kind).toBe('response'); if (r.kind !== 'response') return;
    expect(r.status).toBe(401);
    expect(Object.keys(r.headers).map(h => h.toLowerCase())).not.toContain('www-authenticate');
  });
  it('fails closed with every credential env var unset', async () => {
    const d = deps({ departmentLogin: false, faculty: undefined, creator: undefined, sessionSecret: undefined });
    for (const path of ['/courses', '/admin', '/api/admin/courses/roster', '/board']) {
      const r = await gate(req(path, { auth: basic('gcfaculty:pw') }), d);
      expect(r.kind).toBe('response'); if (r.kind === 'response') expect(r.status).toBe(401);
    }
  });
});

describe('R3 — sign-in page', () => {
  it('default contact, no department password wording', async () => {
    const r = await gate(req('/courses'), deps(OFF));
    if (r.kind !== 'response') throw new Error('expected response');
    expect(r.body).toContain('Open the personal link in your invitation email. It signs in this browser.');
    expect(r.body).toContain('Email Chip Tonkin for a new one.');
    expect(r.body.toLowerCase()).not.toMatch(/department login|password/);
  });
  it('SIGNIN_CONTACT is used and escaped', async () => {
    const r = await gate(req('/courses'), deps({ departmentLogin: false, signinContact: 'Ann <ann@x.edu>' }));
    if (r.kind !== 'response') throw new Error('expected response');
    expect(r.body).toContain('Email Ann &lt;ann@x.edu&gt; for a new one.');
  });
});

describe('R5 — /board for the owner’s personal admin grant', () => {
  for (const departmentLogin of [true, false]) {
    it(`admin cookie reaches /board and a project page (departmentLogin=${departmentLogin})`, async () => {
      for (const path of ['/board', '/board/curriculum-developer', '/board/curriculum-developer/state.json']) {
        const r = await gate(req(path, { cookie: ownerCookie }), deps({ departmentLogin }));
        expect(['next', 'rewrite']).toContain(r.kind);
      }
    });
  }
  it('no credential → /board is not reachable (off)', async () => {
    const r = await gate(req('/board'), deps(OFF));
    expect(r.kind).toBe('response');
  });
});
