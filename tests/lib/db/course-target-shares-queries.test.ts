import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Tree, TreeLeaf, TreeNode } from '@/lib/skill-tree/types';

const m = vi.hoisted(() => ({
  tree: { nodes: [], leaves: [], depths: [] } as Tree,
  membership: [] as Array<{ targetId: string; competencyId: string }>,
  paired: new Map<string, string>(),
}));
vi.mock('@/lib/db/skill-tree-queries', () => ({ loadTree: async () => m.tree }));
vi.mock('@/lib/db/client', () => ({ db: { select: () => ({ from: async () => m.membership }) } }));
vi.mock('@/lib/ai/wiki/paired-links', () => ({ loadPairedSlugMap: async () => m.paired }));

import { loadAllCourseTargetShares, loadCourseTargetShares } from '@/lib/db/course-target-shares-queries';

const node = (id: string, over: Partial<TreeNode> = {}): TreeNode => ({
  id, name: id, description: null, parentId: null, competencyId: null, foundational: false,
  weight: 1, weightSource: 'default', mergedInto: null, retired: false, ...over,
});
const leaf = (courseCode: string, skillRef: string, nodeId: string): TreeLeaf => ({
  courseCode, skillRef, nodeId, statement: skillRef, share: null, source: 'scoring', status: 'proposed',
});

beforeEach(() => {
  m.tree = { nodes: [node('mA', { competencyId: 'a' })], leaves: [], depths: [] };
  m.membership = [{ targetId: 'T1', competencyId: 'a' }];
  m.paired = new Map();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('course target share loaders', () => {
  it('folds a lab code whose page is its lecture course', async () => {
    m.tree.leaves = [leaf('GC 2071', 's1', 'mA')];
    m.paired = new Map([['gc-2071', 'gc-2070']]);
    expect((await loadCourseTargetShares('GC 2070'))?.totalSkills).toBe(1);
    const all = await loadAllCourseTargetShares(m.paired);
    expect([...all!.keys()]).toEqual(['gc-2070']);
    expect(all!.get('gc-2070')!.targets[0]).toEqual({ targetId: 'T1', skills: 1, pct: 100 });
  });

  it('returns null when the skill tree is empty or missing', async () => {
    m.tree = { nodes: [], leaves: [], depths: [] };
    expect(await loadAllCourseTargetShares(new Map())).toBeNull();
    expect(await loadCourseTargetShares('GC 2070')).toBeNull();
  });

  it('returns null when no target has members', async () => {
    m.tree.leaves = [leaf('GC 2070', 's1', 'mA')];
    m.membership = [];
    expect(await loadAllCourseTargetShares(new Map())).toBeNull();
  });
});
