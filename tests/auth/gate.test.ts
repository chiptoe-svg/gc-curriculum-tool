import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { gate, type GateDeps } from '@/lib/auth/gate';
import { signSession, hashToken, type StoredGrant } from '@/lib/auth/grants';

const SECRET = 'x'.repeat(32), SLUG = 'prototypeslug123';
const danita: StoredGrant = { id: '11111111-1111-4111-8111-111111111111', label: 'Danita — GC 3730', scope: ['GC 3730'], can: ['capture'], expiresAt: null, revokedAt: null, lastUsedAt: null };
const marcus: StoredGrant = { id: '22222222-2222-4222-8222-222222222222', label: 'Marcus — GC 4400', scope: ['GC 4400'], can: ['capture'], expiresAt: null, revokedAt: null, lastUsedAt: null };
const TOKEN = 'tok_danita';
const OTHER_TOKEN = 'tok_marcus';
function deps(over: Partial<GateDeps> = {}): GateDeps {
  return {
    findGrantByToken: async t => {
      if (hashToken(t) === hashToken(TOKEN)) return danita;
      if (hashToken(t) === hashToken(OTHER_TOKEN)) return marcus;
      return null;
    },
    findGrantById: async id => (id === danita.id ? danita : id === marcus.id ? marcus : null),
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
  it('public path with key and DB down → next', async () => {
    const d = deps({ findGrantByToken: async () => { throw new Error('db down'); } });
    expect(await gate(req('/?key=x'), d)).toEqual({ kind: 'next' });
  });
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
  it('key on an API path is ignored', async () => {
    const noCookie = await gate(req(`/api/capture/GC%203730/context?key=${TOKEN}`), deps());
    expect(noCookie.kind).toBe('response'); if (noCookie.kind === 'response') expect(noCookie.status).toBe(401);
    const cookie = `gc_session=${signSession(danita.id, SECRET)}`;
    const withCookie = await gate(req(`/api/capture/GC%203730/context?key=${TOKEN}`, { cookie }), deps());
    expect(withCookie.kind).toBe('next');
  });
  it('key on a POST is ignored', async () => {
    const r = await gate(req(`/courses/new?key=${TOKEN}`, { method: 'POST' }), deps());
    expect(r.kind).toBe('response'); if (r.kind === 'response') expect(r.status).toBe(401);
  });
  it('key does not replace a live session', async () => {
    const cookie = `gc_session=${signSession(danita.id, SECRET)}`;
    const r = await gate(req(`/?key=${OTHER_TOKEN}`, { cookie }), deps());
    expect(r).toEqual({ kind: 'next' });
  });
  it('gated path with key and DB down → 503', async () => {
    const d = deps({ findGrantByToken: async () => { throw new Error('db down'); } });
    const r = await gate(req('/courses?key=x'), d);
    expect(r.kind).toBe('response'); if (r.kind === 'response') expect(r.status).toBe(503);
  });
  it('redirect uses publicOrigin', async () => {
    const d = deps({ env: { sessionSecret: SECRET, faculty: 'gcfaculty:pw', creator: 'creator:pw', slug: SLUG, publicOrigin: 'https://gcworkflow.clemson.edu:8443' } });
    const localReq = new NextRequest(new URL(`/?key=${TOKEN}`, 'http://localhost:3000'));
    const r = await gate(localReq, d);
    expect(r.kind).toBe('redirect'); if (r.kind !== 'redirect') return;
    expect(r.url.origin).toBe('https://gcworkflow.clemson.edu:8443');
    expect(r.url.pathname).toBe('/');
    expect(r.url.searchParams.has('key')).toBe(false);
  });
  it('stale cookie + Basic → cookie replaced', async () => {
    const r = await gate(req('/admin', { cookie: 'gc_session=' + danita.id + '.bad', auth: basic('gcfaculty:pw') }), deps());
    expect(r.kind).toBe('rewrite'); if (r.kind !== 'rewrite') return;
    expect(r.setCookie?.value.startsWith('builtin:faculty.')).toBe(true);
    expect(r.clearCookie).toBe(true);
  });
  it('touch that throws synchronously does not 503', async () => {
    const cookie = `gc_session=${signSession(danita.id, SECRET)}`;
    const d = deps({ touch: () => { throw new Error('x'); } });
    const r = await gate(req('/courses', { cookie }), d);
    expect(r.kind).toBe('rewrite');
  });
  it('redirect never leaves the public origin', async () => {
    const d = deps({ env: { sessionSecret: SECRET, faculty: 'gcfaculty:pw', creator: 'creator:pw', slug: SLUG, publicOrigin: 'https://gcworkflow.clemson.edu:8443' } });
    for (const evilPath of [`https://gcworkflow.clemson.edu:8443//evil.com/?key=${TOKEN}`, `https://gcworkflow.clemson.edu:8443/\\evil.com/?key=${TOKEN}`]) {
      const r = await gate(req(evilPath), d);
      expect(r.kind).toBe('redirect'); if (r.kind !== 'redirect') continue;
      expect(r.url.origin).toBe('https://gcworkflow.clemson.edu:8443');
      expect(r.url.hostname).toBe('gcworkflow.clemson.edu');
    }
  });
  it('live cookie plus another grant’s key on a GATED path', async () => {
    const cookie = `gc_session=${signSession(danita.id, SECRET)}`;
    const r = await gate(req(`/courses?key=${OTHER_TOKEN}`, { cookie }), deps());
    expect(r.kind).toBe('rewrite'); if (r.kind !== 'rewrite') return;
    expect(r.setCookie).toBeUndefined();
  });
});

describe('gated paths — ?slug= is inert', () => {
  it('legacy ?slug= is not a credential', async () => {
    const r = await gate(req(`/courses?slug=${SLUG}`), deps());
    expect(r.kind).toBe('response'); if (r.kind !== 'response') return;
    expect(r.status).toBe(401);
  });
  it('a scoped cookie plus ?slug= never upgrades', async () => {
    const cookie = `gc_session=${signSession(danita.id, SECRET)}`;
    const p = await gate(req(`/program?slug=${SLUG}`, { cookie }), deps());
    expect(p.kind).toBe('next'); if (p.kind === 'next') expect(p.setCookie).toBeUndefined();
    const w = await gate(req(`/api/capture/GC%201010/conversation?slug=${SLUG}`, { cookie, method: 'POST' }), deps());
    expect(w.kind).toBe('response'); if (w.kind === 'response') expect(w.status).toBe(403);
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
