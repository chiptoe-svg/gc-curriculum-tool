// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPatchGrant = vi.fn();
const mockListCourses = vi.fn();
const mockAdminAuth = vi.fn();

vi.mock('@/lib/auth/admin-auth', () => ({ checkAdminAuth: (...a: unknown[]) => mockAdminAuth(...a) }));
vi.mock('@/lib/db/courses-queries', () => ({ listCourses: (...a: unknown[]) => mockListCourses(...a) }));
vi.mock('@/lib/auth/grant-admin', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/grant-admin')>('@/lib/auth/grant-admin');
  return { ...actual, patchGrant: (...a: unknown[]) => mockPatchGrant(...a) };
});

import { PATCH } from '../route';
import { authorize, type Grant } from '@/lib/auth/authorize';

const VALID_ID = '123e4567-e89b-12d3-a456-426614174000';

function patchReq(body: Record<string, unknown>, contentType = 'application/json') {
  return new Request(`http://h/api/admin/access/${VALID_ID}`, { method: 'PATCH', headers: { 'content-type': contentType }, body: JSON.stringify(body) });
}
function call(body: Record<string, unknown>, id = VALID_ID) {
  return PATCH(patchReq(body), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockReturnValue(true);
  mockListCourses.mockResolvedValue([{ code: 'GC 3730', title: 'Account Management' }, { code: 'GC 1010', title: 'Intro' }]);
});

describe('PATCH /api/admin/access/[id]', () => {
  it('415s a non-JSON content-type, before even checking auth (fix round 1, M2)', async () => {
    const res = await PATCH(patchReq({ label: 'New' }, 'text/plain'), { params: Promise.resolve({ id: VALID_ID }) });
    expect(res.status).toBe(415);
    expect(mockAdminAuth).not.toHaveBeenCalled();
    expect(mockPatchGrant).not.toHaveBeenCalled();
  });

  it('401s when the admin second factor fails, and never patches', async () => {
    mockAdminAuth.mockReturnValue(false);
    const res = await call({ label: 'New' });
    expect(res.status).toBe(401);
    expect(mockPatchGrant).not.toHaveBeenCalled();
  });

  it('400s a malformed id before any query (fix round 1, L3)', async () => {
    const res = await call({ label: 'New' }, 'g1');
    expect(res.status).toBe(400);
    expect(mockPatchGrant).not.toHaveBeenCalled();
  });

  it('404s when the grant does not exist', async () => {
    mockPatchGrant.mockResolvedValue('not-found');
    const res = await call({ label: 'New' });
    expect(res.status).toBe(404);
  });

  it('409s (refuses) to edit a revoked grant', async () => {
    mockPatchGrant.mockResolvedValue('revoked');
    const res = await call({ label: 'New' });
    expect(res.status).toBe(409);
  });

  it('409s (refuses) to edit a CLI admin grant, with a command-line note (fix round 1, L1)', async () => {
    mockPatchGrant.mockResolvedValue('admin-managed');
    const res = await call({ label: 'New' });
    expect(res.status).toBe(409);
    const json = await res.json() as { error: string };
    expect(json.error).toMatch(/command line/i);
  });

  it('400s on an unknown course code in a courses patch, naming it', async () => {
    const res = await call({ courses: ['GC 9999'] });
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toMatch(/GC 9999/);
    expect(mockPatchGrant).not.toHaveBeenCalled();
  });

  it('translates canCreate into can, never admin, and applies a course change', async () => {
    mockPatchGrant.mockResolvedValue('ok');
    const res = await call({ courses: ['GC 1010'], canCreate: true });
    expect(res.status).toBe(200);
    expect(mockPatchGrant).toHaveBeenCalledWith(VALID_ID, expect.objectContaining({ scope: ['GC 1010'], can: ['capture', 'create'] }));
    const sentPatch = mockPatchGrant.mock.calls[0]![1] as { can: string[] };
    expect(sentPatch.can).not.toContain('admin');
  });

  it("a course change the route accepts is honored by authorize() (course-write now in scope)", async () => {
    mockPatchGrant.mockResolvedValue('ok');
    await call({ courses: ['GC 1010'], canCreate: false });
    const sentPatch = mockPatchGrant.mock.calls[0]![1] as { scope: string[]; can: ('capture' | 'create' | 'admin')[] };
    const grant: Grant = { id: 'g1', label: 'X', scope: sentPatch.scope, can: sentPatch.can };
    expect(authorize(grant, 'POST', '/api/capture/GC 1010/materials')).toEqual({ ok: true });
    expect(authorize(grant, 'POST', '/api/capture/GC 3730/materials')).toEqual({ ok: false, reason: 'out-of-scope', code: 'GC 3730' });
  });
});
