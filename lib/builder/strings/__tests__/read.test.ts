import { describe, expect, it } from 'vitest';
import { readString } from '../read';
import type { PointRow, PointStatus, StringGraph, StringRow } from '../types';

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
});
