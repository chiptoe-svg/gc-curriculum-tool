import { describe, it, expect, vi } from 'vitest';
import { textHash } from '@/lib/catalog/bundles';
import { normalizeStatement } from '@/lib/catalog/project-trail';
import type { Library } from '@/lib/builder/types';
import type { PointRow } from '@/lib/builder/strings/types';

const seen = vi.hoisted(() => ({ items: [] as Array<{ point: { id: string }; pool: Array<{ hash: string }> }> }));
vi.mock('../reword', () => ({
  checkRewords: async (items: typeof seen.items) => {
    seen.items = items;
    return Object.fromEntries(items.map((i) => [i.point.id, { kind: 'changed', now: null, candidate: { statement: 'Mix ink', hash: items[0]!.pool[0]!.hash } }]));
  },
}));
import { resolveAll } from '../resolve-all';

const h = (s: string) => textHash(normalizeStatement(s));
const lib = { courses: [{ code: 'GC 1010', versions: [{ snapshotId: 's1',
  skills: [{ skillRef: 'a', statement: 'Mix ink', k: 2, u: 1, d: 3 }, { skillRef: 'b', statement: 'Clean a press', k: 1, u: null, d: 2 }], required: [] }] }] } as unknown as Library;
const pt = (id: string, statement: string): PointRow => ({ id, courseCode: 'GC 1010', role: 'develops', statement, statementHash: h(statement), snapshotId: null, k: null, u: null, d: null, term: null });

describe('resolveAll', () => {
  it('intact points skip the reword check; a reworded point gets the candidate depth', async () => {
    const r = await resolveAll(lib, [pt('p1', 'Clean a press'), pt('p2', 'Old wording')]);
    expect(r.p1).toEqual({ kind: 'intact', now: { k: 1, u: null, d: 2 } });
    expect(r.p2).toMatchObject({ kind: 'changed', now: { k: 2, u: 1, d: 3 } });
    expect(seen.items.map((i) => i.point.id)).toEqual(['p2']);
  });
  it('the pool excludes skills another point of the course and role holds', async () => {
    await resolveAll(lib, [pt('p1', 'Clean a press'), pt('p2', 'Old wording')]);
    expect(seen.items[0]!.pool.map((s) => s.hash)).toEqual([h('Mix ink')]);
  });
});
