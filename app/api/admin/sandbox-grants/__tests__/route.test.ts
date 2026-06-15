import { describe, it, expect, vi, beforeEach } from 'vitest';
const mockCreate = vi.fn(); const mockList = vi.fn(); const mockRevoke = vi.fn();
vi.mock('@/lib/sandbox/grants', () => ({
  createGrant: (...a: unknown[]) => mockCreate(...a),
  listGrants: (...a: unknown[]) => mockList(...a),
  revokeGrant: (...a: unknown[]) => mockRevoke(...a),
}));
// Admin second factor: gate it via the real helper so we can exercise both
// authorized and unauthorized paths. Authorized = default true here.
const mockAdminAuth = vi.fn();
vi.mock('@/lib/auth/admin-auth', () => ({ checkAdminAuth: (...a: unknown[]) => mockAdminAuth(...a) }));
import { POST, GET, DELETE } from '../route';
beforeEach(() => { vi.clearAllMocks(); mockAdminAuth.mockReturnValue(true); });

function req(path = 'http://h/api/admin/sandbox-grants', init?: RequestInit) { return new Request(path, init); }

describe('admin sandbox-grants API', () => {
  it('POST mints a generic (course-less) grant with just a label', async () => {
    mockCreate.mockResolvedValue({ id: 'g1', token: 'tok', expiresAt: new Date() });
    const res = await POST(req('http://h/api/admin/sandbox-grants', { method: 'POST', body: JSON.stringify({ label: 'UGA pilot' }), headers: { 'content-type': 'application/json' } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ token: 'tok' });
    expect(mockCreate).toHaveBeenCalledWith({ label: 'UGA pilot' });
  });
  it('GET lists grants', async () => { mockList.mockResolvedValue([]); expect((await GET(req())).status).toBe(200); });
  it('DELETE revokes by id', async () => {
    mockRevoke.mockResolvedValue(undefined);
    const res = await DELETE(req('http://h/api/admin/sandbox-grants?id=g1', { method: 'DELETE' }));
    expect(res.status).toBe(200); expect(mockRevoke).toHaveBeenCalledWith('g1');
  });
  it('401s every handler when the admin second factor fails', async () => {
    mockAdminAuth.mockReturnValue(false);
    expect((await POST(req('http://h/api/admin/sandbox-grants', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }))).status).toBe(401);
    expect((await GET(req())).status).toBe(401);
    expect((await DELETE(req('http://h/api/admin/sandbox-grants?id=g1', { method: 'DELETE' }))).status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockRevoke).not.toHaveBeenCalled();
  });
});
