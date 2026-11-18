// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OrphanNote, PointRow, StringGraph, StringRow } from '@/lib/builder/strings/types';
import type { Library, LibraryCourse } from '@/lib/builder/types';
import { textHash } from '@/lib/catalog/bundles';
import { normalizeStatement } from '@/lib/catalog/project-trail';

const A = '8b1f0c2e-0000-4000-8000-0000000000a1';
const B = '8b1f0c2e-0000-4000-8000-0000000000a2';
const P1 = '8b1f0c2e-0000-4000-8000-0000000000b1';
const P2 = '8b1f0c2e-0000-4000-8000-0000000000b2';
const SNAP = '8b1f0c2e-0000-4000-8000-0000000000c1';
const P3 = '8b1f0c2e-0000-4000-8000-0000000000b3';
const hashOf = (s: string) => textHash(normalizeStatement(s));

const mem = vi.hoisted(() => ({
  graph: null as unknown as StringGraph,
  calls: [] as Array<[string, unknown]>,
  result: null as unknown,
  lib: null as unknown as Library,
  notesFor: [] as string[][],
  grant: { id: 'g', label: 'Dr Who', scope: ['*'], can: ['capture'] } as { id: string; label: string; scope: string[]; can: string[] } | null,
}));

vi.mock('@/lib/auth/route-auth', () => ({ authorizeRequest: async () => ({ grant: mem.grant }) }));
vi.mock('@/lib/auth/viewer', () => ({ personalName: (g: { label: string } | null) => g?.label ?? null }));
vi.mock('@/lib/builder/library', () => ({ loadLibrary: async () => mem.lib }));
vi.mock('@/lib/strings/resolve-all', () => ({
  resolveAll: async (_l: unknown, pts: PointRow[]) => Object.fromEntries(pts.map((p) => [p.id, { kind: 'unchecked' }])),
}));
vi.mock('@/lib/db/string-queries', () => {
  const rec = (name: string) => async (input: unknown) => { mem.calls.push([name, input]); return mem.result; };
  return {
    loadGraph: async (o: { courseCodes?: string[]; includeUnlocked?: boolean } = {}) => {
      const g = mem.graph;
      const strings = g.strings.filter((s) => (o.includeUnlocked || s.status === 'active')
        && (!o.courseCodes || s.path.some((p) => o.courseCodes!.includes(g.points[p]!.courseCode))));
      const ids = new Set(strings.flatMap((s) => s.path));
      return { ...g, strings, points: Object.fromEntries(Object.entries(g.points).filter(([id]) => ids.has(id))) };
    },
    listOrphanNotes: async (codes: string[]): Promise<OrphanNote[]> => { mem.notesFor.push(codes); return []; },
    lockString: rec('lock'), extendString: rec('extend'), branchString: rec('branch'), mergeString: rec('merge'),
    unmergeString: rec('unmerge'), removePoint: rec('remove-point'), setLinkWhy: rec('link-why'), setEndNote: rec('end-note'),
    renameString: rec('rename'), unlockString: rec('unlock'), relockString: rec('relock'), confirmReword: rec('confirm'),
    setOrphanNote: rec('orphan'),
  };
});

