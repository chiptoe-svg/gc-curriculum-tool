import { describe, it, expect } from 'vitest';
import { clusterEdges, upstreamOf, wouldCycle } from '../graph';
import { emptyClusterState } from '../state';
import type { Library } from '../../types';

const lib = (prereqs: Array<[string, string] | [string, string, 'concurrent_ok']>): Library => ({
  courses: [], competencies: [], targets: [], candidates: {}, decisions: {},
  prereqs: prereqs.map(([p, c, kind]) => ({ prereqCode: p, courseCode: c, kind: kind ?? ('prereq' as const), anyOfGroup: null })),
});
const cards = (...refs: string[]) => refs.map((ref, i) => ({ ref, x: 0, y: i * 10 }));
const sorted = (s: Set<string>) => [...s].sort();

describe('cluster graph', () => {
  it('upstream follows the whole chain', () => {
    const s = { ...emptyClusterState(), cards: cards('A', 'B', 'C') };
    const e = clusterEdges(lib([['A', 'B'], ['B', 'C']]), s);
    expect(sorted(upstreamOf(e, 'C'))).toEqual(['A', 'B']);
  });
  it('upstream ignores position', () => {
    const s = { ...emptyClusterState(), cards: [{ ref: 'C', x: 0, y: 0 }, { ref: 'A', x: 900, y: 900 }, { ref: 'B', x: 5, y: 500 }] };
    expect(sorted(upstreamOf(clusterEdges(lib([['A', 'B'], ['B', 'C']]), s), 'C'))).toEqual(['A', 'B']);
  });
  it('counts a corequisite as an arrow and skips edges with an end off the canvas', () => {
    const s = { ...emptyClusterState(), cards: cards('A', 'B') };
    const e = clusterEdges(lib([['A', 'B', 'concurrent_ok'], ['Z', 'B']]), s);
    expect(e).toEqual([{ from: 'A', to: 'B', source: 'catalog' }]);
  });
  it('matches a proposed catalog course by its code', () => {
    const proposed = [{ id: 'new:1', source: 'catalog' as const, code: 'GC 1', credits: null, title: '', description: '', objectives: [], depths: [] }];
    const s = { ...emptyClusterState(), cards: cards('new:1', 'B'), proposed };
    expect(clusterEdges(lib([['GC 1', 'B']]), s)).toEqual([{ from: 'new:1', to: 'B', source: 'catalog' }]);
  });
  it('removed catalog arrow cuts the chain', () => {
    const s = { ...emptyClusterState(), cards: cards('A', 'B', 'C'), unlinked: [{ from: 'A', to: 'B' }] };
    expect(sorted(upstreamOf(clusterEdges(lib([['A', 'B'], ['B', 'C']]), s), 'C'))).toEqual(['B']);
  });
  it('drawn arrow adds a supplier', () => {
    const s = { ...emptyClusterState(), cards: cards('A', 'B', 'C'), links: [{ from: 'A', to: 'C' }] };
    const e = clusterEdges(lib([]), s);
    expect(e).toEqual([{ from: 'A', to: 'C', source: 'cluster' }]);
    expect(sorted(upstreamOf(e, 'C'))).toEqual(['A']);
  });
  it('refuses an arrow that closes a loop', () => {
    const e = [{ from: 'GC 1010', to: 'GC 2020' }, { from: 'GC 2020', to: 'GC 3030' }];
    expect(wouldCycle(e, 'GC 3030', 'GC 1010')).toBe('That arrow would make a loop (GC 1010 is already upstream of GC 3030).');
    expect(wouldCycle(e, 'GC 1010', 'GC 3030')).toBeNull();
  });
  it('tolerates a saved cycle', () => {
    const e = [{ from: 'A', to: 'B' }, { from: 'B', to: 'A' }];
    expect(sorted(upstreamOf(e, 'A'))).toEqual(['B']);
  });
});
