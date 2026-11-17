import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useState } from 'react';
import { emptyClusterState, type ClusterState } from '@/lib/builder/cluster/state';
import type { ClusterStatus, StatusResult } from '@/lib/builder/cluster/status';
import type { Library, LibraryCourse } from '@/lib/builder/types';
import { ClusterCanvas, nextCardSpot } from '../ClusterCanvas';

afterEach(cleanup);

const course = (code: string): LibraryCourse => ({
  code, title: `Title of ${code}`, level: 1, category: 'gc_core', track: 'Core', description: '', credits: null, wiki: null,
  objectives: [], sheetProjects: [], stated: [], whatIfs: [], versions: [],
});
const lib = (prereqs: Array<[string, string]> = []): Library => ({
  courses: [course('GC 1010'), course('GC 2070'), course('GC 4400')], competencies: [], targets: [], candidates: {}, decisions: {},
  prereqs: prereqs.map(([p, c]) => ({ prereqCode: p, courseCode: c, kind: 'prereq' as const, anyOfGroup: null })),
});
const state = (over: Partial<ClusterState> = {}): ClusterState => ({
  ...emptyClusterState(),
  cards: [{ ref: 'GC 1010', x: 20, y: 20 }, { ref: 'GC 2070', x: 300, y: 20 }, { ref: 'GC 4400', x: 600, y: 20 }],
  ...over,
});

/** The canvas as ClusterBuilder mounts it: the builder owns the state; `seen` records every state it was given. */
function mount(l: Library, initial: ClusterState, statuses: Record<string, StatusResult[]> = {}) {
  const seen: ClusterState[] = [];
  let updates = 0;
  function Harness() {
    const [s, setS] = useState(initial);
    seen.push(s);
    return (
      <ClusterCanvas library={l} state={s} statuses={statuses} selected={null} onSelect={() => {}}
        update={fn => { updates++; setS(prev => fn(prev)); }} />
    );
  }
  render(<Harness />);
  return { last: () => seen[seen.length - 1]!, updates: () => updates };
}
const draw = (from: string, to: string) => {
  fireEvent.pointerDown(screen.getByRole('button', { name: `Draw an arrow from ${from}` }));
  fireEvent.pointerUp(screen.getByRole('group', { name: `${to} Title of ${to}` }));
};

describe('ClusterCanvas', () => {
  it('drawing an arrow adds a link', () => {
    const m = mount(lib(), state());
    draw('GC 1010', 'GC 2070');
    expect(m.last().links).toEqual([{ from: 'GC 1010', to: 'GC 2070' }]);
    expect(screen.getByRole('button', { name: 'Arrow from GC 1010 to GC 2070' })).toBeInTheDocument();
  });

  it('removing a catalog arrow adds it to unlinked', () => {
    const m = mount(lib([['GC 1010', 'GC 2070']]), state());
    fireEvent.click(screen.getByRole('button', { name: 'Arrow from GC 1010 to GC 2070' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove arrow' }));
    expect(m.last().unlinked).toEqual([{ from: 'GC 1010', to: 'GC 2070' }]);
    expect(m.last().links).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Arrow from GC 1010 to GC 2070' })).toBeNull();
    // Drawing it again takes it back out of unlinked rather than adding a second arrow.
    draw('GC 1010', 'GC 2070');
    expect(m.last().unlinked).toEqual([]);
    expect(m.last().links).toEqual([]);
  });

  it('removing a drawn arrow takes it out of links', () => {
    const m = mount(lib(), state({ links: [{ from: 'GC 1010', to: 'GC 4400' }] }));
    fireEvent.click(screen.getByRole('button', { name: 'Arrow from GC 1010 to GC 4400' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove arrow' }));
    expect(m.last().links).toEqual([]);
    expect(m.last().unlinked).toEqual([]);
  });

  it('a loop arrow shows the refusal and does not change state', () => {
    const start = state({ links: [{ from: 'GC 1010', to: 'GC 2070' }, { from: 'GC 2070', to: 'GC 4400' }] });
    const m = mount(lib(), start);
    draw('GC 4400', 'GC 1010');
    expect(screen.getByRole('alert')).toHaveTextContent('That arrow would make a loop (GC 1010 is already upstream of GC 4400).');
    expect(m.updates()).toBe(0);
    expect(m.last()).toBe(start);
  });

  it('card shows counts from statuses', () => {
    const r = (status: ClusterStatus) => ({ status } as StatusResult);
    mount(lib(), state(), { 'GC 2070': [r('met'), r('met_set'), r('partly'), r('parts_met'), r('not')], 'GC 4400': [r('met'), r('pending')] });
    expect(screen.getByRole('group', { name: 'GC 2070 Title of GC 2070' })).toHaveTextContent('2 met · 2 partly · 1 not');
    expect(screen.getByRole('group', { name: 'GC 4400 Title of GC 4400' })).toHaveTextContent('1 met · 0 partly · 0 not · 1 matching');
  });

  it('marks a proposed or edited course', () => {
    const s = state({
      cards: [{ ref: 'GC 1010', x: 20, y: 20 }, { ref: 'new-1', x: 300, y: 20 }],
      proposed: [{ id: 'new-1', source: 'new', code: 'GC 4xxx', credits: null, title: 'Draft course', description: '', objectives: [], depths: [] }],
    });
    mount(lib(), s);
    expect(screen.getByRole('group', { name: 'GC 4xxx Draft course' })).toHaveTextContent('proposed');
    expect(screen.getByRole('group', { name: 'GC 1010 Title of GC 1010' })).not.toHaveTextContent('proposed');
  });

  it('a new card lands right of the rightmost card', () => {
    expect(nextCardSpot([])).toEqual({ x: 40, y: 40 });
    const spot = nextCardSpot([{ ref: 'A', x: 20, y: 300 }, { ref: 'B', x: 500, y: 60 }]);
    expect(spot.y).toBe(60);
    expect(spot.x).toBeGreaterThan(500 + 184);
  });
});
