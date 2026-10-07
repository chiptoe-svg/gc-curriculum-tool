// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockReissueGrant = vi.fn();
const mockAdminAuth = vi.fn();

vi.mock('@/lib/auth/admin-auth', () => ({ checkAdminAuth: (...a: unknown[]) => mockAdminAuth(...a) }));
vi.mock('@/lib/auth/grant-admin', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/grant-admin')>('@/lib/auth/grant-admin');
  return { ...actual, reissueGrant: (...a: unknown[]) => mockReissueGrant(...a) };
});

import { POST } from '../route';

const VALID_ID = '123e4567-e89b-12d3-a456-426614174000';

function call(body: Record<string, unknown> = {}, id = VALID_ID, contentType = 'application/json') {
  const req = new Request(`http://h/api/admin/access/${id}/reissue`, { method: 'POST', headers: { 'content-type': contentType }, body: JSON.stringify(body) });
  return POST(req, { params: Promise.resolve({ id }) });
}

beforeEach(() => { vi.clearAllMocks(); mockAdminAuth.mockReturnValue(true); });

describe('POST /api/admin/access/[id]/reissue', () => {
  it('415s a non-JSON content-type, before even checking auth (fix round 1, M2)', async () => {
    const res = await call({}, VALID_ID, 'text/plain');
    expect(res.status).toBe(415);
    expect(mockAdminAuth).not.toHaveBeenCalled();
    expect(mockReissueGrant).not.toHaveBeenCalled();
  });

  it('401s when the admin second factor fails, and never reissues', async () => {
    mockAdminAuth.mockReturnValue(false);
    const res = await call();
    expect(res.status).toBe(401);
    expect(mockReissueGrant).not.toHaveBeenCalled();
  });

  it('400s a malformed id before any query (fix round 1, L3)', async () => {
    const res = await call({}, 'g1');
    expect(res.status).toBe(400);
    expect(mockReissueGrant).not.toHaveBeenCalled();
  });

  it('404s when the grant does not exist', async () => {
    mockReissueGrant.mockResolvedValue('not-found');
    const res = await call();
    expect(res.status).toBe(404);
  });

  it('409s (already revoked) — double reissue / stale-tab reissue of a revoked id (fix round 1, M1)', async () => {
    mockReissueGrant.mockResolvedValue('revoked');
    const res = await call();
    expect(res.status).toBe(409);
    const json = await res.json() as { error: string };
    expect(json.error).toMatch(/revoked/i);
  });

  it('409s (admin-managed) a CLI admin grant, with a command-line note (fix round 1, L1)', async () => {
    mockReissueGrant.mockResolvedValue('admin-managed');
    const res = await call();
    expect(res.status).toBe(409);
    const json = await res.json() as { error: string };
    expect(json.error).toMatch(/command line/i);
  });

  it('409s (expired) rather than handing back a dead-on-arrival link (fix round 1, L5)', async () => {
    mockReissueGrant.mockResolvedValue('expired');
    const res = await call();
    expect(res.status).toBe(409);
    const json = await res.json() as { error: string };
    expect(json.error).toMatch(/expired/i);
  });

  it('returns the new grant + a one-time link, with no-store', async () => {
    mockReissueGrant.mockResolvedValue({
      grant: { id: 'g2', label: 'Danita', email: 'd@x.edu', scope: ['GC 3730'], can: ['capture'], expiresAt: null, revokedAt: null, createdAt: new Date(), lastUsedAt: null, status: 'active' },
      token: 'newtok',
    });
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const json = await res.json() as { grant: Record<string, unknown>; link: string };
    expect(json.link).toContain('?key=newtok');
    expect(json.grant.id).toBe('g2');
    expect(json.grant).not.toHaveProperty('token');
    expect(mockReissueGrant).toHaveBeenCalledWith(VALID_ID);
  });
});
