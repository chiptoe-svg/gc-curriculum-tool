// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRevokeGrant = vi.fn();
const mockAdminAuth = vi.fn();

vi.mock('@/lib/auth/admin-auth', () => ({ checkAdminAuth: (...a: unknown[]) => mockAdminAuth(...a) }));
vi.mock('@/lib/auth/grant-admin', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/grant-admin')>('@/lib/auth/grant-admin');
  return { ...actual, revokeGrant: (...a: unknown[]) => mockRevokeGrant(...a) };
});

import { POST } from '../route';

function call(body: Record<string, unknown> = {}) {
  const req = new Request('http://h/api/admin/access/g1/revoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return POST(req, { params: Promise.resolve({ id: 'g1' }) });
}

beforeEach(() => { vi.clearAllMocks(); mockAdminAuth.mockReturnValue(true); });

describe('POST /api/admin/access/[id]/revoke', () => {
  it('401s when the admin second factor fails, and never revokes', async () => {
    mockAdminAuth.mockReturnValue(false);
    const res = await call();
    expect(res.status).toBe(401);
    expect(mockRevokeGrant).not.toHaveBeenCalled();
  });

  it('404s when the grant does not exist', async () => {
    mockRevokeGrant.mockResolvedValue('not-found');
    const res = await call();
    expect(res.status).toBe(404);
  });

  it('revokes and is idempotent on a second call', async () => {
    mockRevokeGrant.mockResolvedValue('ok');
    const res1 = await call();
    expect(res1.status).toBe(200);
    expect(res1.headers.get('cache-control')).toBe('no-store');
    const res2 = await call();
    expect(res2.status).toBe(200);
    expect(mockRevokeGrant).toHaveBeenCalledTimes(2);
    expect(mockRevokeGrant).toHaveBeenCalledWith('g1');
  });
});
