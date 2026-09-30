import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { gate, type GateDeps } from '@/lib/auth/gate';
import { signSession, hashToken, type StoredGrant } from '@/lib/auth/grants';

const SECRET = 'x'.repeat(32), SLUG = 'prototypeslug123';
const danita: StoredGrant = { id: '11111111-1111-4111-8111-111111111111', label: 'Danita — GC 3730', scope: ['GC 3730'], can: ['capture'], expiresAt: null, revokedAt: null, lastUsedAt: null };
const TOKEN = 'tok_danita';
function deps(over: Partial<GateDeps> = {}): GateDeps {
  return {
    findGrantByToken: async t => (hashToken(t) === hashToken(TOKEN) ? danita : null),
    findGrantById: async id => (id === danita.id ? danita : null),
    touch: async () => {},
    env: { sessionSecret: SECRET, faculty: 'gcfaculty:pw', creator: 'creator:pw', slug: SLUG },
    now: () => new Date('2026-09-30T12:00:00Z'),
    ...over,
  };
}
const req = (path: string, init: { method?: string; cookie?: string; auth?: string } = {}) =>
  new NextRequest(new URL(path, 'https://gcworkflow.clemson.edu:8443'), {
    method: init.method ?? 'GET',
    headers: { ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.auth ? { authorization: init.auth } : {}) },
  });
const basic = (s: string) => 'Basic ' + Buffer.from(s).toString('base64');

describe('public paths', () => {
  it('pass through untouched', async () => expect(await gate(req('/view/GC%201010'), deps())).toEqual({ kind: 'next' }));
  it('exchange ?key= for a cookie and redirect clean even on /', async () => {
    const r = await gate(req(`/?key=${TOKEN}`), deps());
    expect(r.kind).toBe('redirect');
    if (r.kind !== 'redirect') return;
    expect(r.url.pathname).toBe('/'); expect(r.url.searchParams.has('key')).toBe(false);
    expect(r.setCookie.name).toBe('gc_session'); expect(r.setCookie.value.startsWith(danita.id + '.')).toBe(true);
  });
  it('ignore a dead key on a public path', async () =>
    expect(await gate(req('/?key=nope'), deps())).toEqual({ kind: 'next' }));
});

describe('gated paths — resolution order', () => {
  it('no credential → 401 page with the Basic challenge', async () => {
    const r = await gate(req('/courses'), deps());
    expect(r.kind).toBe('response'); if (r.kind !== 'response') return;
    expect(r.status).toBe(401); expect(r.headers['WWW-Authenticate']).toContain('Basic realm=');
    expect(r.body).toContain('open the access link');
  });
  it('valid cookie → rewrite with ?slug= for pages, next for APIs', async () => {
    const cookie = `gc_session=${signSession(danita.id, SECRET)}`;
    const p = await gate(req('/capture/GC%203730', { cookie }), deps());
    expect(p.kind).toBe('rewrite'); if (p.kind === 'rewrite') expect(p.url.searchParams.get('slug')).toBe(SLUG);
    const a = await gate(req('/api/capture/GC%203730/context', { cookie }), deps());
    expect(a.kind).toBe('next');
  });
  it('legacy ?slug= link still works and is exchanged for a cookie', async () => {
    const r = await gate(req(`/courses?slug=${SLUG}`), deps());
    expect(r.kind).toBe('redirect'); if (r.kind !== 'redirect') return;
    expect(r.setCookie.value.startsWith('builtin:faculty.')).toBe(true);
    expect(r.url.searchParams.has('slug')).toBe(false);
  });
  it('tampered cookie → treated as absent (401 + clear)', async () => {
    const r = await gate(req('/courses', { cookie: 'gc_session=' + danita.id + '.bad' }), deps());
    expect(r.kind).toBe('response'); if (r.kind === 'response') { expect(r.status).toBe(401); expect(r.clearCookie).toBe(true); }
  });
  it('revoked grant behind a valid cookie → 401 + clear', async () => {
    const d = deps({ findGrantById: async () => ({ ...danita, revokedAt: new Date('2026-09-29T00:00:00Z') }) });
    const r = await gate(req('/courses', { cookie: `gc_session=${signSession(danita.id, SECRET)}` }), d);
    expect(r.kind).toBe('response'); if (r.kind === 'response') { expect(r.status).toBe(401); expect(r.clearCookie).toBe(true); }
  });
  it('Basic faculty → allowed and a cookie is set', async () => {
    const r = await gate(req('/admin', { auth: basic('gcfaculty:pw') }), deps());
    expect(r.kind).toBe('rewrite'); if (r.kind === 'rewrite') expect(r.setCookie?.value.startsWith('builtin:faculty.')).toBe(true);
  });
  it('no SESSION_SECRET → key still authorizes this request but no cookie is issued', async () => {
    const r = await gate(req(`/courses?key=${TOKEN}`), deps({ env: { faculty: 'gcfaculty:pw', slug: SLUG } }));
    expect(r.kind).toBe('rewrite'); if (r.kind === 'rewrite') expect(r.setCookie).toBeUndefined();
  });
});

describe('gated paths — authorization', () => {
  const cookie = `gc_session=${signSession(danita.id, SECRET)}`;
  it('write in scope → next', async () =>
    expect((await gate(req('/api/capture/GC%203730/chat', { cookie, method: 'POST' }), deps())).kind).toBe('next'));
  it('write out of scope → 403 page naming label and course', async () => {
    const r = await gate(req('/api/capture/GC%201010/chat', { cookie, method: 'POST' }), deps());
    expect(r.kind).toBe('response'); if (r.kind !== 'response') return;
    expect(r.status).toBe(403); expect(r.body).toContain('GC 1010'); expect(r.body).toContain('Danita');
  });
  it('unclassified write → 403 for a scoped grant, allowed for department', async () => {
    expect((await gate(req('/api/admin/synthesis', { cookie, method: 'POST' }), deps())).kind).toBe('response');
    expect((await gate(req('/api/admin/synthesis', { auth: basic('gcfaculty:pw'), method: 'POST' }), deps())).kind).toBe('next');
  });
  it('DB failure → 503, never a pass', async () => {
    const d = deps({ findGrantById: async () => { throw new Error('db down'); } });
    const r = await gate(req('/courses', { cookie }), d);
    expect(r.kind).toBe('response'); if (r.kind === 'response') expect(r.status).toBe(503);
  });
});
