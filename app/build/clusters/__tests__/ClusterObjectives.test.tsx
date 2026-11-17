import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { useState } from 'react';
import { emptyClusterState, type ClusterState } from '@/lib/builder/cluster/state';
import type { StatusResult } from '@/lib/builder/cluster/status';
import { ClusterObjectives } from '../ClusterObjectives';

afterEach(cleanup);

const result = (o: Partial<StatusResult> & { targetKey: string; text: string }): StatusResult => ({
  status: 'pending', suppliers: [], proposed: [], reason: null, override: null, staleOverride: false, candidates: [],
  judgeRef: 'h', pool: [], needsSet: false, ...o,
});

function mount(initial: ClusterState, results: StatusResult[], errorOf: (r: StatusResult) => string | null = () => null) {
  const seen: ClusterState[] = [];
  const onRetry = vi.fn();
  function Harness() {
    const [s, setS] = useState(initial);
    seen.push(s);
    return <ClusterObjectives objectives={s.objectives} results={results} codeOf={r => r} update={fn => setS(fn)} errorOf={errorOf} onRetry={onRetry} />;
  }
  render(<Harness />);
  return { last: () => seen[seen.length - 1]!, onRetry };
}

describe('ClusterObjectives', () => {
  it('adds, edits and removes a cluster objective', () => {
    const m = mount(emptyClusterState(), []);
    fireEvent.change(screen.getByLabelText('New cluster objective'), { target: { value: '  Manage color across a print workflow ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add objective' }));
    const [o] = m.last().objectives;
    expect(o).toMatchObject({ text: 'Manage color across a print workflow' });
    expect(o!.id).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Objective text'), { target: { value: 'Manage color in a print workflow' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(m.last().objectives).toEqual([{ id: o!.id, text: 'Manage color in a print workflow' }]);

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(m.last().objectives).toEqual([]);
  });

  it('a blank objective is not added', () => {
    const m = mount(emptyClusterState(), []);
    fireEvent.change(screen.getByLabelText('New cluster objective'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add objective' }));
    expect(m.last().objectives).toEqual([]);
  });

  it('shows each objective with its status in words', () => {
    const s = { ...emptyClusterState(), objectives: [{ id: 'a', text: 'One' }, { id: 'b', text: 'Two' }, { id: 'c', text: 'Three' }] };
    mount(s, [
      result({ targetKey: 'cobj:a', text: 'One', status: 'met_set', suppliers: [{ course: 'GC 2070', statement: 'x', ref: 'x' }, { course: 'GC 4400', statement: 'y', ref: 'y' }] }),
      result({ targetKey: 'cobj:b', text: 'Two', status: 'not', reason: 'no course on this cluster has developed skills yet' }),
      result({ targetKey: 'cobj:c', text: 'Three', status: 'met', staleOverride: true, override: { targetKey: 'cobj:c', textHash: 'old', label: 'not', by: 'X', at: 'now', reason: null } }),
    ]);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Met by GC 2070 + GC 4400 (used together)');
    expect(items[1]).toHaveTextContent('Not met');
    expect(items[1]).toHaveTextContent('no course on this cluster has developed skills yet');
    expect(items[2]).toHaveTextContent('Override out of date (the objective changed)');
  });

  it('a failed match shows the error and Try again, never Not met', () => {
    const s = { ...emptyClusterState(), objectives: [{ id: 'a', text: 'One' }] };
    const r = result({ targetKey: 'cobj:a', text: 'One', status: 'pending' });
    const m = mount(s, [r], () => 'The campus model did not answer; try again.');
    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent('The campus model did not answer; try again.');
    expect(item).not.toHaveTextContent('Not met');
    fireEvent.click(within(item).getByRole('button', { name: 'Try again' }));
    expect(m.onRetry).toHaveBeenCalledWith(r);
  });
});
