import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Grant } from '@/lib/auth/authorize';

const authorizeRequest = vi.fn();
vi.mock('@/lib/auth/route-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/route-auth')>('@/lib/auth/route-auth');
  return { ...actual, authorizeRequest: (...a: unknown[]) => authorizeRequest(...a) };
});
const q = {
  createWhatIf: vi.fn(), getWhatIf: vi.fn(), listWhatIfsForCourse: vi.fn(), renameWhatIf: vi.fn(),
  deleteWhatIf: vi.fn(), listWhatIfMessages: vi.fn(),
};
vi.mock('@/lib/db/what-if-queries', () => ({
  createWhatIf: (...a: unknown[]) => q.createWhatIf(...a),
  getWhatIf: (...a: unknown[]) => q.getWhatIf(...a),
  listWhatIfsForCourse: (...a: unknown[]) => q.listWhatIfsForCourse(...a),
  renameWhatIf: (...a: unknown[]) => q.renameWhatIf(...a),
  deleteWhatIf: (...a: unknown[]) => q.deleteWhatIf(...a),
  listWhatIfMessages: (...a: unknown[]) => q.listWhatIfMessages(...a),
}));
const getCourseByCode = vi.fn();
vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode: (...a: unknown[]) => getCourseByCode(...a) }));
const getLatestSnapshotByCourse = vi.fn();
vi.mock('@/lib/db/capture-snapshots-queries', () => ({ getLatestSnapshotByCourse: (...a: unknown[]) => getLatestSnapshotByCourse(...a) }));
const deleteLocal = vi.fn();
vi.mock('@/lib/storage/local-storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storage/local-storage')>('@/lib/storage/local-storage');
  return { ...actual, deleteLocal: (...a: unknown[]) => deleteLocal(...a) };
});

import { POST, GET } from '@/app/api/explore/[code]/what-ifs/route';
import { GET as GET_ONE, PATCH, DELETE } from '@/app/api/explore/[code]/what-ifs/[id]/route';
import { GET as GET_MESSAGES } from '@/app/api/explore/[code]/what-ifs/[id]/messages/route';

