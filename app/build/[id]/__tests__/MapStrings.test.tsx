// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MapStrings, MapStringsLayer } from '../MapStrings';
import type { PointRow, StringGraph } from '@/lib/builder/strings/types';

const pt = (id: string, courseCode: string): PointRow => ({
  id, courseCode, role: 'develops', statement: id, statementHash: id, snapshotId: null, k: null, u: null, d: null, term: null,
});
const graph: StringGraph = {
  points: { a: pt('a', 'GC 1040'), b: pt('b', 'GC 2400'), c: pt('c', 'GC 4800') },
  strings: [{ id: 'A', name: 'Color', description: '', status: 'active', endNote: null, mergedInto: null, version: 1, path: ['a', 'b', 'c'] }],
  links: [], events: [],
};
const cards = { r1: { x: 10, y: 10, w: 100, h: 50 }, r2: { x: 200, y: 120, w: 100, h: 50 } };
const refOf = { 'GC 1040': 'r1', 'GC 2400': 'r2' };

describe('MapStrings', () => {
  it('labels the stub for a string that leaves the plan, and opens the string on click', () => {
    const onOpen = vi.fn();
    render(<svg><MapStrings graph={graph} status={{}} cards={cards} refOf={refOf} onOpen={onOpen} /></svg>);
    expect(screen.getByText('continues to GC 4800, not in this plan')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'String Color: GC 1040 to GC 2400' }));
    expect(onOpen).toHaveBeenCalledWith('A');
  });
  it('shows a quiet hollow mark on a card whose point changed, and a dot where two strings share a point', () => {
    const g: StringGraph = { ...graph, strings: [...graph.strings, { ...graph.strings[0]!, id: 'B', name: 'Other', path: ['a', 'b'] }] };
    const { container } = render(<svg><MapStrings graph={g} status={{ a: { kind: 'unanchored', why: 'skill gone' } }} cards={cards} refOf={refOf} onOpen={() => {}} /></svg>);
    expect(container.querySelectorAll('.bs-mark--changed')).toHaveLength(1);
    expect(container.querySelectorAll('.bs-mark--shared')).toHaveLength(2);
  });
  it('the strings layer is reachable by role (it is not inside an aria-hidden svg)', () => {
    const { container } = render(<div><svg aria-hidden /><MapStringsLayer width={400} height={300} graph={graph} status={{}} cards={cards} refOf={refOf} onOpen={() => {}} /></div>);
    expect(screen.getByRole('button', { name: 'String Color: GC 1040 to GC 2400' })).toBeTruthy();
    expect(container.querySelector('svg.cb-svg--strings')!.closest('[aria-hidden]')).toBeNull();
  });
});
