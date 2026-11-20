import { describe, expect, it } from 'vitest';
import { readString } from '../read';
import type { PointRow, PointStatus, StringGraph, StringRow } from '../types';
import type { Tree, TreeLeaf, TreeNode, VersionSkills } from '@/lib/skill-tree/types';

const levelOf = (c: string) => Number(c.split(' ')[1]![0]!);
const pt = (id: string, courseCode: string, role: PointRow['role']): PointRow => ({
  id, courseCode, role, statement: id, statementHash: id, snapshotId: null, k: null, u: null, d: null, term: null,
});
const str = (id: string, path: string[], extra: Partial<StringRow> = {}): StringRow => ({
  id, name: id, description: '', status: 'active', endNote: null, mergedInto: null, version: 1, path, ...extra,
});
const graph = (points: PointRow[], strings: StringRow[], links: StringGraph['links'] = []): StringGraph => ({
  points: Object.fromEntries(points.map((p) => [p.id, p])), strings, links, events: [],
});
const dep = (k: number | null, u: number | null, d: number | null): PointStatus => ({
  kind: 'intact', now: { k, u, d },
});
const read = (g: StringGraph, st: Record<string, PointStatus>, id = 'A') =>
  readString(g, id, st, levelOf, { fade: null });

describe('readString', () => {
  it('flags slip', () => {
    const g = graph([pt('p1', 'GC 1040', 'develops'), pt('p2', 'GC 2400', 'develops')], [str('A', ['p1', 'p2'])]);
    const r = read(g, { p1: dep(null, null, 3), p2: dep(null, null, 2) });
    expect(r.stops[0]!.slip).toEqual([]);
    expect(r.stops[1]!.slip).toEqual(['d']);
  });

  it('counts reinforcement for develops within one of peak only', () => {
    const g = graph(
      [pt('p1', 'GC 1040', 'develops'), pt('p2', 'GC 2400', 'develops'), pt('p3', 'GC 3400', 'develops'), pt('p4', 'GC 4800', 'requires')],
      [str('A', ['p1', 'p2', 'p3', 'p4'])],
    );
    const r = read(g, { p1: dep(2, 2, 2), p2: dep(1, 1, 1), p3: dep(0, 0, 0), p4: dep(1, 1, 1) });
    expect(r.reinforcement).toBe(1);
    expect(r.stops[1]!.reinforces).toBe(true);
    expect(r.stops[2]!.reinforces).toBe(false);
    expect(r.stops[3]!.reinforces).toBe(false);
  });

  it('flags gap when need exceeds the running peak', () => {
    const g = graph([pt('p1', 'GC 1040', 'develops'), pt('p2', 'GC 2400', 'requires')], [str('A', ['p1', 'p2'])]);
    expect(read(g, { p1: dep(null, null, 2), p2: dep(null, null, 3) }).stops[1]!.gap).toEqual(['d']);
    expect(read(g, { p1: dep(null, null, 2), p2: dep(null, null, 2) }).stops[1]!.gap).toEqual([]);
  });

  it('reads ends and merges', () => {
    const g = graph([pt('p1', 'GC 1040', 'develops'), pt('p2', 'GC 2400', 'develops')], [
      str('A', ['p1', 'p2'], { endNote: 'n' }),
      str('B', ['p1', 'p2'], { mergedInto: 'A' }),
    ]);
    expect(read(g, {}).end).toEqual({ kind: 'ends', courseCode: 'GC 2400', act: 1, note: 'n' });
    expect(read(g, {}, 'B').end).toEqual({ kind: 'merges', into: 'A', courseCode: 'GC 2400' });
  });

  it('reports mergedIn and sharedWith, ignoring unlocked strings', () => {
    const pts = [pt('p1', 'GC 1040', 'develops'), pt('p2', 'GC 2400', 'develops'), pt('p3', 'GC 3400', 'develops'),
      pt('q', 'GC 2400', 'requires'), pt('x', 'GC 4800', 'develops')];
    const g = graph(pts, [
      str('A', ['p1', 'p2', 'p3']),
      str('B', ['q', 'p3'], { mergedInto: 'A' }),
      str('C', ['p1', 'p2', 'x']),
      str('D', ['q', 'p3', 'x']),
      str('U', ['p1', 'p2', 'x'], { status: 'unlocked' }),
    ]);
    const r = read(g, {});
    expect(r.stops[2]!.mergedIn).toEqual(['B']);
    expect(r.stops[1]!.sharedWith).toEqual([{ stringId: 'C', relation: 'branches' }]);
    expect(r.stops[0]!.sharedWith).toEqual([]);
    expect(r.stops[2]!.sharedWith).toEqual([{ stringId: 'D', relation: 'joins' }]);
  });

  it('throws on fade', () => {
    const g = graph([pt('p1', 'GC 1040', 'develops')], [str('A', ['p1'])]);
    expect(() => readString(g, 'A', {}, levelOf, { fade: 1 })).toThrow('fade not implemented');
  });

  it('an unhooked skill no longer counts', () => {
    const pts = [pt('p1', 'GC 1040', 'develops'), pt('p2', 'GC 2400', 'develops'), pt('p3', 'GC 4800', 'requires')];
    const st = { p1: dep(null, null, 2), p2: dep(null, null, 3), p3: dep(null, null, 3) };
    const withMid = read(graph(pts, [str('A', ['p1', 'p2', 'p3'])]), st);
    expect(withMid.stops[2]!.gap).toEqual([]);
    expect(withMid.reinforcement).toBe(1);
    const without = read(graph(pts, [str('A', ['p1', 'p3'])]), st);
    expect(without.stops[1]!.gap).toEqual(['d']);
    expect(without.reinforcement).toBe(0);
  });

  it('uses now for changed, and skips unanchored/unchecked', () => {
    const pts = [pt('p1', 'GC 1040', 'develops'), pt('p2', 'GC 2400', 'develops'), pt('p3', 'GC 4800', 'requires')];
    const g = graph(pts, [str('A', ['p1', 'p2', 'p3'])]);
    const r = read(g, {
      p1: { kind: 'changed', now: { k: null, u: null, d: 3 }, candidate: { statement: 's', hash: 'h' } },
      p2: { kind: 'unanchored', why: 'skill gone' },
      p3: dep(null, null, 3),
    });
    expect(r.stops[0]!.depth).toEqual({ k: null, u: null, d: 3 });
    expect(r.stops[1]!.depth).toBeNull();
    expect(r.stops[2]!.gap).toEqual([]);
    expect(read(g, {}).stops[1]!.status).toEqual({ kind: 'unchecked' });
  });

  it('carries the link why into a stop', () => {
    const g = graph([pt('p1', 'GC 1040', 'develops'), pt('p2', 'GC 2400', 'develops')], [str('A', ['p1', 'p2'])],
      [{ id: 'l', from: 'p1', to: 'p2', why: 'builds on', createdBy: 'x', createdAt: '' }]);
    const r = read(g, {});
    expect(r.stops[0]!.why).toBeNull();
    expect(r.stops[1]!.why).toBe('builds on');
  });

  it('uses the lock-time depth for an unchecked stop: no gap, and it reinforces', () => {
    const withDepth = (p: PointRow, d: number): PointRow => ({ ...p, d });
    const pts = [
      withDepth(pt('p1', 'GC 1040', 'develops'), 2),
      withDepth(pt('p2', 'GC 2400', 'develops'), 3),
      withDepth(pt('p3', 'GC 4800', 'requires'), 2),
    ];
    const r = read(graph(pts, [str('A', ['p1', 'p2', 'p3'])]), {});
    expect(r.stops[1]!.depth).toEqual({ k: null, u: null, d: 3 });
    expect(r.stops[2]!.gap).toEqual([]);
    const two = read(graph([pts[1]!, pts[2]!, withDepth(pt('p4', 'GC 4900', 'develops'), 3)], [str('B', ['p2', 'p3', 'p4'])]), {}, 'B');
    expect(two.stops[2]!.reinforces).toBe(true);
    expect(two.reinforcement).toBe(1);
  });
});

