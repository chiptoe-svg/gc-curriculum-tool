import { describe, it, expect } from 'vitest';
import type { Depth } from '@/lib/builder/types';
import type { HandDepth, Tree, TreeLeaf, TreeNode, VersionSkills } from '../types';
import { isFoundational, careerWeights, counts, leavesSignature, meets, readCareer, readCourse, readProgram, resolveNode } from '../read';

const node = (id: string, over: Partial<TreeNode> = {}): TreeNode => ({
  id, name: id, description: null, parentId: null, competencyId: null, foundational: false,
  weight: 1, weightSource: 'default', mergedInto: null, retired: false, ...over,
});
const leaf = (skillRef: string, nodeId: string, over: Partial<TreeLeaf> = {}): TreeLeaf => ({
  courseCode: 'GC 3400', skillRef, nodeId, statement: skillRef, share: null,
  source: 'faculty', status: 'confirmed', ...over,
});
const version = (skills: Record<string, Depth>, instructor = 'A', courseCode = 'GC 3400'): VersionSkills =>
  ({ courseCode, instructor, skills: new Map(Object.entries(skills)) });
const K1: Depth = { k: 3, u: 2, d: 4 };
const K2: Depth = { k: 1, u: 2, d: 2 };
const hand = (over: Partial<HandDepth>): HandDepth => ({
  nodeId: 'icc', courseCode: 'GC 3400', instructor: 'A', k: 5, u: 5, d: 5, method: 'faculty',
  leavesSignature: '', setBy: 'x', ...over,
});

const baseNodes = [
  node('color-mgmt'),
  node('icc', { parentId: 'color-mgmt' }),
  node('process-control', { parentId: 'color-mgmt' }),
];
const baseLeaves = [leaf('k1', 'icc'), leaf('k2', 'icc')];
const tree = (over: Partial<Tree> = {}): Tree => ({ nodes: baseNodes, leaves: baseLeaves, depths: [], ...over });
const find = (r: ReturnType<typeof readCourse>, id: string) => r.children.find((c) => c.nodeId === id)!;

