// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SyllabusDraft } from '@/lib/builder/syllabus-draft';

const PLAN = '8b1f0c2e-0000-4000-8000-000000000001';
const DRAFT_ID = '8b1f0c2e-0000-4000-8000-0000000000d1';
const state = vi.hoisted(() => ({
  selects: [] as unknown[][],
  inserted: [] as Array<Record<string, unknown>>,
  asked: [] as Array<{ text: string; course: { code: string; title: string } }>,
  draft: null as null | SyllabusDraft,
  captured: new Set<string>(),
}));

vi.mock('@/lib/auth/route-auth', () => ({ authorizeRequest: async () => ({ grant: { id: 'g', label: 'Dr Who', scope: ['*'], can: ['capture'] } }) }));
vi.mock('@/lib/auth/viewer', () => ({ personalName: (g: { label: string } | null) => g?.label ?? null }));
vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => state.selects.shift() ?? [] }) }),
    insert: () => ({ values: (v: Record<string, unknown>) => { state.inserted.push(v); return { returning: async () => [{ id: DRAFT_ID, at: new Date('2026-11-17T02:30:00Z') }] }; } }),
  },
}));
vi.mock('@/lib/db/curriculum-plan-queries', () => ({
  getPlan: async (id: string) => (id === PLAN ? { id, state: { proposed: [{ id: 'new:abc', code: 'GC 1040', title: 'x' }] } } : null),
}));
vi.mock('@/lib/db/live-captures', () => ({ hasLiveCapture: async (code: string) => state.captured.has(code) }));
vi.mock('@/lib/builder/syllabus-draft', async (orig) => ({
  ...(await orig<typeof import('@/lib/builder/syllabus-draft')>()),
  draftSyllabus: async (text: string, course: { code: string; title: string }) => {
    state.asked.push({ text, course });
    if (!state.draft) throw new Error('campus down');
    return { draft: state.draft, model: 'qwen-test' };
  },
}));

import { POST } from '@/app/api/build/plans/[id]/syllabus/route';

const TEXT = 'Week by week, students prepare print-ready files. '.repeat(10);
const post = (fields: Record<string, string | Blob>, id = PLAN) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return POST(new Request(`http://x/api/build/plans/${id}/syllabus`, { method: 'POST', body: f }), { params: Promise.resolve({ id }) });
};

beforeEach(() => {
  state.selects = []; state.inserted = []; state.asked = []; state.captured = new Set();
  state.draft = {
    objectives: [{ text: 'Prepare print-ready files', bloom: 'Apply' }],
    developed: [{ statement: 'Prepare a print-ready PDF', k: 2, u: 1, d: 4, condition_missing: true }],
    required: [],
    prerequisites: [{ code: 'GC1040', kind: 'prereq' }, { code: 'GC 2070', kind: 'coreq' }],
  };
  process.env.CAMPUS_LLM_BASE_URL = 'http://campus'; process.env.CAMPUS_LLM_API_KEY = 'k'; process.env.CAMPUS_LLM_DEFAULT_MODEL = 'qwen-test';
});

describe('POST /api/build/plans/[id]/syllabus', () => {
  it('is 503 with a plain message when the campus model is not configured', async () => {
    delete process.env.CAMPUS_LLM_DEFAULT_MODEL;
    const res = await post({ courseRef: 'new:x1', code: 'GC 5000', title: 'New', text: TEXT });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/campus model/);
  });
  it('refuses pasted text under 300 characters', async () => {
    const res = await post({ courseRef: 'new:x1', code: 'GC 5000', title: 'New', text: 'too short' });
    expect(res.status).toBe(400);
    expect(state.asked).toHaveLength(0);
  });
  it('refuses a file type it cannot read', async () => {
    const res = await post({ courseRef: 'new:x1', code: 'GC 5000', title: 'New', file: new File(['x'.repeat(400)], 'a.png', { type: 'image/png' }) });
    expect(res.status).toBe(400);
  });
  it('drafts a new course from a text file, stores the draft, and returns syllabus edits and links', async () => {
    const res = await post({ courseRef: 'new:x1', code: 'GC 5000', title: 'Packaging lab', file: new File([TEXT], 'syl.txt', { type: 'text/plain' }) });
    const body = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(state.asked[0]!.course).toEqual({ code: 'GC 5000', title: 'Packaging lab' });
    expect(state.inserted[0]).toMatchObject({ planId: PLAN, courseRef: 'new:x1', fileName: 'syl.txt', model: 'qwen-test', draftedBy: 'Dr Who' });
    expect(body).toMatchObject({ draftId: DRAFT_ID, fileName: 'syl.txt', at: '2026-11-17T02:30:00.000Z' });
    expect(body.edits.source).toEqual({ kind: 'syllabus', draftId: DRAFT_ID, fileName: 'syl.txt', at: '2026-11-17T02:30:00.000Z' });
    expect(body.edits.developed[0]).toMatchObject({ origin: 'syllabus', levels: { k: 2, u: 1, d: 2 }, conditionMissing: true });
    // GC 1040 is proposed on the plan, so it is linked by its id; GC 2070 by its code.
    expect(body.links).toEqual([{ from: 'new:abc', to: 'new:x1' }, { from: 'GC 2070', to: 'new:x1', kind: 'coreq' }]);
  });
  it('reads a tracked course from the database, and 404s one that is not there', async () => {
    state.selects.push([{ code: 'GC 3020', title: 'Package Printing' }]);
    const ok = await post({ courseRef: 'GC 3020', code: 'ignored', title: 'ignored', text: TEXT });
    expect(ok.status).toBe(200);
    expect(state.asked[0]!.course).toEqual({ code: 'GC 3020', title: 'Package Printing' });
    const missing = await post({ courseRef: 'GC 9999', text: TEXT });
    expect(missing.status).toBe(404);
  });
  it('is 409 for a tracked course that already has a capture, and asks nothing', async () => {
    state.captured.add('GC 3020');
    state.selects.push([{ code: 'GC 3020', title: 'Package Printing' }]);
    const res = await post({ courseRef: 'GC 3020', text: TEXT });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('This course already has a capture');
    expect(state.asked).toHaveLength(0);
    expect(state.inserted).toHaveLength(0);
  });
  it('is 502 when the campus model fails, and stores nothing', async () => {
    state.draft = null;
    const res = await post({ courseRef: 'new:x1', code: 'GC 5000', title: 'New', text: TEXT });
    expect(res.status).toBe(502);
    expect(state.inserted).toHaveLength(0);
  });
});
