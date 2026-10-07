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

const VALID_ID = '123e4567-e89b-12d3-a456-426614174000';

function call(body: Record<string, unknown> = {}, id = VALID_ID, contentType = 'application/json') {
  const req = new Request(`http://h/api/admin/access/${id}/revoke`, { method: 'POST', headers: { 'content-type': contentType }, body: JSON.stringify(body) });
  return POST(req, { params: Promise.resolve({ id }) });
}

beforeEach(() => { vi.clearAllMocks(); mockAdminAuth.mockReturnValue(true); });

describe('POST /api/admin/access/[id]/revoke', () => {
  it('415s a non-JSON content-type, before even checking auth (fix round 1, M2)', async () => {
    const res = await call({}, VALID_ID, 'text/plain');
    expect(res.status).toBe(415);
    expect(mockAdminAuth).not.toHaveBeenCalled();
    expect(mockRevokeGrant).not.toHaveBeenCalled();
  });

  it('401s when the admin second factor fails, and never revokes', async () => {
    mockAdminAuth.mockReturnValue(false);
    const res = await call();
    expect(res.status).toBe(401);
    expect(mockRevokeGrant).not.toHaveBeenCalled();
  });

  it('400s a malformed id before any query (fix round 1, L3)', async () => {
    const res = await call({}, 'g1');
    expect(res.status).toBe(400);
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
    expect(mockRevokeGrant).toHaveBeenCalledWith(VALID_ID);
  });
});
