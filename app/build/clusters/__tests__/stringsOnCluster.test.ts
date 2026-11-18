import { describe, it, expect } from 'vitest';
import { textHash } from '@/lib/catalog/bundles';
import { normalizeStatement } from '@/lib/catalog/project-trail';
import { WHAT_IF_PREFIX } from '@/lib/builder/compute';
import { emptyClusterState, type ClusterState } from '@/lib/builder/cluster/state';
import type { Library, LibraryCourse } from '@/lib/builder/types';
import type { StringGraph } from '@/lib/builder/strings/types';
import { addOptions, colorOf, lockPoint, lockTargets, type SkillInput } from '../stringsOnCluster';

const SNAP = '8b1f0c2e-0000-4000-8000-0000000000a1';
const course: LibraryCourse = {
  code: 'GC 1010', title: 'T', level: 1, category: 'gc_core', track: 'Core', description: '', credits: null, wiki: null,
  objectives: [], sheetProjects: [], stated: [], whatIfs: [{ id: 'w1', title: 'What if', baseSnapshotId: SNAP, skills: { developed: [], required: [], objectives: [] } }] as never,
  versions: [{
    snapshotId: SNAP, instructorName: null, createdAt: '2026-01-01T00:00:00.000Z', depths: [], outcomes: [], disagreements: [], projects: [],
    conditions: null, unmapped: [], suggestions: [], linked: false,
    skills: [{ skillRef: 'x', statement: 'Mix ink', k: 3, u: 2, d: 4 }],
    required: [{ ref: 'y', statement: 'Read a ticket', need: { k: 1, u: null, d: 2 } }],
  }],
};
const lib: Library = { courses: [course], competencies: [], targets: [], candidates: {}, decisions: {}, prereqs: [] };
const state = (over: Partial<ClusterState> = {}): ClusterState => ({ ...emptyClusterState(), cards: [{ ref: 'GC 1010', x: 0, y: 0 }, { ref: 'new-1', x: 300, y: 0 }], ...over });

describe('lockPoint', () => {
  it('a captured statement is lockable with the snapshot and depths from versions[0]', () => {
    expect(lockPoint(lib, state(), 'GC 1010', 'develops', 'Mix ink')).toEqual({ courseCode: 'GC 1010', role: 'develops', statement: 'Mix ink', snapshotId: SNAP, k: 3, u: 2, d: 4 });
    expect(lockPoint(lib, state(), 'GC 1010', 'requires', 'Read a ticket')).toMatchObject({ snapshotId: SNAP, k: 1, u: null, d: 2 });
  });
  it('depths come from the capture, not from a map edit of the same skill', () => {
    const edited = state({ courseEdits: { 'GC 1010': { objectives: [], required: [], developed: [{ id: 'e', kind: 'edit', ref: 'x', statement: 'Mix ink', k: 0, u: 0, d: 0 }] } } as never });
    expect(lockPoint(lib, edited, 'GC 1010', 'develops', 'Mix ink')).toMatchObject({ k: 3, u: 2, d: 4 });
  });
  it('a what-if version chosen on the cluster is not lockable', () => {
    expect(lockPoint(lib, state({ versions: { 'GC 1010': `${WHAT_IF_PREFIX}w1` } }), 'GC 1010', 'develops', 'Mix ink')).toBeNull();
  });
  it('a proposed course ref is not lockable', () => {
    expect(lockPoint(lib, state(), 'new-1', 'develops', 'Mix ink')).toBeNull();
  });
  it('an edited or drafted statement (not in versions[0] as written) is not lockable', () => {
    expect(lockPoint(lib, state(), 'GC 1010', 'develops', 'Mix ink to a spot color')).toBeNull();
    expect(lockPoint(lib, state(), 'GC 1010', 'requires', 'Mix ink')).toBeNull();
  });
  it('a course with no capture is not lockable', () => {
    expect(lockPoint({ ...lib, courses: [{ ...course, versions: [] }] }, state(), 'GC 1010', 'develops', 'Mix ink')).toBeNull();
  });
});

describe('lockTargets', () => {
  it('lists the captured skills of catalog cards only, and none under a chosen what-if', () => {
    expect(lockTargets(lib, state()).map(p => `${p.role}:${p.statement}`)).toEqual(['develops:Mix ink', 'requires:Read a ticket']);
    expect(lockTargets(lib, state({ versions: { 'GC 1010': `${WHAT_IF_PREFIX}w1` } }))).toEqual([]);
  });
});

describe('addOptions', () => {
  const sk = (courseCode: string, role: 'develops' | 'requires', statement: string): SkillInput => ({ courseCode, role, statement, snapshotId: SNAP, k: 1, u: 1, d: 1 });
  const S = sk('GC 1010', 'develops', 'Mix ink'), R = sk('GC 3400', 'requires', 'Read a ticket'), Z = sk('GC 4400', 'requires', 'Plan');
  const row = (id: string, p: SkillInput) => ({ id, ...p, statementHash: textHash(normalizeStatement(p.statement)), term: null });
  const g = (path: Array<[string, SkillInput]>, mergedInto: string | null): StringGraph => ({
    strings: [{ id: 's1', name: 'Ink', description: '', status: 'active', endNote: null, mergedInto, version: 1, path: path.map(([i]) => i) }],
    points: Object.fromEntries(path.map(([i, p]) => [i, row(i, p)])), links: [], events: [],
  });
  it('offers extend-end for a string ending at the supplier', () => {
    expect(addOptions(g([['a', Z], ['b', S]], null), R, [S]).map(o => o.kind)).toEqual(['extend-end']);
  });
  it('offers no extend-end on a string that merges into another, but keeps branch at a mid stop', () => {
    expect(addOptions(g([['a', Z], ['b', S]], 'other'), R, [S])).toEqual([]);
    expect(addOptions(g([['a', S], ['b', Z]], 'other'), R, [S]).map(o => o.kind)).toEqual(['branch']);
  });
});

describe('colorOf', () => {
  it('is stable per id and in range', () => {
    expect(colorOf('abc')).toBe(colorOf('abc'));
    for (const id of ['a', 'b', '8b1f0c2e-0000-4000-8000-0000000000b1']) expect(colorOf(id)).toBeGreaterThanOrEqual(0), expect(colorOf(id)).toBeLessThan(6);
  });
});
