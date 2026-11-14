import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Grant } from '@/lib/auth/authorize';

const authorizeRequest = vi.fn();
const getWhatIf = vi.fn();
vi.mock('@/lib/auth/route-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/route-auth')>('@/lib/auth/route-auth');
  return { ...actual, authorizeRequest: (...a: unknown[]) => authorizeRequest(...a) };
});
vi.mock('@/lib/db/what-if-queries', () => ({ getWhatIf: (...a: unknown[]) => getWhatIf(...a) }));

import { guardWhatIf } from '@/lib/what-if/route-guard';

const owner: Grant = { id: 'g1', label: 'a', scope: ['GC 3730'], can: ['capture'] };
const other: Grant = { id: 'g2', label: 'b', scope: ['GC 3730'], can: ['capture'] };
const row = (over: object = {}) => ({ id: 'w1', courseCode: 'GC 3730', ownerGrantId: 'g1', ownerKind: 'personal', pageCreatedAt: null, ...over });
const req = new Request('http://x/api/explore/GC%203730/what-ifs/w1', { method: 'PATCH' });

beforeEach(() => { authorizeRequest.mockReset(); getWhatIf.mockReset(); });

describe('guardWhatIf', () => {
  it('passes the authorize response through (401)', async () => {
    const response = new Response('no', { status: 401 });
    authorizeRequest.mockResolvedValue({ response });
    const r = await guardWhatIf(req, 'GC 3730', 'w1', 'manage');
    expect(r.response).toBe(response);
    expect(getWhatIf).not.toHaveBeenCalled();
  });
  it('passes the table 403 through', async () => {
    const response = new Response('no', { status: 403 });
    authorizeRequest.mockResolvedValue({ response });
    expect((await guardWhatIf(req, 'GC 3730', 'w1', 'manage')).response).toBe(response);
  });
  it('404 when the what-if is missing', async () => {
    authorizeRequest.mockResolvedValue({ grant: owner });
    getWhatIf.mockResolvedValue(null);
    expect((await guardWhatIf(req, 'GC 3730', 'w1', 'manage')).response?.status).toBe(404);
  });
  it('404 when it belongs to another course', async () => {
    authorizeRequest.mockResolvedValue({ grant: owner });
    getWhatIf.mockResolvedValue(row({ courseCode: 'GC 4400' }));
    expect((await guardWhatIf(req, 'GC 3730', 'w1', 'read')).response?.status).toBe(404);
  });
  it('403 for manage by a non-manager', async () => {
    authorizeRequest.mockResolvedValue({ grant: other });
    getWhatIf.mockResolvedValue(row({ pageCreatedAt: new Date() }));
    expect((await guardWhatIf(req, 'GC 3730', 'w1', 'manage')).response?.status).toBe(403);
  });
  it('404 for read of an unfinished what-if by a non-manager', async () => {
    authorizeRequest.mockResolvedValue({ grant: other });
    getWhatIf.mockResolvedValue(row());
    expect((await guardWhatIf(req, 'GC 3730', 'w1', 'read')).response?.status).toBe(404);
  });
  it('returns grant and what-if otherwise', async () => {
    authorizeRequest.mockResolvedValue({ grant: owner });
    const w = row();
    getWhatIf.mockResolvedValue(w);
    expect(await guardWhatIf(req, 'GC 3730', 'w1', 'manage')).toEqual({ grant: owner, whatIf: w });
    authorizeRequest.mockResolvedValue({ grant: other });
    getWhatIf.mockResolvedValue(row({ pageCreatedAt: new Date() }));
    expect((await guardWhatIf(req, 'GC 3730', 'w1', 'read')).response).toBeUndefined();
  });
});
