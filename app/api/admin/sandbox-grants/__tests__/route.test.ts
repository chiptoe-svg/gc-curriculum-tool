import { describe, it, expect, vi, beforeEach } from 'vitest';
const mockCreate = vi.fn(); const mockList = vi.fn(); const mockRevoke = vi.fn();
vi.mock('@/lib/sandbox/grants', () => ({
  createGrant: (...a: unknown[]) => mockCreate(...a),
  listGrants: (...a: unknown[]) => mockList(...a),
  revokeGrant: (...a: unknown[]) => mockRevoke(...a),
}));
import { POST, GET, DELETE } from '../route';
beforeEach(() => { vi.clearAllMocks(); });

describe('admin sandbox-grants API', () => {
  it('POST mints a grant', async () => {
    mockCreate.mockResolvedValue({ id: 'g1', token: 'tok', courseCode: 'GC 2400', expiresAt: new Date() });
    const res = await POST(new Request('http://h/api/admin/sandbox-grants', { method: 'POST', body: JSON.stringify({ courseCode: 'GC 2400', label: 'UGA' }), headers: { 'content-type': 'application/json' } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ token: 'tok' });
  });
  it('POST 400 without courseCode', async () => {
    const res = await POST(new Request('http://h/api/admin/sandbox-grants', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }));
    expect(res.status).toBe(400);
  });
  it('GET lists grants', async () => { mockList.mockResolvedValue([]); expect((await GET()).status).toBe(200); });
  it('DELETE revokes by id', async () => {
    mockRevoke.mockResolvedValue(undefined);
    const res = await DELETE(new Request('http://h/api/admin/sandbox-grants?id=g1', { method: 'DELETE' }));
    expect(res.status).toBe(200); expect(mockRevoke).toHaveBeenCalledWith('g1');
  });
});
