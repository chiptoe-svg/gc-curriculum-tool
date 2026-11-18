import { describe, expect, it } from 'vitest';
import { textHash } from '@/lib/catalog/bundles';
import { normalizeStatement } from '@/lib/catalog/project-trail';
import type { Library } from '../../types';
import { courseChanges, mapStringSegments, orphansOf, stringChanges, stringsAt } from '../touch';
import type { EventRow, LinkRow, OrphanNote, PointRow, PointStatus, StringGraph, StringRow } from '../types';

const levelOf = (c: string) => Number(c.split(' ')[1]![0]!);
const h = (s: string) => textHash(normalizeStatement(s));
const pt = (id: string, courseCode: string, role: PointRow['role'], over: Partial<PointRow> = {}): PointRow => ({
  id, courseCode, role, statement: id, statementHash: h(id), snapshotId: null, k: null, u: null, d: null, term: null, ...over,
});
const str = (id: string, path: string[], over: Partial<StringRow> = {}): StringRow => ({
  id, name: id, description: '', status: 'active', endNote: null, mergedInto: null, version: 1, path, ...over,
});
const link = (id: string, from: string, to: string, why: string | null = 'because'): LinkRow => ({
  id, from, to, why, createdBy: 'x', createdAt: '2026-01-01',
});
const graph = (points: PointRow[], strings: StringRow[], links: LinkRow[] = [], events: EventRow[] = []): StringGraph => ({
  points: Object.fromEntries(points.map((p) => [p.id, p])), strings, links, events,
});
const dep = (k: number | null, u: number | null, d: number | null): PointStatus => ({ kind: 'intact', now: { k, u, d } });
const removed = (at: string, pointId: string, path: string[], courseCode: string): EventRow => ({
  id: `e-${at}`, stringId: 'A', pointId, kind: 'point_removed', at, by: 'x', reason: 'r', before: { path, courseCode }, after: { path: path.filter((p) => p !== pointId) },
});

describe('stringsAt', () => {
  it('returns active strings with a point in the course only', () => {
    const g = graph([pt('p1', 'GC 1040', 'develops'), pt('p2', 'GC 2400', 'develops')], [
      str('A', ['p1', 'p2']), str('B', ['p1', 'p2'], { status: 'unlocked' }),
    ]);
    expect(stringsAt(g, 'GC 2400').map((s) => s.id)).toEqual(['A']);
    expect(stringsAt(g, 'GC 9999')).toEqual([]);
  });
});

