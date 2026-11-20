import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => {
  const tree = { nodes: [], leaves: [] as unknown[], depths: [] };
  const ok = { ok: true, tree, notes: ['n'] };
  return {
    tree, ok,
    auth: vi.fn(),
    loadTree: vi.fn(),
    placeLeaf: vi.fn(),
    retargetLeaf: vi.fn(),
    setDepth: vi.fn(),
    splitNode: vi.fn(),
    suggestParents: vi.fn(),
    suggestNewWordings: vi.fn(),
    loadLibrary: vi.fn(),
  };
});

vi.mock('@/lib/auth/route-auth', () => ({ authorizeRequest: m.auth }));
vi.mock('@/lib/builder/library', () => ({ loadLibrary: m.loadLibrary }));
vi.mock('@/lib/auth/viewer', () => ({ personalName: () => null }));
vi.mock('@/lib/db/skill-tree-queries', () => ({
  loadTree: m.loadTree, placeLeaf: m.placeLeaf, retargetLeaf: m.retargetLeaf, setDepth: m.setDepth, splitNode: m.splitNode,
  createNode: vi.fn(), renameNode: vi.fn(), reparentNode: vi.fn(), mergeNode: vi.fn(), setWeight: vi.fn(),
  decideLeaf: vi.fn(), moveLeaf: vi.fn(), setShare: vi.fn(), clearDepth: vi.fn(),
}));
vi.mock('@/lib/skill-tree/suggest', () => ({ suggestParents: m.suggestParents, suggestNewWordings: m.suggestNewWordings }));

import { GET, POST } from '@/app/api/skill-tree/route';

const sk = (skillRef: string, statement = skillRef) => ({ skillRef, statement, k: 1, u: 1, d: 1 });
const lf = (skillRef: string, status = 'confirmed', courseCode = 'GC 1') =>
  ({ courseCode, skillRef, nodeId: 'n1', statement: skillRef, share: null, source: 'faculty', status });
const get = (q = '') => GET(new Request(`http://x/api/skill-tree${q}`));
const post = (body: unknown) => POST(new Request('http://x/api/skill-tree', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ grant: {} });
  m.tree.leaves = [];
  m.loadTree.mockResolvedValue(m.tree);
  m.placeLeaf.mockResolvedValue(m.ok);
  m.retargetLeaf.mockResolvedValue(m.ok);
  m.setDepth.mockResolvedValue(m.ok);
  m.suggestParents.mockResolvedValue({});
  m.suggestNewWordings.mockResolvedValue({});
  m.loadLibrary.mockResolvedValue({
    courses: [{ code: 'GC 1', versions: [{ snapshotId: 's1', instructorName: 'Ann', skills: [sk('a'), sk('b'), sk('c')] }] }],
  });
});

