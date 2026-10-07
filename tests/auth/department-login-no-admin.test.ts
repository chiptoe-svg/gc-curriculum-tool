/**
 * FIX 2 (owner-approved, 2026-10-07): the shared department login
 * (lib/auth/grants.ts builtinGrant('faculty', …)) no longer carries the
 * 'admin' capability — the owner now holds a personal admin-capable access
 * grant for the operator-only surfaces. This exercises the real gate()/
 * authorize() path with fake grants, the same way tests/auth/gate.test.ts
 * does, to pin:
 *   - the department login can no longer reach /admin or POST
 *     /api/admin/v2-reset (403)
 *   - it can still capture/ingest/reset any course via the new
 *     course-scoped routes
 *   - a scoped grant can ingest/reset only its own course (403 elsewhere)
 *   - a grant that still carries 'admin' (e.g. the owner's personal grant)
 *     still reaches /admin
 */
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { gate, type GateDeps } from '@/lib/auth/gate';
import { authorize, classify } from '@/lib/auth/authorize';
import { signSession, hashToken, builtinGrant, type StoredGrant } from '@/lib/auth/grants';

const SECRET = 'x'.repeat(32), SLUG = 'prototypeslug123';

// Scoped grant bound to one course — same shape as tests/auth/gate.test.ts's danita.
const danita: StoredGrant = {
  id: '11111111-1111-4111-8111-111111111111',
  label: 'Danita — GC 3730',
  scope: ['GC 3730'],
  can: ['capture'],
  expiresAt: null, revokedAt: null, lastUsedAt: null,
};
// A personal grant that DOES carry admin (the owner's own grant, per the fix).
const ownerAdmin: StoredGrant = {
  id: '33333333-3333-4333-8333-333333333333',
  label: 'Owner — admin',
  scope: ['*'],
  can: ['capture', 'create', 'admin'],
  expiresAt: null, revokedAt: null, lastUsedAt: null,
};

function deps(over: Partial<GateDeps> = {}): GateDeps {
  return {
    findGrantByToken: async t => (hashToken(t) === hashToken('tok') ? danita : null),
    findGrantById: async id =>
      id === danita.id ? danita : id === ownerAdmin.id ? ownerAdmin : null,
    touch: async () => {},
    env: { sessionSecret: SECRET, faculty: 'gcfaculty:pw', creator: 'creator:pw', slug: SLUG },
    now: () => new Date('2026-10-07T12:00:00Z'),
    ...over,
  };
}
const req = (path: string, init: { method?: string; cookie?: string; auth?: string } = {}) =>
  new NextRequest(new URL(path, 'https://gcworkflow.clemson.edu:8443'), {
    method: init.method ?? 'GET',
    headers: { ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.auth ? { authorization: init.auth } : {}) },
  });
const basic = (s: string) => 'Basic ' + Buffer.from(s).toString('base64');

describe('builtinGrant(faculty) no longer carries admin', () => {
  it('can is capture + create only', () => {
    const g = builtinGrant('faculty', 'gcfaculty:pw', SECRET);
    expect(g.can).toEqual(['capture', 'create']);
    expect(g.can).not.toContain('admin');
  });
});

describe('department login (Basic faculty) through the real gate', () => {
  it('GET /admin → 403, not allowed', async () => {
    const r = await gate(req('/admin', { auth: basic('gcfaculty:pw') }), deps());
    expect(r.kind).toBe('response');
    if (r.kind === 'response') expect(r.status).toBe(403);
  });

  it('POST /api/admin/v2-reset → 403', async () => {
    const r = await gate(req('/api/admin/v2-reset', { auth: basic('gcfaculty:pw'), method: 'POST' }), deps());
    expect(r.kind).toBe('response');
    if (r.kind === 'response') expect(r.status).toBe(403);
  });

  it('can still ingest any course via the new course-scoped route', async () => {
    const r = await gate(req('/api/capture/GC%201010/ingest', { auth: basic('gcfaculty:pw'), method: 'POST' }), deps());
    expect(r.kind).toBe('next');
  });

  it('can still reset any course via the new course-scoped route', async () => {
    const r = await gate(req('/api/capture/GC%204400/reset', { auth: basic('gcfaculty:pw'), method: 'POST' }), deps());
    expect(r.kind).toBe('next');
  });
});

describe('scoped grant (capture-only, bound to one course)', () => {
  const cookie = `gc_session=${signSession(danita.id, SECRET)}`;

  it('can ingest its own course', async () => {
    const r = await gate(req('/api/capture/GC%203730/ingest', { cookie, method: 'POST' }), deps());
    expect(r.kind).toBe('next');
  });

  it('can reset its own course', async () => {
    const r = await gate(req('/api/capture/GC%203730/reset', { cookie, method: 'POST' }), deps());
    expect(r.kind).toBe('next');
  });

  it('403s trying to ingest another course', async () => {
    const r = await gate(req('/api/capture/GC%201010/ingest', { cookie, method: 'POST' }), deps());
    expect(r.kind).toBe('response');
    if (r.kind === 'response') expect(r.status).toBe(403);
  });

  it('403s trying to reset another course', async () => {
    const r = await gate(req('/api/capture/GC%201010/reset', { cookie, method: 'POST' }), deps());
    expect(r.kind).toBe('response');
    if (r.kind === 'response') expect(r.status).toBe(403);
  });

  it('classify() agrees these are course-write, not admin', () => {
    expect(classify('POST', '/api/capture/GC 3730/ingest')).toEqual({ kind: 'course-write', code: 'GC 3730' });
    expect(classify('POST', '/api/capture/GC 3730/reset')).toEqual({ kind: 'course-write', code: 'GC 3730' });
  });

  it('403s reaching /admin', async () => {
    const r = await gate(req('/admin', { cookie }), deps());
    expect(r.kind).toBe('response');
    if (r.kind === 'response') expect(r.status).toBe(403);
  });
});

describe('a grant that still carries admin (the owner\'s personal grant)', () => {
  const cookie = `gc_session=${signSession(ownerAdmin.id, SECRET)}`;

  it('reaches /admin', async () => {
    const r = await gate(req('/admin', { cookie }), deps());
    expect(r.kind).toBe('rewrite');
  });

  it('can POST /api/admin/v2-reset', async () => {
    const r = await gate(req('/api/admin/v2-reset', { cookie, method: 'POST' }), deps());
    expect(r.kind).toBe('next');
  });

  it('authorize() confirms admin kind is allowed for this grant', () => {
    expect(authorize(ownerAdmin, 'POST', '/api/admin/v2-reset')).toEqual({ ok: true });
    expect(authorize(ownerAdmin, 'GET', '/admin')).toEqual({ ok: true });
  });
});
