import { describe, it, expect } from 'vitest';
import { mergeGraph } from '../graph';
import type { StringGraph, StringRow } from '../types';

const row = (id: string, name: string): StringRow => ({ id, name, description: '', status: 'active', endNote: null, mergedInto: null, version: 1, path: [] });
const g = (strings: StringRow[]): StringGraph => ({ strings, points: {}, links: [], events: [] });

describe('mergeGraph', () => {
  it('replaces by id, adds new, and keeps strings the patch does not mention', () => {
    const out = mergeGraph(g([row('a', 'A'), row('b', 'B')]), g([row('b', 'B2'), row('c', 'C')]));
    expect(out.strings.map((s) => [s.id, s.name])).toEqual([['a', 'A'], ['b', 'B2'], ['c', 'C']]);
  });
  it('merges points, links and events too', () => {
    const base = { ...g([]), points: { p: { id: 'p' } as never }, links: [{ id: 'l1' } as never], events: [{ id: 'e1' } as never] };
    const patch = { ...g([]), points: { q: { id: 'q' } as never }, links: [{ id: 'l2' } as never], events: [{ id: 'e1' } as never] };
    const out = mergeGraph(base, patch);
    expect(Object.keys(out.points)).toEqual(['p', 'q']);
    expect(out.links.map((l) => l.id)).toEqual(['l1', 'l2']);
    expect(out.events).toHaveLength(1);
  });
});
