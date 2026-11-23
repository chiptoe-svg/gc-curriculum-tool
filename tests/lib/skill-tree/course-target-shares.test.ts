import { describe, it, expect } from 'vitest';
import type { Tree, TreeLeaf, TreeNode } from '@/lib/skill-tree/types';
import { courseTargetShares, type Membership } from '@/lib/skill-tree/course-target-shares';

const node = (id: string, over: Partial<TreeNode> = {}): TreeNode => ({
  id, name: id, description: null, parentId: null, competencyId: null, foundational: false,
  weight: 1, weightSource: 'default', mergedInto: null, retired: false, ...over,
});
const leaf = (skillRef: string, nodeId: string, over: Partial<TreeLeaf> = {}): TreeLeaf => ({
  courseCode: 'GC 1010', skillRef, nodeId, statement: skillRef, share: null,
  source: 'scoring', status: 'proposed', ...over,
});

// Masters: mA (comp a), mB (comp b), mC (comp c). T1 = {a, b}, T2 = {b}, T3 = {c}.
const masters = [node('mA', { competencyId: 'a' }), node('mB', { competencyId: 'b' }), node('mC', { competencyId: 'c' })];
const membership: Membership[] = [
  { targetId: 'T1', competencyId: 'a' }, { targetId: 'T1', competencyId: 'b' },
  { targetId: 'T2', competencyId: 'b' }, { targetId: 'T3', competencyId: 'c' },
];
const tree = (leaves: TreeLeaf[], extra: TreeNode[] = []): Tree => ({ nodes: [...masters, ...extra], leaves, depths: [] });
const pick = (r: ReturnType<typeof courseTargetShares>, id: string) => r.targets.find(t => t.targetId === id)!;

describe('courseTargetShares', () => {
  it('computes the share of skills per target', () => {
    const r = courseTargetShares(tree([leaf('s1', 'mA'), leaf('s2', 'mA'), leaf('s3', 'mA'), leaf('s4', 'mB')]), membership, ['GC 1010']);
    expect(r.totalSkills).toBe(4);
    expect(r.targets).toEqual([
      { targetId: 'T1', skills: 4, pct: 100 },
      { targetId: 'T2', skills: 1, pct: 25 },
      { targetId: 'T3', skills: 0, pct: 0 },
    ]);
  });

  it('counts a skill once per target', () => {
    const r = courseTargetShares(tree([leaf('s1', 'mA'), leaf('s1', 'mB')]), membership, ['GC 1010']);
    expect(r.totalSkills).toBe(1);
    expect(pick(r, 'T1').skills).toBe(1);
    expect(r.totalPlacements).toBe(2);
  });

  it('walks up through parent skills', () => {
    const r = courseTargetShares(tree([leaf('s1', 'p2')], [node('p1', { parentId: 'mC' }), node('p2', { parentId: 'p1' })]), membership, ['GC 1010']);
    expect(pick(r, 'T3')).toEqual({ targetId: 'T3', skills: 1, pct: 100 });
  });

  it('merged and retired nodes', () => {
    const extra = [
      node('old', { parentId: 'mA', mergedInto: 'p', retired: true }),
      node('p', { parentId: 'mC' }),
      node('gone', { parentId: 'mA', retired: true }),
      node('deadParent', { parentId: 'mB', retired: true }),
      node('child', { parentId: 'deadParent' }),
    ];
    const r = courseTargetShares(tree([leaf('s1', 'old'), leaf('s2', 'gone'), leaf('s3', 'child')], extra), membership, ['GC 1010']);
    expect(r.totalSkills).toBe(1);
    expect(pick(r, 'T3').skills).toBe(1);
    expect(pick(r, 'T1').skills).toBe(0);
  });

  it("uses the tree's counting rule", () => {
    const r = courseTargetShares(tree([
      leaf('rej', 'mA', { status: 'rejected', source: 'faculty' }),
      leaf('emb', 'mA', { source: 'embedding' }),
      leaf('embOk', 'mA', { source: 'embedding', status: 'confirmed' }),
      leaf('sc', 'mA', { source: 'scoring' }),
      leaf('ai', 'mA', { source: 'ai' }),
    ]), membership, ['GC 1010']);
    expect(r.totalSkills).toBe(3);
  });

  it('counts confirmed placements', () => {
    const r = courseTargetShares(tree([leaf('s1', 'mA', { status: 'confirmed' }), leaf('s2', 'mA'), leaf('s3', 'mC')]), membership, ['GC 1010']);
    expect(r).toMatchObject({ confirmedPlacements: 1, totalPlacements: 3 });
  });

  it('rounds to whole percents', () => {
    const r = courseTargetShares(tree([leaf('s1', 'mA'), leaf('s2', 'mC'), leaf('s3', 'mC')]), membership, ['GC 1010']);
    expect(pick(r, 'T1').pct).toBe(33);
    expect(pick(r, 'T3').pct).toBe(67);
  });

  it('folds paired codes', () => {
    const r = courseTargetShares(tree([
      leaf('s1', 'mA'), leaf('s1', 'mC', { courseCode: 'GC 1011' }), leaf('x', 'mA', { courseCode: 'GC 9999' }),
    ]), membership, ['GC 1010', 'GC 1011']);
    expect(r.totalSkills).toBe(2);
    expect(pick(r, 'T1').pct).toBe(50);
    expect(pick(r, 'T3').pct).toBe(50);
  });

  it('no skills', () => {
    const r = courseTargetShares(tree([]), membership, ['GC 1010']);
    expect(r).toEqual({
      totalSkills: 0, confirmedPlacements: 0, totalPlacements: 0,
      targets: [{ targetId: 'T1', skills: 0, pct: 0 }, { targetId: 'T2', skills: 0, pct: 0 }, { targetId: 'T3', skills: 0, pct: 0 }],
    });
  });
});
