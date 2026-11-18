import { describe, it, expect } from 'vitest';
import { emptyClusterState, parseClusterState, readClusterState } from '../state';

describe('cluster state', () => {
  it('round-trips an empty state', () => {
    const s = emptyClusterState();
    expect(parseClusterState(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
  it('rejects 41 cards', () => {
    const cards = Array.from({ length: 41 }, (_, i) => ({ ref: `C${i}`, x: 0, y: 0 }));
    expect(parseClusterState({ ...emptyClusterState(), cards })).toBeNull();
    expect(parseClusterState({ ...emptyClusterState(), cards: cards.slice(0, 40) })).not.toBeNull();
  });
  it('rejects an objective over 500 chars', () => {
    const obj = (n: number) => ({ ...emptyClusterState(), objectives: [{ id: 'o1', text: 'x'.repeat(n) }] });
    expect(parseClusterState(obj(501))).toBeNull();
    expect(parseClusterState(obj(500))).not.toBeNull();
  });
  it('reads a saved state, filling fields a newer build added, and refuses one it cannot read', () => {
    const older: Record<string, unknown> = { ...emptyClusterState(), cards: [{ ref: 'GC 1010', x: 10, y: 20 }] };
    delete older.overrides;
    expect(readClusterState(older)).toEqual({ ...emptyClusterState(), cards: [{ ref: 'GC 1010', x: 10, y: 20 }] });
    expect(readClusterState(null)).toEqual(emptyClusterState());
    expect(readClusterState({ cards: 'not a list' })).toBeNull();
    expect(readClusterState([1, 2])).toBeNull();
    expect(readClusterState('text')).toBeNull();
  });
});
