// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreateGrant = vi.fn();
const mockListGrantsForAdmin = vi.fn();
const mockListCourses = vi.fn();
const mockAdminAuth = vi.fn();

vi.mock('@/lib/auth/admin-auth', () => ({ checkAdminAuth: (...a: unknown[]) => mockAdminAuth(...a) }));
vi.mock('@/lib/db/courses-queries', () => ({ listCourses: (...a: unknown[]) => mockListCourses(...a) }));
vi.mock('@/lib/auth/grant-admin', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/grant-admin')>('@/lib/auth/grant-admin');
  return { ...actual, createGrant: (...a: unknown[]) => mockCreateGrant(...a), listGrantsForAdmin: (...a: unknown[]) => mockListGrantsForAdmin(...a) };
});

import { GET, POST } from '../route';

function req(path: string, init?: RequestInit) {
  return new Request(path, init);
}
function postReq(body: Record<string, unknown>) {
  return req('http://h/api/admin/access', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockReturnValue(true);
  mockListCourses.mockResolvedValue([{ code: 'GC 3730', title: 'Account Management' }, { code: 'GC 1010', title: 'Intro' }]);
});

describe('GET /api/admin/access', () => {
  it('401s when the admin second factor fails', async () => {
    mockAdminAuth.mockReturnValue(false);
    const res = await GET(req('http://h/api/admin/access'));
    expect(res.status).toBe(401);
    expect(mockListGrantsForAdmin).not.toHaveBeenCalled();
  });

  it('lists grants, never leaking tokenHash, with no-store', async () => {
    mockListGrantsForAdmin.mockResolvedValue([
      { id: 'g1', label: 'Danita', email: 'd@x.edu', scope: ['GC 3730'], can: ['capture'], expiresAt: null, revokedAt: null, createdAt: new Date(), lastUsedAt: null, status: 'active' },
    ]);
    const res = await GET(req('http://h/api/admin/access?slug=s'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    expect(text).not.toMatch(/tokenHash/i);
    const json = JSON.parse(text) as { grants: unknown[] };
    expect(json.grants).toHaveLength(1);
  });
});

describe('POST /api/admin/access', () => {
  it('415s a non-JSON content-type (the simple-form CSRF vector), and never mints (fix round 1, M2)', async () => {
    const res = await POST(req('http://h/api/admin/access', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ label: 'X', courses: '*', canCreate: false }) }));
    expect(res.status).toBe(415);
    expect(mockCreateGrant).not.toHaveBeenCalled();
    expect(mockAdminAuth).not.toHaveBeenCalled();
  });

  it('401s when the admin second factor fails, and never mints', async () => {
    mockAdminAuth.mockReturnValue(false);
    const res = await POST(postReq({ label: 'X', courses: '*', canCreate: false, slug: 'bad' }));
    expect(res.status).toBe(401);
    expect(mockCreateGrant).not.toHaveBeenCalled();
  });

  it('400s on a missing/blank label', async () => {
    const res = await POST(postReq({ label: '  ', courses: '*', canCreate: false }));
    expect(res.status).toBe(400);
    expect(mockCreateGrant).not.toHaveBeenCalled();
  });

  it('400s on a malformed email', async () => {
    const res = await POST(postReq({ label: 'X', email: 'not an email', courses: '*', canCreate: false }));
    expect(res.status).toBe(400);
    expect(mockCreateGrant).not.toHaveBeenCalled();
  });

  it('400s on an unknown course code, naming it', async () => {
    const res = await POST(postReq({ label: 'X', courses: ['GC 9999'], canCreate: false }));
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toMatch(/GC 9999/);
    expect(mockCreateGrant).not.toHaveBeenCalled();
  });

  it('400s on a malformed expiresAt', async () => {
    const res = await POST(postReq({ label: 'X', courses: '*', canCreate: false, expiresAt: 'not-a-date' }));
    expect(res.status).toBe(400);
  });

  it('creates a grant and returns the link exactly once, with the token only in this response', async () => {
    mockCreateGrant.mockResolvedValue({ id: 'g1', token: 'tok123', label: 'X', email: null, scope: ['*'], can: ['capture'], expiresAt: null, revokedAt: null, createdAt: new Date(), lastUsedAt: null, status: 'active' });
    const res = await POST(postReq({ label: 'X', courses: '*', canCreate: false }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const json = await res.json() as { grant: Record<string, unknown>; link: string };
    expect(json.link).toContain('?key=tok123');
    expect(json.grant).not.toHaveProperty('token');
    expect(mockCreateGrant).toHaveBeenCalledWith({ label: 'X', email: null, scope: ['*'], can: ['capture'], expiresAt: null });
  });

  it('never produces can:["admin"], no matter what the body claims', async () => {
    mockCreateGrant.mockResolvedValue({ id: 'g1', token: 'tok123', label: 'X', email: null, scope: ['*'], can: ['capture', 'create'], expiresAt: null, revokedAt: null, createdAt: new Date(), lastUsedAt: null, status: 'active' });
    // A hostile body: an explicit `can` array, `canCreate: 'admin'`, admin-ish scope.
    await POST(postReq({ label: 'X', courses: '*', canCreate: true, can: ['admin'], admin: true }));
    const sentCan = (mockCreateGrant.mock.calls[0]![0] as { can: string[] }).can;
    expect(sentCan).not.toContain('admin');
    expect(sentCan).toEqual(['capture', 'create']);
  });

  it('honors "All courses" (courses: "*") as the wildcard scope', async () => {
    mockCreateGrant.mockResolvedValue({ id: 'g1', token: 'tok123', label: 'X', email: null, scope: ['*'], can: ['capture'], expiresAt: null, revokedAt: null, createdAt: new Date(), lastUsedAt: null, status: 'active' });
    await POST(postReq({ label: 'X', courses: '*', canCreate: false }));
    expect(mockCreateGrant).toHaveBeenCalledWith(expect.objectContaining({ scope: ['*'] }));
  });
});
