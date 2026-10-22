import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/admin-auth', () => ({ checkAdminAuth: (_req: Request, o?: { slug?: string }) => o?.slug !== 'bad' }));
const m = vi.hoisted(() => ({
  readTargetCompetencyList: vi.fn(async () => [] as unknown[]),
  lockMembership: vi.fn(async () => {}),
  rebuildMembership: vi.fn(async () => [] as unknown[]),
  setPin: vi.fn(async () => {}),
  setHide: vi.fn(async () => {}),
  clearFacultyRow: vi.fn(async () => {}),
}));
vi.mock('@/lib/db/membership-queries', () => m);
vi.mock('@/lib/db/client', () => ({ db: { transaction: async (fn: (tx: unknown) => unknown) => fn({ execute: async () => ({ rows: [{ next: 3 }] }) }), select: () => ({ from: () => ({ orderBy: async () => [{ id: 't1', name: 'T1' }] }) }) } }));

import { GET, POST } from '../route';
const post = (body: unknown) => new Request('http://x/api/admin/membership', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => vi.clearAllMocks());

describe('/api/admin/membership', () => {
  it('pins, hides and clears under the lock, then rebuilds', async () => {
    for (const action of ['pin', 'hide', 'clear'] as const) {
      const res = await POST(post({ slug: 's', targetId: 't1', competencyId: 'c-1', action }));
      expect(res.status).toBe(200);
    }
    expect(m.setPin).toHaveBeenCalledTimes(1);
    expect(m.setHide).toHaveBeenCalledTimes(1);
    expect(m.clearFacultyRow).toHaveBeenCalledTimes(1);
    expect(m.lockMembership).toHaveBeenCalledTimes(3);
    expect(m.rebuildMembership).toHaveBeenCalledTimes(3);
  });

  it('refuses a bad action, a bad id, a non-JSON body and a bad slug', async () => {
    expect((await POST(post({ slug: 's', targetId: 't1', competencyId: 'c-1', action: 'drop' }))).status).toBe(400);
    expect((await POST(post({ slug: 's', targetId: 'T 1', competencyId: 'c-1', action: 'pin' }))).status).toBe(400);
    expect((await POST(new Request('http://x', { method: 'POST', body: '{}' }))).status).toBe(415);
    expect((await POST(post({ slug: 'bad', targetId: 't1', competencyId: 'c-1', action: 'pin' }))).status).toBe(401);
    expect(m.setPin).not.toHaveBeenCalled();
  });

  it('an unknown target or competency is a 404, not a 500', async () => {
    m.setPin.mockRejectedValueOnce(Object.assign(new Error('fk'), { code: '23503' }));
    const res = await POST(post({ slug: 's', targetId: 't1', competencyId: 'nope', action: 'pin' }));
    expect(res.status).toBe(404);
  });

  it('GET lists with hidden rows included', async () => {
    const res = await GET(new Request('http://x/api/admin/membership?slug=s'));
    expect(res.status).toBe(200);
    expect(m.readTargetCompetencyList).toHaveBeenCalledWith(expect.anything(), { includeHidden: true });
  });
});
