// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SyllabusDraft } from '@/lib/builder/syllabus-draft';
import { emptyClusterState, type ClusterState } from '@/lib/builder/cluster/state';
import type { Library, LibraryCourse } from '@/lib/builder/types';

const ID = '8b1f0c2e-0000-4000-8000-0000000000c1';
const DRAFT_ID = '8b1f0c2e-0000-4000-8000-0000000000d1';
const WHATIF_ID = '8b1f0c2e-0000-4000-8000-0000000000f1';
const mem = vi.hoisted(() => ({
  clusters: new Map<string, { id: string; name: string; state: unknown; version: number; createdBy: string; updatedBy: string; ownerGrantId: string; ownerKind: string }>(),
  inserted: [] as Array<Record<string, unknown>>,
  whatIfs: [] as Array<Record<string, unknown>>,
  asked: [] as string[],
  lib: null as unknown,
  captured: new Set<string>(),
  grant: { id: 'g', label: 'Dr Who', scope: ['*'], can: ['capture'] } as { id: string; label: string; scope: string[]; can: string[] },
}));

vi.mock('@/lib/auth/route-auth', () => ({
  authorizeRequest: async () => ({ grant: mem.grant }),
  forbidden: () => Response.json({ error: 'forbidden' }, { status: 403 }),
}));
vi.mock('@/lib/auth/viewer', () => ({ personalName: (g: { label: string } | null) => g?.label ?? null }));
vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => [] }) }),
    insert: () => ({ values: (v: Record<string, unknown>) => { mem.inserted.push(v); return { returning: async () => [{ id: DRAFT_ID, at: new Date('2026-11-17T02:30:00Z') }] }; } }),
  },
}));
vi.mock('@/lib/db/cluster-queries', () => ({
  createCluster: async (i: { name: string; state: unknown; createdBy: string; ownerGrantId: string; ownerKind: string }) => {
    const row = { id: ID, version: 1, updatedBy: i.createdBy, ...i }; mem.clusters.set(ID, row); return row;
  },
  getCluster: async (id: string) => mem.clusters.get(id) ?? null,
  listClusters: async () => [...mem.clusters.values()].map(c => ({ ...c, courses: (c.state as ClusterState).cards.length })),
  saveCluster: async (id: string, v: number, p: { name: string; state: unknown; updatedBy: string }) => {
    const c = mem.clusters.get(id);
    if (!c || c.version !== v) return null;
    Object.assign(c, p, { version: v + 1 }); return c;
  },
  deleteCluster: async (id: string) => { mem.clusters.delete(id); },
}));
vi.mock('@/lib/db/what-if-queries', () => ({
  createWhatIf: async (i: Record<string, unknown>) => { mem.whatIfs.push(i); return { id: WHATIF_ID }; },
}));
vi.mock('@/lib/builder/library', () => ({ loadLibrary: async () => mem.lib }));
vi.mock('@/lib/db/live-captures', () => ({ hasLiveCapture: async (c: string) => mem.captured.has(c) }));
vi.mock('@/lib/db/course-code-match', () => ({ findCourseByTypedCode: async () => null }));
vi.mock('@/lib/courses/material-extractor', () => ({ getExtractorFor: () => ({ extract: async () => ({ text: '', pageCount: 0 }) }) }));
vi.mock('@/lib/builder/syllabus-draft', async (orig) => ({
  ...(await orig<typeof import('@/lib/builder/syllabus-draft')>()),
  draftSyllabus: async (text: string) => {
    mem.asked.push(text);
    const draft: SyllabusDraft = { objectives: [{ text: 'Prepare print-ready files', bloom: 'Apply' }], developed: [], required: [], prerequisites: [] };
    return { draft, model: 'qwen-test' };
  },
}));

import { GET as list, POST as create } from '@/app/api/build/clusters/route';
import { DELETE, PUT } from '@/app/api/build/clusters/[id]/route';
import { POST as syllabus } from '@/app/api/build/clusters/[id]/syllabus/route';
import { GET as changes } from '@/app/api/build/clusters/[id]/changes.md/route';
import { POST as saveVersion } from '@/app/api/build/clusters/[id]/versions/route';

const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });
const json = (url: string, method: string, body: unknown) => new Request(`http://x${url}`, { method, body: JSON.stringify(body) });

