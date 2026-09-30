import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

// I3b (2026-09-30 final review): the two matcher-excluded upload routes
// (/api/courses/<code>/materials and /imscc-import) authorize a scoped link
// holder through resolveScopedSession, which now also resolves a live
// gc_session cookie through the scope table.
vi.mock('@/lib/slug', () => ({ isValidSlug: () => false }));
vi.mock('@/lib/sandbox/sessions', () => ({
  lookupScopedSession: vi.fn(async () => null),
  SCOPED_SESSION_COOKIE: 'gc_sandbox_sess',
}));
vi.mock('@/lib/sandbox/grants', () => ({ getGrantById: vi.fn(), isGrantValid: () => false }));

const SECRET = 'y'.repeat(32);
const danita = { id: '11111111-1111-4111-8111-111111111111', label: 'Danita — GC 3730', scope: ['GC 3730'], can: ['capture'] as ('capture' | 'create' | 'admin')[], expiresAt: null as Date | null, revokedAt: null as Date | null, lastUsedAt: null };
const viewer = { ...danita, id: '33333333-3333-4333-8333-333333333333', label: 'viewer', can: [] as ('capture' | 'create' | 'admin')[] };
const findGrantById = vi.fn(async (id: string) => (id === danita.id ? danita : id === viewer.id ? viewer : null));
vi.mock('@/lib/auth/grants', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/grants')>('@/lib/auth/grants');
  return { ...actual, findGrantById: (id: string) => findGrantById(id) };
});

import { NextResponse } from 'next/server';
import { signSession } from '@/lib/auth/grants';
import { authorizeCourseWrite, resolveScopedSession } from '@/lib/sandbox/access';

const fp = (c: string) => createHmac('sha256', SECRET).update(c).digest('hex').slice(0, 16);
const cookieFor = (id: string) => `gc_session=${signSession(id, SECRET)}`;
const req = (path: string, cookie: string, method = 'POST') =>
  new Request(new URL(path, 'https://gcworkflow.clemson.edu:8443'), { method, headers: { cookie } });

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', SECRET);
  vi.stubEnv('FACULTY_BASIC_AUTH', 'gcfaculty:pw');
  findGrantById.mockClear();
});

describe('resolveScopedSession — gc_session on the matcher-excluded upload routes', () => {
  it.each(['materials', 'imscc-import'])('in-scope capture grant → bound to the route code (%s)', async seg => {
    const r = req(`/api/courses/GC%203730/${seg}`, cookieFor(danita.id));
    expect(await resolveScopedSession(r)).toEqual({ courseCode: 'GC 3730', instructorName: danita.label });
    expect(await authorizeCourseWrite(r, 'GC 3730', 'not-the-slug')).toBe(true);
  });
  it('DELETE on /materials (bulk wipe) is a course write too', async () =>
    expect(await resolveScopedSession(req('/api/courses/GC%203730/materials', cookieFor(danita.id), 'DELETE'))).toEqual({ courseCode: 'GC 3730', instructorName: danita.label }));
  it('out-of-scope course → null', async () =>
    expect(await resolveScopedSession(req('/api/courses/GC%201010/materials', cookieFor(danita.id)))).toBeNull());
  it('grant without capture → null', async () =>
    expect(await resolveScopedSession(req('/api/courses/GC%203730/materials', cookieFor(viewer.id)))).toBeNull());
  it('GET is not a write → null', async () =>
    expect(await resolveScopedSession(req('/api/courses/GC%203730/materials', cookieFor(danita.id), 'GET'))).toBeNull());
  it('only the two excluded upload routes — other paths → null', async () => {
    for (const p of ['/api/courses/GC%203730/kuds', '/api/capture/GC%203730/chat', '/api/courses/GC%203730/materials/', '/api/courses/GC%203730/materials/abc', '/api/courses/GC%203730/canvas-import'])
      expect(await resolveScopedSession(req(p, cookieFor(danita.id)))).toBeNull();
  });
  it('malformed code segment → null', async () =>
    expect(await resolveScopedSession(req('/api/courses/GC%203730%20/materials', cookieFor(danita.id)))).toBeNull());
  it('revoked grant → null', async () => {
    findGrantById.mockResolvedValueOnce({ ...danita, revokedAt: new Date('2026-01-01') });
    expect(await resolveScopedSession(req('/api/courses/GC%203730/materials', cookieFor(danita.id)))).toBeNull();
  });
  it('bad MAC → null', async () =>
    expect(await resolveScopedSession(req('/api/courses/GC%203730/materials', `gc_session=${danita.id}.bad`))).toBeNull());
  it('no SESSION_SECRET → null', async () => {
    vi.stubEnv('SESSION_SECRET', '');
    expect(await resolveScopedSession(req('/api/courses/GC%203730/materials', cookieFor(danita.id)))).toBeNull();
  });
  it('built-in faculty cookie follows the current credential (I1)', async () => {
    const good = req('/api/courses/GC%203730/materials', cookieFor(`builtin:faculty:${fp('gcfaculty:pw')}`));
    expect((await resolveScopedSession(good))?.courseCode).toBe('GC 3730');
    const rotated = req('/api/courses/GC%203730/materials', cookieFor(`builtin:faculty:${fp('gcfaculty:OLD')}`));
    expect(await resolveScopedSession(rotated)).toBeNull();
  });
  it('built-in cookie in the percent-encoded form Next writes and a browser sends back binds (tail round)', async () => {
    const res = NextResponse.next();
    res.cookies.set('gc_session', signSession(`builtin:faculty:${fp('gcfaculty:pw')}`, SECRET));
    const pair = (res.headers.get('set-cookie') ?? '').split(';')[0]!;
    expect(pair).toContain('builtin%3Afaculty%3A'); // proves the fixture is the encoded wire form
    const r = req('/api/courses/GC%203730/materials', pair);
    expect(await resolveScopedSession(r)).toEqual({ courseCode: 'GC 3730', instructorName: 'Department login' });
  });
  it('an undecodable cookie value is treated as absent', async () =>
    expect(await resolveScopedSession(req('/api/courses/GC%203730/materials', 'gc_session=%E0%A4%A.x'))).toBeNull());
  it('an unencoded uuid-grant cookie still binds', async () =>
    expect((await resolveScopedSession(req('/api/courses/GC%203730/materials', cookieFor(danita.id))))?.courseCode).toBe('GC 3730'));
  it('a request object without a url (headers only) → null', async () =>
    expect(await resolveScopedSession({ headers: { get: () => cookieFor(danita.id) } })).toBeNull());
  it('DB failure → null (fails closed, never a pass)', async () => {
    findGrantById.mockRejectedValueOnce(new Error('db down'));
    expect(await resolveScopedSession(req('/api/courses/GC%203730/materials', cookieFor(danita.id)))).toBeNull();
  });
});
