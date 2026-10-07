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

function call(body: Record<string, unknown> = {}) {
  const req = new Request('http://h/api/admin/access/g1/reissue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return POST(req, { params: Promise.resolve({ id: 'g1' }) });
}

beforeEach(() => { vi.clearAllMocks(); mockAdminAuth.mockReturnValue(true); });

describe('POST /api/admin/access/[id]/reissue', () => {
  it('401s when the admin second factor fails, and never reissues', async () => {
    mockAdminAuth.mockReturnValue(false);
    const res = await call();
    expect(res.status).toBe(401);
    expect(mockReissueGrant).not.toHaveBeenCalled();
  });

  it('404s when the grant does not exist', async () => {
    mockReissueGrant.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
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
    expect(mockReissueGrant).toHaveBeenCalledWith('g1');
  });
});