const course = (code: string, objectives: string[], skills: string[], required: string[], snapshot: string | null = code): LibraryCourse => ({
  code, title: `${code} title`, level: 1, category: 'gc_core', track: 'Core', description: '', credits: null, wiki: null,
  objectives, sheetProjects: [], stated: [], whatIfs: [],
  versions: snapshot ? [{
    snapshotId: snapshot, instructorName: null, createdAt: '2026-01-01T00:00:00.000Z', depths: [], outcomes: [], disagreements: [],
    projects: [], conditions: null, unmapped: [], suggestions: [], linked: false,
    skills: skills.map(s => ({ skillRef: `h:${s}`, statement: s, k: 3, u: 2, d: 4 })),
    required: required.map(s => ({ ref: `h:${s}`, statement: s, need: { k: null, u: null, d: 3 } })),
  }] : [],
});
const seed = (state: Partial<ClusterState>) => mem.clusters.set(ID, {
  id: ID, name: 'Press cluster', version: 1, createdBy: 'Dr Who', updatedBy: 'Dr Who', ownerGrantId: 'g', ownerKind: 'personal',
  state: { ...emptyClusterState(), ...state },
});

beforeEach(() => {
  mem.clusters.clear(); mem.inserted = []; mem.whatIfs = []; mem.asked = []; mem.captured = new Set();
  mem.grant = { id: 'g', label: 'Dr Who', scope: ['*'], can: ['capture'] };
  mem.lib = {
    courses: [course('GC 1', ['Identify press parts'], ['Mix ink'], []), course('GC 2', [], [], ['Read a job ticket']), course('GC 9', [], [], [], null)],
    competencies: [], targets: [], prereqs: [], candidates: {}, decisions: {},
  } satisfies Library;
  process.env.CAMPUS_LLM_BASE_URL = 'http://campus'; process.env.CAMPUS_LLM_API_KEY = 'k'; process.env.CAMPUS_LLM_DEFAULT_MODEL = 'qwen-test';
});

describe('cluster collection', () => {
  it('creates and lists clusters', async () => {
    const res = await create(json('/api/build/clusters', 'POST', { name: '  Press cluster ' }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: ID });
    expect(mem.clusters.get(ID)).toMatchObject({ name: 'Press cluster', createdBy: 'Dr Who', ownerGrantId: 'g', ownerKind: 'personal', state: emptyClusterState() });
    const body = await (await list(new Request('http://x/api/build/clusters'))).json();
    expect(body.clusters).toEqual([expect.objectContaining({ id: ID, name: 'Press cluster', courses: 0 })]);
  });
  it('refuses a cluster with no name', async () => {
    expect((await create(json('/api/build/clusters', 'POST', { name: ' ' }))).status).toBe(400);
  });
});

describe('cluster item', () => {
  it('saves, then a stale version is 409 with the current version', async () => {
    seed({});
    const ok = await PUT(json(`/api/build/clusters/${ID}`, 'PUT', { name: 'Renamed', state: emptyClusterState(), version: 1 }), ctx());
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ version: 2 });
    const stale = await PUT(json(`/api/build/clusters/${ID}`, 'PUT', { name: 'Again', state: emptyClusterState(), version: 1 }), ctx());
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ version: 2, updatedBy: 'Dr Who' });
  });
  it('rejects an unreadable state, and an id that is not a UUID is 404', async () => {
    seed({});
    expect((await PUT(json(`/api/build/clusters/${ID}`, 'PUT', { name: 'x', state: { cards: 'no' }, version: 1 }), ctx())).status).toBe(400);
    expect((await PUT(json('/api/build/clusters/nope', 'PUT', {}), ctx('nope'))).status).toBe(404);
    expect((await DELETE(new Request('http://x'), ctx('nope'))).status).toBe(404);
  });
  it('deletes only for the owner or an admin', async () => {
    seed({});
    mem.grant = { id: 'other', label: 'Dr Else', scope: ['GC 1'], can: ['capture'] };
    expect((await DELETE(new Request('http://x'), ctx())).status).toBe(403);
    expect(mem.clusters.has(ID)).toBe(true);
    mem.grant = { id: 'g', label: 'Dr Who', scope: ['*'], can: ['capture'] };
    expect((await DELETE(new Request('http://x'), ctx())).status).toBe(200);
    expect(mem.clusters.has(ID)).toBe(false);
  });
});