import { GET as list, POST as lock } from '@/app/api/strings/route';
import { GET as getOne, PATCH } from '@/app/api/strings/[id]/route';
import { POST as resolve } from '@/app/api/strings/resolve/route';
import { POST as reword } from '@/app/api/strings/points/[id]/route';
import { POST as orphan } from '@/app/api/strings/orphan-notes/route';

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (url: string, method: string, body?: unknown) => new Request(`http://x${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
const okGraph: StringGraph = { strings: [], points: {}, links: [], events: [] };

const pt = (id: string, courseCode: string, statement: string, role: 'develops' | 'requires' = 'develops'): PointRow =>
  ({ id, courseCode, role, statement, statementHash: hashOf(statement), snapshotId: SNAP, k: 1, u: 1, d: 1, term: null });
const str = (id: string, name: string, path: string[], status: 'active' | 'unlocked' = 'active', mergedInto: string | null = null): StringRow =>
  ({ id, name, description: '', status, endNote: null, mergedInto, version: 3, path });

const course = (code: string, level: number, skills: Array<{ s: string; k: number; u: number; d: number }>): LibraryCourse => ({
  code, title: code, level, category: 'gc_core', track: 'Core', description: '', credits: null, wiki: null,
  objectives: [], sheetProjects: [], stated: [], whatIfs: [],
  versions: [{
    snapshotId: `snap-${code}`, instructorName: null, createdAt: '2026-01-01T00:00:00.000Z', depths: [], outcomes: [], disagreements: [],
    projects: [], conditions: null, unmapped: [], suggestions: [], linked: false,
    skills: skills.map((x) => ({ skillRef: `h:${x.s}`, statement: x.s, k: x.k, u: x.u, d: x.d })), required: [],
  }],
} as unknown as LibraryCourse);

const goodPoint = { courseCode: 'GC 1010', role: 'develops', statement: 'Mix ink', snapshotId: SNAP, k: 2, u: 1, d: 3 };

beforeEach(() => {
  mem.calls = []; mem.notesFor = [];
  mem.result = { ok: true, graph: okGraph, notes: [] };
  mem.grant = { id: 'g', label: 'Dr Who', scope: ['*'], can: ['capture'] };
  mem.graph = {
    strings: [str(A, 'Active', [P1, P2]), str(B, 'Parked', [P2, P3], 'unlocked')],
    points: { [P1]: pt(P1, 'GC 1010', 'Mix ink'), [P2]: pt(P2, 'GC 2010', 'Run a press'), [P3]: pt(P3, 'GC 3010', 'Color manage') },
    links: [], events: [],
  };
  mem.lib = { courses: [course('GC 1010', 1, []), course('GC 2010', 2, []), course('GC 3010', 3, []), course('GC 4010', 4, [])] } as unknown as Library;
});

describe('POST /api/strings', () => {
  const body = { name: 'Color', points: [goodPoint, { ...goodPoint, courseCode: 'GC 2010' }], whys: ['builds on it'] };
  it('without a name is 400 and writes nothing', async () => {
    const r = await lock(req('/api/strings', 'POST', { ...body, name: '  ' }));
    expect(r.status).toBe(400);
    expect(mem.calls).toEqual([]);
  });
  it('without any author name (login that names nobody, none typed) is 400', async () => {
    mem.grant = null;
    expect((await lock(req('/api/strings', 'POST', body))).status).toBe(400);
    expect((await lock(req('/api/strings', 'POST', { ...body, authorName: 'Sam' }))).status).toBe(201);
    expect((mem.calls[0]![1] as { by: string }).by).toBe('Sam');
  });
  it('locks with the signed-in name and a hash computed on the server', async () => {
    const r = await lock(req('/api/strings', 'POST', { ...body, points: [{ ...goodPoint, statementHash: 'client-lies' }, body.points[1]] }));
    expect(r.status).toBe(201);
    const input = mem.calls[0]![1] as { by: string; points: Array<{ statementHash: string }> };
    expect(input.by).toBe('Dr Who');
    expect(input.points[0]!.statementHash).toBe(hashOf('Mix ink'));
  });
  it('a point with a bad role is 400', async () => {
    expect((await lock(req('/api/strings', 'POST', { ...body, points: [{ ...goodPoint, role: 'teaches' }, body.points[1]] }))).status).toBe(400);
  });
  it('a snapshot id that is not a UUID is 400', async () => {
    const r = await lock(req('/api/strings', 'POST', { ...body, points: [{ ...goodPoint, snapshotId: 'snap-1' }, body.points[1]] }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('Invalid snapshot id.');
  });
  it('a why over 1000 characters is 400; whys must number points minus one', async () => {
    expect((await lock(req('/api/strings', 'POST', { ...body, whys: ['x'.repeat(1001)] }))).status).toBe(400);
    expect((await lock(req('/api/strings', 'POST', { ...body, whys: [] }))).status).toBe(400);
    expect((await lock(req('/api/strings', 'POST', { ...body, whys: ['a', 'b'] }))).status).toBe(400);
    expect(mem.calls).toEqual([]);
  });
  it('more than 50 points is 400', async () => {
    const points = Array.from({ length: 51 }, (_, i) => ({ ...goodPoint, statement: `Skill ${i}` }));
    const r = await lock(req('/api/strings', 'POST', { ...body, points, whys: Array(50).fill('w') }));
    expect(r.status).toBe(400);
    expect(mem.calls).toEqual([]);
  });
  it('an over-long statement is 400', async () => {
    expect((await lock(req('/api/strings', 'POST', { ...body, points: [{ ...goodPoint, statement: 'x'.repeat(501) }, body.points[1]] }))).status).toBe(400);
  });
  it('passes a refusal from the query straight through', async () => {
    mem.result = { ok: false, status: 409, error: 'A string with that name already exists.' };
    const r = await lock(req('/api/strings', 'POST', body));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: 'A string with that name already exists.' });
  });
});

describe('GET /api/strings', () => {
  it('lists active strings as a thin projection; ?all=1 adds unlocked', async () => {
    const a = await (await list(req('/api/strings', 'GET'))).json();
    expect(a.strings).toEqual([{ id: A, name: 'Active', status: 'active', path: ['GC 1010', 'GC 2010'], stops: 2, end: 'GC 2010', mergedInto: null }]);
    const all = await (await list(req('/api/strings?all=1', 'GET'))).json();
    expect(all.strings.map((s: { id: string }) => s.id)).toEqual([A, B]);
  });
});

describe('GET /api/strings/[id]', () => {
  it('returns only that string, unlocked included; 404 when absent', async () => {
    const r = await getOne(req(`/api/strings/${B}`, 'GET'), ctx(B));
    const { graph } = await r.json();
    expect(graph.strings.map((s: { id: string }) => s.id)).toEqual([B]);
    expect(Object.keys(graph.points).sort()).toEqual([P2, P3]);
    expect((await getOne(req('/x', 'GET'), ctx('8b1f0c2e-0000-4000-8000-0000000000ff'))).status).toBe(404);
  });
});

describe('PATCH /api/strings/[id]', () => {
  const patch = (b: unknown) => PATCH(req(`/api/strings/${A}`, 'PATCH', b), ctx(A));
  it('an unknown action is 400', async () => {
    expect((await patch({ action: 'explode', version: 3 })).status).toBe(400);
    expect(mem.calls).toEqual([]);
  });
  it('a missing version is 400', async () => {
    expect((await patch({ action: 'rename', name: 'X' })).status).toBe(400);
  });
  it.each([
    ['extend', { at: 'end', why: 'w' }],
    ['extend', { at: 'middle', point: goodPoint, why: 'w' }],
    ['branch', { name: 'N', point: goodPoint, why: 'w' }],
    ['merge', {}],
    ['unmerge', {}],
    ['remove-point', { position: 1 }],
    ['rename', { name: ' ' }],
    ['end-note', { note: 5 }],
    ['unlock', {}],
  ])('%s with missing or bad fields is 400', async (action, rest) => {
    const r = await patch({ action, version: 3, ...rest });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBeTruthy();
    expect(mem.calls).toEqual([]);
  });
  it('a stale version is 409 and the body has current', async () => {
    const current = str(A, 'Active', [P1, P2]);
    mem.result = { ok: false, status: 409, error: 'This string changed since you loaded it.', current };
    const r = await patch({ action: 'rename', version: 1, name: 'New' });
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.current).toEqual(current);
    expect(j.error).toMatch(/changed/);
  });
  it('an over-long reason is 400', async () => {
    expect((await patch({ action: 'unlock', version: 3, reason: 'x'.repeat(1001) })).status).toBe(400);
    expect(mem.calls).toEqual([]);
  });
  it('a login that names nobody needs a typed name', async () => {
    mem.grant = null;
    expect((await patch({ action: 'relock', version: 3 })).status).toBe(400);
    expect(mem.calls).toEqual([]);
    expect((await patch({ action: 'relock', version: 3, authorName: '  Sam ' })).status).toBe(200);
    expect(mem.calls[0]![1]).toMatchObject({ by: 'Sam' });
  });
  it('maps each action to its query with the author', async () => {
    await patch({ action: 'extend', version: 3, at: 'start', point: goodPoint, why: 'w' });
    await patch({ action: 'merge', version: 3, into: B });
    await patch({ action: 'unmerge', version: 3, reason: 'r' });
    await patch({ action: 'remove-point', version: 3, position: 0, reason: 'r' });
    await patch({ action: 'end-note', version: 3, note: null });
    await patch({ action: 'relock', version: 3 });
    await patch({ action: 'link-why', linkId: B, why: 'w' });
    expect(mem.calls.map((c) => c[0])).toEqual(['extend', 'merge', 'unmerge', 'remove-point', 'end-note', 'relock', 'link-why']);
    expect(mem.calls.every((c) => (c[1] as { by: string }).by === 'Dr Who')).toBe(true);
    expect(mem.calls[1]![1]).toMatchObject({ id: A, version: 3, into: B, reason: '' });
  });
});

describe('POST /api/strings/resolve', () => {
  it('courseCodes: active strings only, with levels and orphan notes for the requested courses', async () => {
    const r = await resolve(req('/api/strings/resolve', 'POST', { courseCodes: ['GC 2010', 'GC 4010'] }));
    const j = await r.json();
    expect(j.graph.strings.map((s: { id: string }) => s.id)).toEqual([A]);
    expect(j.levels).toEqual({ 'GC 1010': 1, 'GC 2010': 2, 'GC 4010': 4 });
    expect(Object.keys(j.status).sort()).toEqual([P1, P2].sort());
    expect(j.notes).toEqual([]);
    expect(mem.notesFor).toEqual([['GC 2010', 'GC 4010']]);
    expect(j.orphans).toEqual({ 'GC 2010': { developed: [], unsupplied: [] }, 'GC 4010': { developed: [], unsupplied: [] } });
  });
  it('courseCodes: lists a requested course\'s skills that sit on no active string', async () => {
    mem.lib = { courses: [course('GC 4010', 4, [{ s: 'Spare skill', k: 1, u: 1, d: 1 }])] } as unknown as Library;
    const j = await (await resolve(req('/api/strings/resolve', 'POST', { courseCodes: ['GC 4010'] }))).json();
    expect(j.orphans['GC 4010'].developed).toMatchObject([{ statement: 'Spare skill', note: null }]);
  });
  it('stringId: returns that string even when unlocked, with no orphan notes', async () => {
    const r = await resolve(req('/api/strings/resolve', 'POST', { stringId: B }));
    const j = await r.json();
    expect(j.graph.strings.map((s: { id: string }) => s.id)).toEqual([B]);
    expect(j.graph.strings[0].status).toBe('unlocked');
    expect(j.levels).toEqual({ 'GC 2010': 2, 'GC 3010': 3 });
    expect(j.notes).toEqual([]);
    expect(j.orphans).toEqual({});
  });
  it('caps the course list and each code', async () => {
    const many = await resolve(req('/api/strings/resolve', 'POST', { courseCodes: Array.from({ length: 201 }, (_, i) => `GC ${i}`) }));
    expect(many.status).toBe(400);
    expect((await many.json()).error).toBe('Too many courses.');
    const long = await resolve(req('/api/strings/resolve', 'POST', { courseCodes: ['G'.repeat(41)] }));
    expect(long.status).toBe(400);
    expect((await long.json()).error).toBe('Course code too long.');
  });
  it('neither field is 400', async () => {
    expect((await resolve(req('/api/strings/resolve', 'POST', {}))).status).toBe(400);
  });
});

describe('POST /api/strings/points/[id]', () => {
  const NEW = 'Operate a press';
  beforeEach(() => {
    mem.lib = { courses: [course('GC 2010', 2, [{ s: NEW, k: 4, u: 3, d: 2 }])] } as unknown as Library;
  });
  const post = (b: unknown) => reword(req(`/api/strings/points/${P2}`, 'POST', b), ctx(P2));
  it('fills depth from the capture and passes the candidate on', async () => {
    const r = await post({ candidate: { statement: NEW, hash: hashOf(NEW) }, snapshotId: SNAP });
    expect(r.status).toBe(200);
    expect(mem.calls[0]![1]).toMatchObject({ pointId: P2, depth: { k: 4, u: 3, d: 2 }, snapshotId: SNAP, by: 'Dr Who' });
  });
  it('an absent snapshot id means the capture the depth came from', async () => {
    const r = await post({ candidate: { statement: NEW, hash: hashOf(NEW) } });
    expect(r.status).toBe(200);
    expect(mem.calls[0]![1]).toMatchObject({ pointId: P2, snapshotId: 'snap-GC 2010' });
  });
  it('a snapshot id that is not a UUID is 400', async () => {
    const r = await post({ candidate: { statement: NEW, hash: hashOf(NEW) }, snapshotId: 'snap-GC 2010' });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('Invalid snapshot id.');
  });
  it('a candidate no longer in the capture is 409', async () => {
    const r = await post({ candidate: { statement: 'Something else', hash: hashOf('Something else') }, snapshotId: SNAP });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("That wording is no longer in the course's capture.");
    expect(mem.calls).toEqual([]);
  });
  it('a statement that does not belong to the hash is refused, so the stored wording is the capture\'s', async () => {
    expect((await post({ candidate: { statement: 'Hacked wording', hash: hashOf(NEW) }, snapshotId: null })).status).toBe(409);
    expect(mem.calls).toEqual([]);
  });
});

describe('POST /api/strings/orphan-notes', () => {
  const note = { courseCode: 'GC 2010', role: 'develops', statement: 'Old skill' };
  it('needs a reason; computes the hash on the server and ignores the client\'s', async () => {
    expect((await orphan(req('/api/strings/orphan-notes', 'POST', note))).status).toBe(400);
    expect((await orphan(req('/api/strings/orphan-notes', 'POST', { ...note, statementHash: 'client-lies', reason: 'Retired' }))).status).toBe(200);
    expect(mem.calls[0]).toEqual(['orphan', { ...note, statementHash: hashOf('Old skill'), reason: 'Retired', by: 'Dr Who' }]);
  });
  it('an over-long reason is 400', async () => {
    expect((await orphan(req('/api/strings/orphan-notes', 'POST', { ...note, reason: 'x'.repeat(1001) }))).status).toBe(400);
  });
});
