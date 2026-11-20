import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({ db: {} }));
vi.mock('@/lib/ai/embeddings', () => ({
  DEFAULT_EMBEDDING_MODEL: 'm',
  embedBatch: vi.fn().mockRejectedValue(new Error('campus down')),
}));
vi.mock('@/lib/db/bundle-queries', () => ({
  embedMissing: vi.fn(async (_db: unknown, _items: unknown, _m: unknown, embed: (t: string[]) => Promise<unknown>) => { await embed(['x']); }),
  readVectors: vi.fn(async () => new Map()),
}));

import { rankParents, closestNewWording, suggestParents } from '../suggest';
import type { Tree, TreeNode, TreeLeaf } from '../types';

const node = (id: string, o: Partial<TreeNode> = {}): TreeNode => ({
  id, name: id, description: null, parentId: null, competencyId: null, foundational: false,
  weight: 1, weightSource: 'default', mergedInto: null, retired: false, ...o,
});
const leaf = (nodeId: string, skillRef: string): TreeLeaf => ({
  courseCode: 'GC 1', skillRef, nodeId, statement: skillRef, share: null, source: 'faculty', status: 'confirmed',
});

describe('rankParents', () => {
  it('orders by best match over name and leaves', () => {
    const tree: Tree = { nodes: [node('a'), node('b'), node('c')], leaves: [leaf('c', 'l1')], depths: [] };
    const nodeVecs = new Map([['a', [0, 1, 0]], ['b', [1, 1, 0]], ['c', [0, 0, 1]]]);
    const leafVecs = new Map([['l1', [1, 0, 0]]]);
    const r = rankParents([1, 0, 0], tree, nodeVecs, leafVecs, 2);
    expect(r.map((x) => x.nodeId)).toEqual(['c', 'b']);
    expect(r[0]!.similarity).toBeCloseTo(1);
  });
  it('skips retired and merged nodes', () => {
    const tree: Tree = { nodes: [node('a', { retired: true }), node('b', { mergedInto: 'c' }), node('c')], leaves: [], depths: [] };
    const nodeVecs = new Map([['a', [1, 0, 0]], ['b', [1, 0, 0]], ['c', [0, 1, 0]]]);
    expect(rankParents([1, 0, 0], tree, nodeVecs, new Map(), 3).map((x) => x.nodeId)).toEqual(['c']);
  });
});

describe('closestNewWording', () => {
  it('returns null below 0.80', () => {
    expect(closestNewWording([1, 0, 0], [{ skillRef: 'x', statement: 'x', vec: [0, 1, 0] }])).toBeNull();
  });
  it('returns the closest at or above 0.80', () => {
    const r = closestNewWording([1, 0, 0], [
      { skillRef: 'far', statement: 'f', vec: [0, 1, 0] },
      { skillRef: 'near', statement: 'n', vec: [1, 0.1, 0] },
    ]);
    expect(r?.skillRef).toBe('near');
  });
});

describe('suggestParents', () => {
  it('returns {} when embedding throws', async () => {
    const tree: Tree = { nodes: [node('a')], leaves: [], depths: [] };
    expect(await suggestParents(tree, [{ skillRef: 's', statement: 'S' }])).toEqual({});
  });
});

describe('suggestNewWordings', () => {
  it('returns {} when embedding fails', async () => {
    const { suggestNewWordings } = await import('../suggest');
    expect(await suggestNewWordings([{ skillRef: 'g', statement: 'g' }], [{ skillRef: 'p', statement: 'p' }])).toEqual({});
  });
  it('returns {} with nothing to compare', async () => {
    const { suggestNewWordings } = await import('../suggest');
    expect(await suggestNewWordings([], [{ skillRef: 'p', statement: 'p' }])).toEqual({});
  });
});