describe('skill tree readings', () => {
  it('icc averages its two skills', () => {
    const r = readCourse(tree(), version({ k1: K1, k2: K2 }), 'icc');
    expect(r).toMatchObject({ k: 2, u: 2, d: 3 });
  });

  it('missing child counts as 0', () => {
    const r = readCourse(tree(), version({ k1: K1, k2: K2 }), 'color-mgmt');
    expect(r).toMatchObject({ k: 1, u: 1, d: 1.5 });
  });

  it('direct leaves count as one child beside parent nodes', () => {
    const t = tree({ leaves: [...baseLeaves, leaf('k3', 'color-mgmt')] });
    const r = readCourse(t, version({ k1: K1, k2: K2, k3: { k: 4, u: 4, d: 4 } }), 'color-mgmt');
    expect(r.k).toBeCloseTo(2);
    expect(r.u).toBeCloseTo(2);
    expect(r.d).toBeCloseTo(7 / 3);
    expect(r.directWeight).toBe(1);
    expect(r.direct).toHaveLength(1);
  });

  it('weights shift the average', () => {
    const t = tree({ nodes: [node('color-mgmt'), node('icc', { parentId: 'color-mgmt', weight: 1 }), node('process-control', { parentId: 'color-mgmt', weight: 3 })] });
    const r = readCourse(t, version({ k1: K1, k2: K2 }), 'color-mgmt');
    expect(r.d).toBeCloseTo(3 / 4);
  });

  it('foundational reads D only', () => {
    const t: Tree = { nodes: [node('agency', { foundational: true })], leaves: [leaf('a1', 'agency')], depths: [] };
    const r = readCourse(t, version({ a1: { k: null, u: null, d: 3 } }), 'agency');
    expect(r).toMatchObject({ k: null, u: null, d: 3 });
  });

  it('hand-set depth overrides and keeps the suggestion', () => {
    const t = tree({ depths: [hand({})] });
    const r = readCourse(t, version({ k1: K1, k2: K2 }), 'color-mgmt');
    const icc = find(r, 'icc');
    expect(icc).toMatchObject({ k: 5, u: 5, d: 5, byHand: true });
    expect(icc.computed).toEqual({ k: 2, u: 2, d: 3 });
    expect(r).toMatchObject({ k: 2.5, u: 2.5, d: 2.5 });
  });

  it('needs review when the leaves under it change', () => {
    const onlyK1: Tree = tree({ leaves: [leaf('k1', 'icc')] });
    const sig = leavesSignature(onlyK1, 'icc', 'GC 3400');
    const t = tree({ depths: [hand({ leavesSignature: sig })] });
    const v = version({ k1: K1, k2: K2 });
    expect(readCourse(t, v, 'icc').needsReview).toBe(true);
    expect(readCourse({ ...onlyK1, depths: t.depths }, v, 'icc').needsReview).toBe(false);
  });

  it('a leaf with two parents splits its share', () => {
    const t = tree({ leaves: [leaf('k1', 'icc'), leaf('k1', 'process-control'), leaf('k2', 'icc')] });
    const r = readCourse(t, version({ k1: K1, k2: K2 }), 'icc');
    expect(r.direct.find((x) => x.skillRef === 'k1')!.weight).toBe(0.5);
    expect(r.direct.find((x) => x.skillRef === 'k2')!.weight).toBe(1);
    expect(r.d).toBeCloseTo((0.5 * 4 + 1 * 2) / 1.5);
  });

  it('gone leaves drop out', () => {
    const r = readCourse(tree(), version({ k1: K1 }), 'icc');
    expect(r).toMatchObject({ k: 3, u: 2, d: 4 });
  });

  it('embedding-only proposals and rejected leaves do not count', () => {
    expect(counts(leaf('a', 'icc', { status: 'proposed', source: 'embedding' }))).toBe(false);
    expect(counts(leaf('a', 'icc', { status: 'proposed', source: 'ai' }))).toBe(true);
    expect(counts(leaf('a', 'icc', { status: 'rejected', source: 'faculty' }))).toBe(false);
    const t = tree({ leaves: [leaf('k1', 'icc'), leaf('k2', 'icc', { status: 'proposed', source: 'embedding' })] });
    expect(readCourse(t, version({ k1: K1, k2: K2 }), 'icc')).toMatchObject({ k: 3, u: 2, d: 4 });
  });

  it('two versions read separately', () => {
    const t = tree({ depths: [hand({ instructor: 'A' })] });
    const a = readCourse(t, version({ k1: K1, k2: K2 }, 'A'), 'icc');
    const b = readCourse(t, version({ k1: { k: 1, u: 1, d: 1 }, k2: { k: 1, u: 1, d: 1 } }, 'B'), 'icc');
    expect(a.byHand).toBe(true);
    expect(b.byHand).toBe(false);
    expect(b).toMatchObject({ k: 1, u: 1, d: 1 });
  });

  it('program takes the stronger version per dimension', () => {
    const t = tree({ leaves: [leaf('k1', 'icc'), leaf('k1p', 'icc', { courseCode: 'GC 4060' })] });
    const v1 = version({ k1: { k: 3, u: 2, d: 4 } });
    const v2 = version({ k1p: { k: 1, u: 3, d: 2 } }, 'A', 'GC 4060');
    const r = readProgram(t, [v1, v2], 'icc');
    expect(r).toMatchObject({ k: 3, u: 3, d: 4 });
  });

  it('merged nodes redirect', () => {
    const t = tree({ nodes: [...baseNodes, node('a', { mergedInto: 'b' }), node('b', { mergedInto: 'icc' })] });
    expect(resolveNode(t, 'a')).toBe('icc');
    expect(resolveNode(t, 'icc')).toBe('icc');
  });

  it('career reading weights masters', () => {
    const t: Tree = {
      nodes: [node('m1'), node('m2')],
      leaves: [leaf('s1', 'm1'), leaf('s2', 'm2')],
      depths: [],
    };
    const v = version({ s1: { k: 4, u: 4, d: 4 }, s2: { k: 2, u: 2, d: 2 } });
    const r = readCareer(t, [v], [{ nodeId: 'm1', weight: 3 }, { nodeId: 'm2', weight: 1 }]);
    expect(r.d).toBeCloseTo(3.5);
  });

  it('meets', () => {
    expect(meets({ k: 3, u: 3, d: 3 }, { k: 3, u: null, d: 2 }, false)).toBe(true);
    expect(meets({ k: 2, u: 3, d: 3 }, { k: 3, u: null, d: 2 }, false)).toBe(false);
    expect(meets({ k: null, u: null, d: 3 }, { k: 4, u: 4, d: 3 }, true)).toBe(true);
    expect(meets({ k: null, u: null, d: 2 }, { k: 4, u: 4, d: 3 }, true)).toBe(false);
  });

  it('career weight prefers employer over faculty over onet over ai; null counts as 1', () => {
    const rows = [
      { competencyId: 'a', weight: 0.2, weightSource: 'ai' as const },
      { competencyId: 'a', weight: 0.3, weightSource: 'onet' as const },
      { competencyId: 'a', weight: 0.4, weightSource: 'faculty' as const },
      { competencyId: 'a', weight: 0.5, weightSource: 'employer' as const },
      { competencyId: 'b', weight: 0.9, weightSource: 'onet' as const },
      { competencyId: 'b', weight: 0.1, weightSource: 'ai' as const },
      { competencyId: 'c', weight: null, weightSource: 'faculty' as const },
      { competencyId: 'd', weight: 0.6, weightSource: 'ai' as const },
      { competencyId: 'd', weight: null, weightSource: 'onet' as const },
    ];
    const w = Object.fromEntries(careerWeights(rows).map((x) => [x.nodeId, x.weight]));
    expect(w).toEqual({ a: 0.5, b: 0.9, c: 1, d: 1 });
  });

  it('isFoundational: the node, an ancestor, or a merge survivor', () => {
    const t = tree({ nodes: [node('a', { foundational: true }), node('b', { parentId: 'a' }), node('c'), node('d', { mergedInto: 'b' })], leaves: [] });
    expect(isFoundational(t, 'a')).toBe(true);
    expect(isFoundational(t, 'b')).toBe(true);
    expect(isFoundational(t, 'd')).toBe(true);
    expect(isFoundational(t, 'c')).toBe(false);
    expect(isFoundational(t, 'missing')).toBe(false);
  });
});