describe('stringChanges', () => {
  const base = () => graph([pt('p1', 'GC 1040', 'develops'), pt('p2', 'GC 2400', 'requires')], [str('A', ['p1', 'p2'])], [link('l1', 'p1', 'p2')]);

  it('reworded and unanchored', () => {
    const st: Record<string, PointStatus> = {
      p1: { kind: 'changed', now: null, candidate: { statement: 'New words', hash: 'h' } },
      p2: { kind: 'unanchored', why: 'skill gone' },
    };
    expect(stringChanges(base(), st, 'A', levelOf).map((c) => [c.kind, c.text])).toEqual([
      ['reworded', 'Reworded at GC 1040: "New words"'],
      ['unanchored', 'No longer anchored at GC 2400'],
    ]);
  });

  it('no-why on a link without a reason', () => {
    const g = graph([pt('p1', 'GC 1040', 'develops'), pt('p2', 'GC 2400', 'requires')], [str('A', ['p1', 'p2'])], [link('l1', 'p1', 'p2', null)]);
    const items = stringChanges(g, {}, 'A', levelOf);
    expect(items).toEqual([{ kind: 'no-why', courseCode: 'GC 1040', linkId: 'l1', text: 'Carried on past GC 1040; no reason given yet' }]);
  });

  it('unhooking a D3 point before a need-D3 stop', () => {
    const pts = [
      pt('p1', 'GC 1040', 'develops', { d: 2 }), pt('p2', 'GC 2400', 'develops', { k: 2, u: 2, d: 3 }),
      pt('p3', 'GC 4800', 'requires'),
    ];
    // p1 now D2/K2/U2; p2 removed from path.
    const g = graph(pts, [str('A', ['p1', 'p3'])], [link('l1', 'p1', 'p3', null)], [removed('2026-02-01', 'p2', ['p1', 'p2', 'p3'], 'GC 2400')]);
    const st = { p1: dep(2, 2, 2), p2: dep(2, 2, 3), p3: dep(1, 1, 1) };
    const texts = stringChanges(g, st, 'A', levelOf).map((c) => c.text);
    expect(texts).toContain('Unhooked from GC 2400; its building no longer counts');
    expect(texts).toContain('The depth reaching GC 4800 is now K2 U2 D2, was K2 U2 D3');
    expect(texts).toContain('Carried on past GC 2400; no reason given yet');
    expect(texts[0]).toBe('Unhooked from GC 2400; its building no longer counts');
  });

  it('end points removed do not count as unhooked', () => {
    const g = graph([pt('p1', 'GC 1040', 'develops'), pt('p2', 'GC 2400', 'develops'), pt('p3', 'GC 3400', 'develops')], [str('A', ['p1', 'p2'])], [link('l1', 'p1', 'p2')],
      [removed('2026-02-01', 'p3', ['p1', 'p2', 'p3'], 'GC 3400')]);
    expect(stringChanges(g, {}, 'A', levelOf)).toEqual([]);
  });

  it('depth-moved from lock time only when the depth differs', () => {
    const g = graph([pt('p1', 'GC 1040', 'develops', { d: 3 }), pt('p2', 'GC 2400', 'requires')], [str('A', ['p1', 'p2'])], [link('l1', 'p1', 'p2')]);
    expect(stringChanges(g, { p1: dep(null, null, 2), p2: dep(null, null, 2) }, 'A', levelOf).map((c) => c.text))
      .toEqual(['The depth reaching GC 2400 is now K– U– D2, was K– U– D3']);
    expect(stringChanges(g, { p1: dep(null, null, 3), p2: dep(null, null, 2) }, 'A', levelOf)).toEqual([]);
  });

  it('no depth-moved for an unchecked stop or an empty status map', () => {
    const g = graph([pt('p1', 'GC 1040', 'develops', { d: 3 }), pt('p2', 'GC 2400', 'requires')], [str('A', ['p1', 'p2'])], [link('l1', 'p1', 'p2')]);
    expect(stringChanges(g, { p1: { kind: 'unchecked' } }, 'A', levelOf)).toEqual([]);
    expect(stringChanges(g, {}, 'A', levelOf)).toEqual([]);
  });

  it('an unanchored develops stop is a real drop', () => {
    const g = graph([pt('p1', 'GC 1040', 'develops', { d: 3 }), pt('p2', 'GC 2400', 'requires')], [str('A', ['p1', 'p2'])], [link('l1', 'p1', 'p2')]);
    const texts = stringChanges(g, { p1: { kind: 'unanchored', why: 'skill gone' } }, 'A', levelOf).map((c) => c.text);
    expect(texts).toContain('The depth reaching GC 2400 is now K– U– D–, was K– U– D3');
  });

  it('unhook still fires with no status entry for the removed point', () => {
    const pts = [pt('p1', 'GC 1040', 'develops', { k: 2, u: 2, d: 2 }), pt('p2', 'GC 2400', 'develops', { k: 2, u: 2, d: 3 }), pt('p3', 'GC 4800', 'requires')];
    const g = graph(pts, [str('A', ['p1', 'p3'])], [link('l1', 'p1', 'p3', null)], [removed('2026-02-01', 'p2', ['p1', 'p2', 'p3'], 'GC 2400')]);
    const texts = stringChanges(g, { p1: dep(2, 2, 2) }, 'A', levelOf).map((c) => c.text);
    expect(texts).toContain('The depth reaching GC 4800 is now K2 U2 D2, was K2 U2 D3');
  });

  it('works on an unlocked string', () => {
    const g = graph([pt('p1', 'GC 1040', 'develops'), pt('p2', 'GC 2400', 'requires')], [str('A', ['p1', 'p2'], { status: 'unlocked' })], [link('l1', 'p1', 'p2')]);
    expect(stringChanges(g, { p2: { kind: 'unanchored', why: 'no capture' } }, 'A', levelOf)).toHaveLength(1);
  });
});

describe('courseChanges', () => {
  it('limits to the course and skips unlocked strings', () => {
    const pts = [pt('p1', 'GC 1040', 'develops'), pt('p2', 'GC 2400', 'requires')];
    const st: Record<string, PointStatus> = { p1: { kind: 'unanchored', why: 'skill gone' }, p2: { kind: 'unanchored', why: 'skill gone' } };
    const g = graph(pts, [str('A', ['p1', 'p2'])], [link('l1', 'p1', 'p2')]);
    expect(courseChanges(g, st, 'GC 2400', levelOf).map((c) => c.text)).toEqual(['No longer anchored at GC 2400']);
    const u = graph(pts, [str('A', ['p1', 'p2'], { status: 'unlocked' })], [link('l1', 'p1', 'p2')]);
    expect(courseChanges(u, st, 'GC 2400', levelOf)).toEqual([]);
  });
});