describe('POST /api/build/clusters/[id]/syllabus', () => {
  it('syllabus import on a cluster stores a cluster draft', async () => {
    seed({});
    const f = new FormData();
    f.append('courseRef', 'new:x1'); f.append('code', 'GC 5000'); f.append('title', 'Packaging lab');
    f.append('text', 'Week by week, students prepare print-ready files. '.repeat(10));
    const res = await syllabus(new Request(`http://x/api/build/clusters/${ID}/syllabus`, { method: 'POST', body: f }), ctx());
    const body = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(mem.inserted[0]).toMatchObject({ clusterId: ID, courseRef: 'new:x1', model: 'qwen-test', draftedBy: 'Dr Who' });
    expect(mem.inserted[0]).not.toHaveProperty('planId');
    expect(body.edits.objectives[0]).toMatchObject({ origin: 'syllabus' });
  });
  it('is 404 for a missing cluster', async () => {
    const f = new FormData(); f.append('courseRef', 'new:x1'); f.append('code', 'GC 5000'); f.append('title', 'T'); f.append('text', 'x'.repeat(400));
    expect((await syllabus(new Request('http://x', { method: 'POST', body: f }), ctx())).status).toBe(404);
  });
});

describe('GET /api/build/clusters/[id]/changes.md', () => {
  it('changes.md for a cluster lists edits and statuses', async () => {
    seed({
      cards: [{ ref: 'GC 1', x: 0, y: 0 }, { ref: 'GC 2', x: 300, y: 0 }],
      courseEdits: { 'GC 2': { objectives: [], developed: [], required: [{ id: 'e1', action: 'add', target: null, statement: 'Mix ink by eye', levels: { k: null, u: null, d: 2 }, by: 'Dr Who', at: '2026-11-17T10:00:00.000Z' }] } },
      links: [{ from: 'GC 1', to: 'GC 2' }],
    });
    const res = await changes(new Request(`http://x/api/build/clusters/${ID}/changes.md`), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toMatch(/press-cluster-changes-/);
    const md = await res.text();
    expect(md).toContain('# Press cluster');
    expect(md).toMatch(/statuses are as last judged/i);
    expect(md).toContain('## GC 2 GC 2 title');
    expect(md).toContain('Added: Mix ink by eye (K– U– D2)*');
    expect(md).toMatch(/Added: Mix ink by eye.* — Matching…/);
    expect(md).not.toMatch(/thread/i);
  });
  it('is 404 for a missing cluster', async () => {
    expect((await changes(new Request('http://x'), ctx())).status).toBe(404);
  });
});

describe('POST /api/build/clusters/[id]/versions', () => {
  const post = (courseRef: string) => saveVersion(json(`/api/build/clusters/${ID}/versions`, 'POST', { courseRef }), ctx());
  it('save as version writes skills and no estimate', async () => {
    seed({
      cards: [{ ref: 'GC 2', x: 0, y: 0 }],
      courseEdits: { 'GC 2': { objectives: [{ id: 'o1', action: 'add', target: null, bloom: null, text: 'Plan a press run', by: 'Dr Who', at: '2026-11-17T10:00:00.000Z' }], developed: [], required: [] } },
    });
    const res = await post('GC 2');
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: WHATIF_ID });
    expect(mem.whatIfs[0]).toMatchObject({
      courseCode: 'GC 2', baseSnapshotId: 'GC 2', ownerGrantId: 'g', ownerKind: 'personal', authorName: 'Dr Who',
      title: 'GC 2 as edited on Press cluster',
      skills: {
        objectives: ['Plan a press run'], developed: [],
        required: [{ statement: 'Read a job ticket', need: { k: null, u: null, d: 3 } }], fromCluster: ID,
      },
    });
    expect(mem.whatIfs[0]).not.toHaveProperty('estimate');
    expect(mem.whatIfs[0]).not.toHaveProperty('profile');
  });
  it('save as version refuses a new course', async () => {
    seed({ cards: [{ ref: 'new:abc', x: 0, y: 0 }], proposed: [{ id: 'new:abc', source: 'new', code: 'GC 5000', title: 'New', credits: null, description: '', objectives: [], depths: [], skills: [], required: [] } as never] });
    const res = await post('new:abc');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Only a tracked course can be saved as a version.');
    expect(mem.whatIfs).toHaveLength(0);
  });
  it('refuses a tracked course with no captured version', async () => {
    seed({ cards: [{ ref: 'GC 9', x: 0, y: 0 }] });
    const res = await post('GC 9');
    expect(res.status).toBe(400);
    expect(mem.whatIfs).toHaveLength(0);
  });
  it('refuses a course that is not on the cluster', async () => {
    seed({ cards: [] });
    expect((await post('GC 2')).status).toBe(400);
  });
});
