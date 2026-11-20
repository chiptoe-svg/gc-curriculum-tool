// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mem = vi.hoisted(() => ({
  calls: [] as unknown[],
  grant: { id: 'g', label: 'Dr Who' } as { id: string; label: string } | null,
}));
vi.mock('@/lib/auth/route-auth', () => ({ authorizeRequest: async () => ({ grant: mem.grant }) }));
vi.mock('@/lib/auth/viewer', () => ({ personalName: (g: { label: string } | null) => g?.label ?? null }));
vi.mock('@/lib/db/string-queries', () => ({
  setPointNode: async (input: unknown) => { mem.calls.push(input); return { ok: true, graph: { strings: [], points: {}, links: [], events: [] }, notes: [] }; },
}));

import { POST } from '@/app/api/strings/points/[id]/node/route';

const ID = '8b1f0c2e-0000-4000-8000-0000000000b2';
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (id: string, body: unknown) => POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) }), ctx(id));

beforeEach(() => { mem.calls.length = 0; mem.grant = { id: 'g', label: 'Dr Who' }; });

describe('POST /api/strings/points/[id]/node', () => {
  it('404 for an id that is not a UUID', async () => {
    expect((await post('nope', { nodeId: 'n', d: 1 })).status).toBe(404);
    expect(mem.calls).toHaveLength(0);
  });
  it('400 without an author (a login that names nobody and no typed name)', async () => {
    mem.grant = null;
    const r = await post(ID, { nodeId: 'n', d: 1 });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('Add your name first.');
    expect(mem.calls).toHaveLength(0);
  });
  it('400 for a level outside 0-5 or not a whole number', async () => {
    for (const bad of [6, -1, 2.5, '3']) expect((await post(ID, { nodeId: 'n', d: bad })).status).toBe(400);
    expect(mem.calls).toHaveLength(0);
  });
  it('a missing nodeId is refused; a null nodeId clears', async () => {
    expect((await post(ID, { d: 1 })).status).toBe(400);
    expect((await post(ID, { nodeId: '  ', d: 1 })).status).toBe(400);
    expect(mem.calls).toHaveLength(0);
    expect((await post(ID, { nodeId: null })).status).toBe(200);
    expect(mem.calls).toEqual([{ pointId: ID, nodeId: null, need: { k: null, u: null, d: null }, by: 'Dr Who' }]);
  });
  it('400 when a node is named with no level at all', async () => {
    expect((await post(ID, { nodeId: 'n' })).status).toBe(400);
    expect(mem.calls).toHaveLength(0);
  });
  it('success passes the node, the levels and the author on', async () => {
    const r = await post(ID, { nodeId: 'n1', k: 1, u: null, d: 4 });
    expect(r.status).toBe(200);
    expect(mem.calls).toEqual([{ pointId: ID, nodeId: 'n1', need: { k: 1, u: null, d: 4 }, by: 'Dr Who' }]);
  });
});