describe('orphansOf', () => {
  const lib = {
    courses: [{
      code: 'GC 2400',
      versions: [{
        skills: [{ skillRef: 's1', statement: 'Mix ink', k: 1, u: 1, d: 1 }, { skillRef: 's2', statement: 'Clean rollers', k: 1, u: 1, d: 1 }, { skillRef: 's3', statement: 'Pull a proof', k: 1, u: 1, d: 1 }],
        required: [
          { ref: 'r1', statement: 'Read a spec', need: { k: 1, u: 1, d: 1 } },
          { ref: 'r2', statement: 'Name a press', need: { k: 1, u: 1, d: 1 } },
        ],
      }],
    }],
  } as unknown as Library;
  const pts = [
    pt('p0', 'GC 1040', 'develops'),
    pt('p1', 'GC 2400', 'develops', { statement: 'Mix ink', statementHash: h('Mix ink') }),
    pt('p2', 'GC 2400', 'requires', { statement: 'Read a spec', statementHash: h('Read a spec') }),
    pt('p3', 'GC 2400', 'develops', { statement: 'Clean rollers', statementHash: h('Clean rollers') }),
  ];

  it('excludes skills on active strings, includes those only on unlocked ones, attaches notes', () => {
    const g = graph(pts, [str('A', ['p0', 'p2', 'p1']), str('B', ['p0', 'p3'], { status: 'unlocked' })]);
    const note: OrphanNote = { courseCode: 'GC 2400', role: 'develops', statementHash: h('Pull a proof'), statement: 'Pull a proof', reason: 'taught late', by: 'x', at: '2026-01-01' };
    const r = orphansOf(lib, g, [note], 'GC 2400');
    expect(r.developed).toEqual([
      { statement: 'Clean rollers', hash: h('Clean rollers'), note: null },
      { statement: 'Pull a proof', hash: h('Pull a proof'), note: 'taught late' },
    ]);
    expect(r.unsupplied.map((s) => s.statement)).toEqual(['Name a press']);
  });

  it('a requires point in another course with the same hash does not supply this course', () => {
    const other = pt('px', 'GC 3400', 'requires', { statement: 'Read a spec', statementHash: h('Read a spec') });
    const g = graph([...pts, other], [str('A', ['p0', 'px'])]);
    expect(orphansOf(lib, g, [], 'GC 2400').unsupplied.map((s) => s.statement)).toContain('Read a spec');
  });

  it('a requires point with no earlier develops is unsupplied', () => {
    const g = graph(pts, [str('A', ['p2', 'p1'])]);
    expect(orphansOf(lib, g, [], 'GC 2400').unsupplied.map((s) => s.statement)).toEqual(['Read a spec', 'Name a press']);
  });
});

describe('mapStringSegments', () => {
  const pts = [pt('a', 'GC 1040', 'develops'), pt('b', 'GC 2400', 'develops'), pt('c', 'GC 4800', 'develops')];
  it('draws one segment and one stub when the last course is off the map', () => {
    const g = graph(pts, [str('A', ['a', 'b', 'c'])]);
    expect(mapStringSegments(g, new Set(['GC 1040', 'GC 2400']))).toEqual([
      { stringId: 'A', from: 'GC 1040', to: 'GC 2400', kind: 'segment' },
      { stringId: 'A', from: 'GC 2400', leaves: 'GC 4800' },
    ]);
  });
  it('yields nothing for an unlocked string', () => {
    const g = graph(pts, [str('A', ['a', 'b', 'c'], { status: 'unlocked' })]);
    expect(mapStringSegments(g, new Set(['GC 1040', 'GC 2400', 'GC 4800']))).toEqual([]);
  });
  it('marks the last hop of a merged string as a merge', () => {
    const g = graph(pts, [str('A', ['a', 'b', 'c']), str('B', ['a', 'b'], { mergedInto: 'A' })]);
    const segs = mapStringSegments(g, new Set(['GC 1040', 'GC 2400', 'GC 4800']));
    expect(segs.filter((x) => x.stringId === 'B')).toEqual([{ stringId: 'B', from: 'GC 1040', to: 'GC 2400', kind: 'merge' }]);
  });
});