describe('/api/skill-tree', () => {
  it('unauthenticated is refused', async () => {
    m.auth.mockResolvedValue({ response: new Response('no', { status: 401 }) });
    expect((await get()).status).toBe(401);
    expect((await post({ action: 'create' })).status).toBe(401);
  });

  it('GET without a course returns the tree', async () => {
    const res = await get();
    expect(await res.json()).toEqual({ tree: m.tree });
  });

  it('GET with a course lists versions, gone leaves and suggestions only for unplaced skills', async () => {
    m.tree.leaves = [{ ...lf('c'), status: 'proposed', source: 'embedding' }, lf('a'), lf('gone1'), lf('gone1', 'proposed'), lf('rej', 'rejected'), lf('x', 'confirmed', 'GC 2')];
    m.suggestParents.mockResolvedValue({ b: [], c: [] });
    m.suggestNewWordings.mockResolvedValue({ gone1: { skillRef: 'b', statement: 'b', similarity: 0.9 } });
    const body = await (await get('?course=GC%201')).json();
    expect(m.suggestParents).toHaveBeenCalledWith(m.tree, [{ skillRef: 'b', statement: 'b' }, { skillRef: 'c', statement: 'c' }]);
    expect(body.suggestions).toEqual({ b: [], c: [] });
    expect(body.versions).toHaveLength(1);
    expect(body.versions[0].instructor).toBe('Ann');
    expect(body.versions[0].gone).toEqual([{ skillRef: 'gone1', statement: 'gone1', suggestion: { skillRef: 'b', statement: 'b', similarity: 0.9 } }]);
  });

  it('POST place calls placeLeaf with the author and the capture statement', async () => {
    const res = await post({ action: 'place', courseCode: 'GC 1', skillRef: 'a', statement: 'FORGED', nodeId: 'n1', authorName: 'Bo' });
    expect(res.status).toBe(200);
    expect(m.placeLeaf).toHaveBeenCalledWith({ courseCode: 'GC 1', skillRef: 'a', statement: 'a', nodeId: 'n1', by: 'Bo' });
    expect(await res.json()).toEqual({ tree: m.tree, notes: ['n'] });
  });

  it('POST place and retarget refuse a skill not in the capture', async () => {
    const p = await post({ action: 'place', courseCode: 'GC 1', skillRef: 'zzz', statement: 's', nodeId: 'n1', authorName: 'Bo' });
    expect(p.status).toBe(404);
    expect((await p.json()).error).toBe("That skill is not in this course's capture.");
    const r = await post({ action: 'retarget', courseCode: 'GC 1', oldRef: 'a', newRef: 'zzz', authorName: 'Bo' });
    expect(r.status).toBe(404);
    expect(m.placeLeaf).not.toHaveBeenCalled();
    expect(m.retargetLeaf).not.toHaveBeenCalled();
    const ok = await post({ action: 'retarget', courseCode: 'GC 1', oldRef: 'a', newRef: 'b', newStatement: 'FORGED', authorName: 'Bo' });
    expect(ok.status).toBe(200);
    expect(m.retargetLeaf).toHaveBeenCalledWith({ courseCode: 'GC 1', oldRef: 'a', newRef: 'b', newStatement: 'b', by: 'Bo' });
  });

  it('POST depth rejects 6 and 1.5 with 400', async () => {
    const base = { action: 'depth', nodeId: 'n1', courseCode: 'GC 1', instructor: 'Ann', authorName: 'Bo' };
    expect((await post({ ...base, k: 6, u: 1, d: 1 })).status).toBe(400);
    expect((await post({ ...base, k: 1, u: 1.5, d: 1 })).status).toBe(400);
    expect(m.setDepth).not.toHaveBeenCalled();
    expect((await post({ ...base, k: 5, u: null, d: 0 })).status).toBe(200);
    expect(m.setDepth).toHaveBeenCalledWith({ nodeId: 'n1', courseCode: 'GC 1', instructor: 'Ann', k: 5, u: null, d: 0, by: 'Bo' });
  });

  it('POST refuses an unknown action, missing fields and a missing author', async () => {
    expect((await post({ action: 'nope', authorName: 'Bo' })).status).toBe(400);
    expect((await post({ action: 'create', authorName: 'Bo' })).status).toBe(400);
    const r = await post({ action: 'create', name: 'X', parentId: 'p' });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('Add your name first.');
  });

  it('POST passes a refusal through, and repoint from split', async () => {
    m.placeLeaf.mockResolvedValue({ ok: false, status: 409, error: 'taken' });
    const r = await post({ action: 'place', courseCode: 'GC 1', skillRef: 'a', nodeId: 'n1', authorName: 'Bo' });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: 'taken' });
    m.splitNode.mockResolvedValue({ ...m.ok, repoint: ['q'] });
    const s = await post({ action: 'split', id: 'n1', newName: 'N', moveNodes: [], moveLeaves: [], authorName: 'Bo' });
    expect((await s.json()).repoint).toEqual(['q']);
  });
});
