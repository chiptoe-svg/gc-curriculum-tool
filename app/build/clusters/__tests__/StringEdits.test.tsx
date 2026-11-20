import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { PointRow, StringGraph, StringRow } from '@/lib/builder/strings/types';
import { StopTools, StringTools } from '../StringEdits';
import type { LockPoint } from '../stringsOnCluster';
import type { Tree } from '@/lib/skill-tree/types';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const row = (id: string, courseCode: string, role: 'develops' | 'requires', statement: string): PointRow =>
  ({ id, courseCode, role, statement, statementHash: statement, snapshotId: null, k: 1, u: 1, d: 1, term: null });
const str = (id: string, name: string, path: string[]): StringRow =>
  ({ id, name, description: '', status: 'active', endNote: null, mergedInto: null, version: 4, path });
// Statement hash = statement here, so sameSkill (which hashes) never matches these rows; the targets below are other skills.
const graph: StringGraph = {
  strings: [str('s1', 'Ink path', ['a', 'b', 'c']), str('s2', 'Color path', ['x', 'c'])],
  points: { a: row('a', 'GC 1010', 'develops', 'A'), b: row('b', 'GC 2070', 'develops', 'B'), c: row('c', 'GC 4400', 'requires', 'C'), x: row('x', 'GC 3000', 'develops', 'X') },
  links: [], events: [],
};
const target: LockPoint = { courseCode: 'GC 3400', role: 'develops', statement: 'Proof a job', snapshotId: 'x', k: 1, u: 1, d: 1 };
const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
const stub = () => { calls.length = 0; vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, body: JSON.parse(init.body as string) }); return new Response(JSON.stringify({ graph }), { status: 200 }); })); };
const common = (s: StringRow, onChanged = vi.fn()) => ({ graph, str: s, authorName: 'Dr Who', onChanged });

describe('StringEdits', () => {
  it('Remove needs a reason and sends the stop position', async () => {
    stub();
    const onChanged = vi.fn();
    render(<StopTools {...common(graph.strings[0]!, onChanged)} position={1} targets={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const go = screen.getByRole('button', { name: 'Remove skill' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'no longer taught' } });
    fireEvent.click(go);
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(graph));
    expect(calls[0]).toMatchObject({ url: '/api/strings/s1', body: { action: 'remove-point', position: 1, reason: 'no longer taught', version: 4, authorName: 'Dr Who' } });
  });
  it('Branch from here is not offered at the last stop; elsewhere it posts a branch', async () => {
    stub();
    const { unmount } = render(<StopTools {...common(graph.strings[0]!)} position={2} targets={[target]} />);
    expect(screen.queryByRole('button', { name: 'Branch from here' })).toBeNull();
    unmount();
    render(<StopTools {...common(graph.strings[0]!)} position={0} targets={[target]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Branch from here' }));
    fireEvent.change(screen.getByLabelText('Skill'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('New string name'), { target: { value: 'Side' } });
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'because' } });
    fireEvent.click(screen.getByRole('button', { name: 'Branch string' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.body).toMatchObject({ action: 'branch', atPosition: 0, name: 'Side', why: 'because', point: target });
  });
  it('Merge into lists only strings that pass checkMerge', async () => {
    stub();
    // s2 ends at c; s1 passes through c, so s2 can merge into s1. s1 ends at c, which s2 also holds, so s1 can merge into s2 too.
    render(<StringTools {...common(graph.strings[1]!)} targets={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Merge into…' }));
    expect(screen.getByRole('option', { name: 'Ink path' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Color path' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Merge into'), { target: { value: 's1' } });
    expect(screen.getByRole('button', { name: 'Merge' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'same skill, same course' } });
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.body).toMatchObject({ action: 'merge', into: 's1', reason: 'same skill, same course' });
  });
  it('Extend sends a point at the chosen end', async () => {
    stub();
    render(<StringTools {...common(graph.strings[0]!)} targets={[target]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Extend…' }));
    fireEvent.change(screen.getByLabelText('Skill'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Extend at'), { target: { value: 'start' } });
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'because' } });
    fireEvent.click(screen.getByRole('button', { name: 'Extend string' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.body).toMatchObject({ action: 'extend', at: 'start', point: target, why: 'because' });
  });
});

describe('StringEdits on a merged string and without a name', () => {
  const merged = { ...graph.strings[1]!, mergedInto: 's1' };
  it('offers no Merge and no End extension on a string that already merges into another', () => {
    stub();
    render(<StringTools {...common(merged)} targets={[target]} />);
    expect(screen.queryByRole('button', { name: 'Merge into…' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Extend…' }));
    expect(screen.queryByRole('option', { name: 'End' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Start' })).toBeInTheDocument();
  });
  it('asks for a name when none is set and sends it', async () => {
    stub();
    render(<StopTools {...{ ...common(graph.strings[0]!), authorName: '' }} position={1} targets={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'gone' } });
    const go = screen.getByRole('button', { name: 'Remove skill' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Pat' } });
    fireEvent.click(go);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.body).toMatchObject({ authorName: 'Pat' });
  });
  it('Check against a tree skill picks a node and posts it with the needs', async () => {
    stub();
    const tree: Tree = {
      nodes: [{ id: 'icc', name: 'ICC profiles', description: null, parentId: null, competencyId: null, foundational: false, weight: 1, weightSource: 'default', mergedInto: null, retired: false }],
      leaves: [], depths: [],
    };
    // Stop 2 of s1 is the requires point c; develops stops do not offer the check.
    const { unmount } = render(<StopTools {...common(graph.strings[0]!)} position={1} targets={[]} tree={tree} />);
    expect(screen.queryByRole('button', { name: 'Check against a tree skill…' })).toBeNull();
    unmount();
    render(<StopTools {...common(graph.strings[0]!)} position={2} targets={[]} tree={tree} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check against a tree skill…' }));
    expect(screen.getByRole('button', { name: 'Save check' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Search the skill tree'), { target: { value: 'icc' } });
    fireEvent.click(screen.getByRole('button', { name: 'ICC profiles' }));
    fireEvent.change(screen.getByLabelText('Needs K'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Needs D'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save check' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ url: '/api/strings/points/c/node', body: { nodeId: 'icc', k: 3, u: null, d: 2, authorName: 'Dr Who' } });
  });
});