const CODE = 'GC 3730';
const ID = '8b1f0c2e-0000-4000-8000-000000000001';
const personal: Grant = { id: 'g1', label: 'Dr. Rivera', scope: [CODE], can: ['capture'] };
const other: Grant = { id: 'g2', label: 'Dr. Lee', scope: [CODE], can: ['capture'] };
const dept: Grant = { id: 'builtin:faculty:abc123', label: 'Department login', scope: ['*'], can: ['capture'] };
const row = (over: object = {}) => ({
  id: ID, courseCode: CODE, ownerGrantId: 'g1', ownerKind: 'personal', authorName: 'Dr. Rivera', title: 'T',
  summary: null, pageCreatedAt: null, createdAt: new Date('2026-11-01'), ...over,
});
const ctx = () => ({ params: Promise.resolve({ code: encodeURIComponent(CODE) }) });
const ctxId = (id: string) => ({ params: Promise.resolve({ code: encodeURIComponent(CODE), id }) });
const url = `http://x/api/explore/${encodeURIComponent(CODE)}/what-ifs`;
const post = (body?: unknown) => new Request(url, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
});
const patch = (body: unknown) => new Request(`${url}/${ID}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  [authorizeRequest, getCourseByCode, getLatestSnapshotByCourse, deleteLocal, ...Object.values(q)].forEach((m) => m.mockReset());
  getCourseByCode.mockResolvedValue({ code: CODE });
  getLatestSnapshotByCourse.mockResolvedValue({ id: 'snap-1' });
  q.createWhatIf.mockResolvedValue({ id: ID });
});

describe('POST what-ifs (start)', () => {
  it('personal link: stores the link name, ignores the body, uses the latest snapshot', async () => {
    authorizeRequest.mockResolvedValue({ grant: personal });
    const res = await POST(post({ authorName: 'Someone Else' }), ctx());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: ID });
    expect(q.createWhatIf).toHaveBeenCalledWith({
      courseCode: CODE, baseSnapshotId: 'snap-1', ownerGrantId: 'g1', ownerKind: 'personal', authorName: 'Dr. Rivera',
    });
  });
  it('department login uses the trimmed body name, capped at 120 characters, owner by role', async () => {
    authorizeRequest.mockResolvedValue({ grant: dept });
    await POST(post({ authorName: `  ${'x'.repeat(200)}  ` }), ctx());
    expect(q.createWhatIf).toHaveBeenCalledWith(expect.objectContaining({
      ownerGrantId: 'builtin:faculty', ownerKind: 'department', authorName: 'x'.repeat(120),
    }));
  });
  it('department login without a name is 400', async () => {
    authorizeRequest.mockResolvedValue({ grant: dept });
    for (const body of [post({}), post({ authorName: '   ' }), post('not json'), post()]) {
      const res = await POST(body, ctx());
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'A name is required.' });
    }
    expect(q.createWhatIf).not.toHaveBeenCalled();
  });
  it('a personal link with a blank label falls back to the body name', async () => {
    authorizeRequest.mockResolvedValue({ grant: { ...personal, label: '  ' } });
    await POST(post({ authorName: 'Pat' }), ctx());
    expect(q.createWhatIf).toHaveBeenCalledWith(expect.objectContaining({ authorName: 'Pat' }));
  });
  it('409 when the course has no approved version', async () => {
    authorizeRequest.mockResolvedValue({ grant: personal });
    getLatestSnapshotByCourse.mockResolvedValue(null);
    const res = await POST(post({}), ctx());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'This course has no approved version yet.' });
  });
  it('404 for an unknown course', async () => {
    authorizeRequest.mockResolvedValue({ grant: personal });
    getCourseByCode.mockResolvedValue(null);
    expect((await POST(post({}), ctx())).status).toBe(404);
  });
  it('passes the authorize response through', async () => {
    authorizeRequest.mockResolvedValue({ response: new Response('no', { status: 401 }) });
    expect((await POST(post({}), ctx())).status).toBe(401);
    expect(q.createWhatIf).not.toHaveBeenCalled();
  });
});

describe('GET what-ifs (list)', () => {
  it('returns finished ones plus the caller\'s own unfinished; hides others\' unfinished', async () => {
    authorizeRequest.mockResolvedValue({ grant: personal });
    q.listWhatIfsForCourse.mockResolvedValue([
      row({ id: 'a', pageCreatedAt: new Date('2026-11-02'), ownerGrantId: 'g2' }),
      row({ id: 'b' }),
      row({ id: 'c', ownerGrantId: 'g2' }),
    ]);
    const res = await GET(new Request(url), ctx());
    const { whatIfs } = await res.json();
    expect(whatIfs.map((w: { id: string }) => w.id)).toEqual(['a', 'b']);
    expect(whatIfs[0]).toMatchObject({ hasPage: true, mine: false });
    expect(whatIfs[1]).toMatchObject({ hasPage: false, mine: true });
    expect(Object.keys(whatIfs[0]).sort()).toEqual(
      ['authorName', 'createdAt', 'hasPage', 'id', 'mine', 'pageCreatedAt', 'summary', 'title'],
    );
  });
  it('an admin does not see others\' unfinished what-ifs', async () => {
    authorizeRequest.mockResolvedValue({ grant: { id: 'g3', label: 'o', scope: ['*'], can: ['capture', 'admin'] } });
    q.listWhatIfsForCourse.mockResolvedValue([row({ id: 'c', ownerGrantId: 'g2' })]);
    expect((await (await GET(new Request(url), ctx())).json()).whatIfs).toEqual([]);
  });
  it('404 for an unknown course', async () => {
    authorizeRequest.mockResolvedValue({ grant: personal });
    getCourseByCode.mockResolvedValue(null);
    expect((await GET(new Request(url), ctx())).status).toBe(404);
  });
});

describe('GET one what-if', () => {
  it('owner reads their unfinished what-if with canManage true', async () => {
    authorizeRequest.mockResolvedValue({ grant: personal });
    q.getWhatIf.mockResolvedValue(row());
    const res = await GET_ONE(new Request(`${url}/${ID}`), ctxId(ID));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.canManage).toBe(true);
    expect(body.whatIf.id).toBe(ID);
  });
  it('a non-owner reading a finished what-if gets canManage false', async () => {
    authorizeRequest.mockResolvedValue({ grant: other });
    q.getWhatIf.mockResolvedValue(row({ pageCreatedAt: new Date() }));
    const body = await (await GET_ONE(new Request(`${url}/${ID}`), ctxId(ID))).json();
    expect(body.canManage).toBe(false);
  });
  it('a non-owner reading an unfinished what-if gets 404', async () => {
    authorizeRequest.mockResolvedValue({ grant: other });
    q.getWhatIf.mockResolvedValue(row());
    expect((await GET_ONE(new Request(`${url}/${ID}`), ctxId(ID))).status).toBe(404);
  });
});

describe('GET messages', () => {
  it('owner gets the messages', async () => {
    authorizeRequest.mockResolvedValue({ grant: personal });
    q.getWhatIf.mockResolvedValue(row());
    q.listWhatIfMessages.mockResolvedValue([{ id: 'm1' }]);
    const res = await GET_MESSAGES(new Request(`${url}/${ID}/messages`), ctxId(ID));
    expect(await res.json()).toEqual({ messages: [{ id: 'm1' }] });
    expect(q.listWhatIfMessages).toHaveBeenCalledWith(ID);
  });
  it('a non-owner of a finished what-if gets 403; of an unfinished one, 404', async () => {
    authorizeRequest.mockResolvedValue({ grant: other });
    q.getWhatIf.mockResolvedValue(row({ pageCreatedAt: new Date() }));
    expect((await GET_MESSAGES(new Request(`${url}/${ID}/messages`), ctxId(ID))).status).toBe(403);
    q.getWhatIf.mockResolvedValue(row());
    expect((await GET_MESSAGES(new Request(`${url}/${ID}/messages`), ctxId(ID))).status).toBe(404);
    expect(q.listWhatIfMessages).not.toHaveBeenCalled();
  });
});

describe('PATCH rename', () => {
  it('owner renames with a trimmed title', async () => {
    authorizeRequest.mockResolvedValue({ grant: personal });
    q.getWhatIf.mockResolvedValue(row());
    const res = await PATCH(patch({ title: '  New name ' }), ctxId(ID));
    expect(res.status).toBe(200);
    expect(q.renameWhatIf).toHaveBeenCalledWith(ID, 'New name');
  });
  it('400 for a missing, blank, non-string or over-long title', async () => {
    authorizeRequest.mockResolvedValue({ grant: personal });
    q.getWhatIf.mockResolvedValue(row());
    for (const title of [undefined, '   ', 5, 'x'.repeat(121)]) {
      expect((await PATCH(patch({ title }), ctxId(ID))).status).toBe(400);
    }
    expect(q.renameWhatIf).not.toHaveBeenCalled();
  });
  it('non-owner: 403 for a finished what-if, 404 for an unfinished one', async () => {
    authorizeRequest.mockResolvedValue({ grant: other });
    q.getWhatIf.mockResolvedValue(row({ pageCreatedAt: new Date() }));
    expect((await PATCH(patch({ title: 'x' }), ctxId(ID))).status).toBe(403);
    q.getWhatIf.mockResolvedValue(row());
    expect((await PATCH(patch({ title: 'x' }), ctxId(ID))).status).toBe(404);
    expect(q.renameWhatIf).not.toHaveBeenCalled();
  });
});

describe('DELETE', () => {
  const del = () => new Request(`${url}/${ID}`, { method: 'DELETE' });
  it('non-owner: 403 for a finished what-if, 404 for an unfinished one; nothing deleted', async () => {
    authorizeRequest.mockResolvedValue({ grant: other });
    q.getWhatIf.mockResolvedValue(row({ pageCreatedAt: new Date() }));
    expect((await DELETE(del(), ctxId(ID))).status).toBe(403);
    q.getWhatIf.mockResolvedValue(row());
    expect((await DELETE(del(), ctxId(ID))).status).toBe(404);
    expect(q.deleteWhatIf).not.toHaveBeenCalled();
  });
  it('owner: 204 and one deleteLocal per stored attachment file (foreign urls skipped)', async () => {
    authorizeRequest.mockResolvedValue({ grant: personal });
    q.getWhatIf.mockResolvedValue(row());
    q.deleteWhatIf.mockResolvedValue([
      { blobUrl: '/api/storage/materials/a/b.pdf' },
      { blobUrl: '/api/storage/materials/a/c.png' },
      { blobUrl: 'https://elsewhere.example/x.png' },
    ]);
    const res = await DELETE(del(), ctxId(ID));
    expect(res.status).toBe(204);
    expect(deleteLocal.mock.calls.map((c) => c[0])).toEqual(['a/b.pdf', 'a/c.png']);
  });
  it('a deleteLocal failure does not change the 204', async () => {
    authorizeRequest.mockResolvedValue({ grant: personal });
    q.getWhatIf.mockResolvedValue(row());
    q.deleteWhatIf.mockResolvedValue([{ blobUrl: '/api/storage/materials/a/b.pdf' }]);
    deleteLocal.mockRejectedValue(new Error('disk'));
    expect((await DELETE(del(), ctxId(ID))).status).toBe(204);
  });
});
