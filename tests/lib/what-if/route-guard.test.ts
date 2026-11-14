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
const ID = '8b1f0c2e-0000-4000-8000-000000000001';
const admin: Grant = { id: 'g3', label: 'owner', scope: ['*'], can: ['capture', 'create', 'admin'] };
const row = (over: object = {}) => ({ id: ID, courseCode: 'GC 3730', ownerGrantId: 'g1', ownerKind: 'personal', pageCreatedAt: null, ...over });
const req = new Request(`http://x/api/explore/GC%203730/what-ifs/${ID}`, { method: 'PATCH' });

beforeEach(() => { authorizeRequest.mockReset(); getWhatIf.mockReset(); });

describe('guardWhatIf', () => {
  it('passes the authorize response through (401)', async () => {
    const response = new Response('no', { status: 401 });
    authorizeRequest.mockResolvedValue({ response });
    const r = await guardWhatIf(req, 'GC 3730', ID, 'manage');
    expect(r.response).toBe(response);
    expect(getWhatIf).not.toHaveBeenCalled();
  });
  it('passes the table 403 through', async () => {
    const response = new Response('no', { status: 403 });
    authorizeRequest.mockResolvedValue({ response });
    expect((await guardWhatIf(req, 'GC 3730', ID, 'manage')).response).toBe(response);
  });
  it('404 when the what-if is missing', async () => {
    authorizeRequest.mockResolvedValue({ grant: owner });
    getWhatIf.mockResolvedValue(null);
    expect((await guardWhatIf(req, 'GC 3730', ID, 'manage')).response?.status).toBe(404);
  });
  it('404 when it belongs to another course', async () => {
    authorizeRequest.mockResolvedValue({ grant: owner });
    getWhatIf.mockResolvedValue(row({ courseCode: 'GC 4400' }));
    expect((await guardWhatIf(req, 'GC 3730', ID, 'read')).response?.status).toBe(404);
  });
  it('403 for manage by a non-manager of a finished what-if', async () => {
    authorizeRequest.mockResolvedValue({ grant: other });
    getWhatIf.mockResolvedValue(row({ pageCreatedAt: new Date() }));
    expect((await guardWhatIf(req, 'GC 3730', ID, 'manage')).response?.status).toBe(403);
  });
  it('404 for read of an unfinished what-if by a non-manager', async () => {
    authorizeRequest.mockResolvedValue({ grant: other });
    getWhatIf.mockResolvedValue(row());
    expect((await guardWhatIf(req, 'GC 3730', ID, 'read')).response?.status).toBe(404);
  });
  it('404 for manage of an unfinished what-if by a non-owner (no existence oracle)', async () => {
    authorizeRequest.mockResolvedValue({ grant: other });
    getWhatIf.mockResolvedValue(row());
    expect((await guardWhatIf(req, 'GC 3730', ID, 'manage')).response?.status).toBe(404);
  });
  it('an admin may manage someone else\'s what-if, finished or not', async () => {
    authorizeRequest.mockResolvedValue({ grant: admin });
    getWhatIf.mockResolvedValue(row());
    expect((await guardWhatIf(req, 'GC 3730', ID, 'manage')).response).toBeUndefined();
    getWhatIf.mockResolvedValue(row({ pageCreatedAt: new Date() }));
    expect((await guardWhatIf(req, 'GC 3730', ID, 'manage')).response).toBeUndefined();
  });
  it('an owner may read and manage their own unfinished what-if', async () => {
    authorizeRequest.mockResolvedValue({ grant: owner });
    getWhatIf.mockResolvedValue(row());
    expect((await guardWhatIf(req, 'GC 3730', ID, 'read')).response).toBeUndefined();
    expect((await guardWhatIf(req, 'GC 3730', ID, 'manage')).response).toBeUndefined();
  });
  it('404 for an id that is not a uuid, without querying', async () => {
    authorizeRequest.mockResolvedValue({ grant: owner });
    expect((await guardWhatIf(req, 'GC 3730', 'not-a-uuid', 'read')).response?.status).toBe(404);
    expect(getWhatIf).not.toHaveBeenCalled();
  });
  it('a cross-site POST is blocked before any lookup', async () => {
    authorizeRequest.mockResolvedValue({ grant: owner });
    const r = new Request('http://x/api/explore/GC%203730/what-ifs', { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } });
    const res = (await guardWhatIf(r, 'GC 3730', ID, 'manage')).response!;
    expect(res.status).toBe(403);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ error: 'cross_origin_blocked', message: 'This request looks cross-site; admin changes must come from the app itself.' });
    expect(getWhatIf).not.toHaveBeenCalled();
  });
  it('a cross-site GET is not blocked by that check', async () => {
    authorizeRequest.mockResolvedValue({ grant: owner });
    getWhatIf.mockResolvedValue(row());
    const r = new Request('http://x/api/explore/GC%203730/what-ifs/x', { method: 'GET', headers: { 'sec-fetch-site': 'cross-site' } });
    expect((await guardWhatIf(r, 'GC 3730', ID, 'read')).response).toBeUndefined();
  });
  it('a same-origin POST goes on to the normal checks', async () => {
    authorizeRequest.mockResolvedValue({ grant: owner });
    getWhatIf.mockResolvedValue(row());
    const r = new Request('http://x/api/y', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } });
    expect((await guardWhatIf(r, 'GC 3730', ID, 'manage')).response).toBeUndefined();
    expect(getWhatIf).toHaveBeenCalled();
  });
  it('returns grant and what-if otherwise', async () => {
    authorizeRequest.mockResolvedValue({ grant: owner });
    const w = row();
    getWhatIf.mockResolvedValue(w);
    expect(await guardWhatIf(req, 'GC 3730', ID, 'manage')).toEqual({ grant: owner, whatIf: w });
    authorizeRequest.mockResolvedValue({ grant: other });
    getWhatIf.mockResolvedValue(row({ pageCreatedAt: new Date() }));
    expect((await guardWhatIf(req, 'GC 3730', ID, 'read')).response).toBeUndefined();
  });
});