describe('readString: a requires stop that names a tree skill', () => {
  const node = (id: string, over: Partial<TreeNode> = {}): TreeNode => ({
    id, name: id, description: null, parentId: null, competencyId: null, foundational: false,
    weight: 1, weightSource: 'default', mergedInto: null, retired: false, ...over,
  });
  const leaf = (courseCode: string, skillRef: string, nodeId: string): TreeLeaf => ({
    courseCode, skillRef, nodeId, statement: skillRef, share: null, source: 'faculty', status: 'confirmed',
  });
  const tree: Tree = {
    nodes: [node('icc'), node('icc-old', { mergedInto: 'icc' })],
    leaves: [leaf('GC 1040', 's1', 'icc'), leaf('GC 2400', 's2', 'icc-old'), leaf('GC 3400', 's3', 'icc')],
    depths: [],
  };
  const ver = (courseCode: string, ref: string, d: number): VersionSkills =>
    ({ courseCode, instructor: '', skills: new Map([[ref, { k: d, u: d, d }]]) });
  const versions: Record<string, VersionSkills[]> = {
    'GC 1040': [ver('GC 1040', 's1', 4)], 'GC 2400': [ver('GC 2400', 's2', 3)], 'GC 3400': [ver('GC 3400', 's3', 5)],
  };
  const need = (p: PointRow, n: number | null): PointRow => ({ ...p, nodeId: 'icc', needK: null, needU: null, needD: n });
  const readT = (g: StringGraph, id = 'A') =>
    readString(g, id, {}, levelOf, { fade: null, tree, versionsOf: (c) => versions[c] ?? [] });

  it('passes when the arriving courses reach the depth', () => {
    const g = graph([pt('p1', 'GC 1040', 'develops'), need(pt('p2', 'GC 2400', 'requires'), 4)], [str('A', ['p1', 'p2'])]);
    const s = readT(g).stops[1]!;
    expect(s.nodeCheck).toMatchObject({ kind: 'checked', met: true });
    expect(s.gap).toEqual([]);
  });

  it('fails when only a non-upstream course reaches it', () => {
    // GC 3400 (depth 5) is downstream on this string; GC 1040 is not on it at all.
    const g = graph([pt('p0', 'GC 2000', 'develops'), need(pt('p2', 'GC 2400', 'requires'), 4), pt('p3', 'GC 3400', 'develops')],
      [str('A', ['p0', 'p2', 'p3']), str('B', ['p0'])]);
    const s = readT(g).stops[1]!;
    expect(s.nodeCheck).toMatchObject({ kind: 'checked', met: false });
    expect(s.gap).toEqual(['d']);
  });

  it('uses the stronger of two arriving strings', () => {
    const q = need(pt('q', 'GC 4000', 'requires'), 4);
    const g = graph([pt('a', 'GC 2400', 'develops'), pt('b', 'GC 1040', 'develops'), q], [str('A', ['a', 'q']), str('B', ['b', 'q'])]);
    // GC 2400 reaches 3 (short of 4); GC 1040 reaches 4: the string through GC 2400 passes because the other arrives too.
    expect(readT(g, 'A').stops[1]!.nodeCheck).toMatchObject({ kind: 'checked', met: true });
  });

  it('follows a merged node', () => {
    // GC 2400 placed its skill on icc-old, which merged into icc.
    const g = graph([pt('p1', 'GC 2400', 'develops'), need(pt('p2', 'GC 3000', 'requires'), 3)], [str('A', ['p1', 'p2'])]);
    expect(readT(g).stops[1]!.nodeCheck).toMatchObject({ kind: 'checked', met: true });
    const named = graph([pt('p1', 'GC 2400', 'develops'), { ...need(pt('p2', 'GC 3000', 'requires'), 3), nodeId: 'icc-old' }], [str('A', ['p1', 'p2'])]);
    expect(readT(named).stops[1]!.nodeCheck).toMatchObject({ kind: 'checked', met: true });
  });

  it('is not checkable without a tree, and a stop without a node keeps the statement check', () => {
    const g = graph([pt('p1', 'GC 1040', 'develops'), need(pt('p2', 'GC 2400', 'requires'), 4)], [str('A', ['p1', 'p2'])]);
    expect(read(g, {}).stops[1]!.nodeCheck).toEqual({ kind: 'not-checkable' });
    const plain = graph([pt('p1', 'GC 1040', 'develops'), pt('p2', 'GC 2400', 'requires')], [str('A', ['p1', 'p2'])]);
    expect(readT(plain).stops[1]!.nodeCheck).toBeNull();
  });
});
