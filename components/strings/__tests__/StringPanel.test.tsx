import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { StringPanel } from '../StringPanel';
import type { PointRow, PointStatus, StringGraph } from '@/lib/builder/strings/types';

const levelOf = (code: string) => Number(code.replace(/\D/g, '')[0] ?? 1);
const pt = (id: string, courseCode: string, over: Partial<PointRow> = {}): PointRow => ({
  id, courseCode, role: 'develops', statement: `Skill at ${courseCode}`, statementHash: `h-${id}`, snapshotId: null,
  k: 2, u: 2, d: 2, term: null, ...over,
});
const base = (over: Partial<StringGraph> = {}): StringGraph => ({
  strings: [{ id: 's1', name: 'Color', description: 'How color holds', status: 'active', endNote: null, mergedInto: null, version: 3, path: ['p1', 'p2'] }],
  points: { p1: pt('p1', 'GC 1010'), p2: pt('p2', 'GC 2400') },
  links: [{ id: 'l1', from: 'p1', to: 'p2', why: 'builds on it', createdBy: 'x', createdAt: '2026-01-01' }],
  events: [],
  ...over,
});
const intact = (k = 2): PointStatus => ({ kind: 'intact', now: { k, u: 2, d: 2 } });
const okStatus = { p1: intact(), p2: intact() };
const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('StringPanel', () => {
  it('ends line has no warning styling', () => {
    const { container } = render(<StringPanel graph={base()} status={okStatus} stringId="s1" levelOf={levelOf} editable={false} onChanged={() => {}} />);
    expect(screen.getByText('Ends at GC 2400 (Act 1)')).toBeInTheDocument();
    expect(container.querySelector('[role="alert"], [class*="warn"], [class*="alert"], [class*="error"]')).toBeNull();
  });

  it('shows where a merged string goes', () => {
    const g = base();
    g.strings[0]!.mergedInto = 's2';
    g.strings.push({ id: 's2', name: 'Color management', description: '', status: 'active', endNote: null, mergedInto: null, version: 1, path: ['p3'] });
    g.points.p3 = pt('p3', 'GC 4800');
    g.points.p2 = pt('p2', 'GC 4800');
    render(<StringPanel graph={g} status={{ ...okStatus, p3: intact() }} stringId="s1" levelOf={levelOf} editable={false} onChanged={() => {}} />);
    expect(screen.getByText(/Merges into/)).toHaveTextContent('Merges into Color management at GC 4800');
  });

  it('confirms a reword through the points route', async () => {
    const fetchMock = vi.fn(async () => json(200, { graph: base() }));
    vi.stubGlobal('fetch', fetchMock);
    const onChanged = vi.fn();
    const status = { ...okStatus, p2: { kind: 'changed', now: null, candidate: { statement: 'New words', hash: 'hn' } } as PointStatus };
    render(<StringPanel graph={base()} status={status} stringId="s1" levelOf={levelOf} editable authorName="Pat" onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/strings/points/p2');
    expect(JSON.parse(init.body as string).candidate).toEqual({ statement: 'New words', hash: 'hn' });
  });

  it('Not the same marks the point unanchored without writing', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const status = { ...okStatus, p2: { kind: 'changed', now: null, candidate: { statement: 'New words', hash: 'hn' } } as PointStatus };
    render(<StringPanel graph={base()} status={status} stringId="s1" levelOf={levelOf} editable authorName="Pat" onChanged={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Not the same' }));
    expect(screen.getAllByText('No longer anchored at GC 2400').length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a 409 reloads and hands the server graph to onChanged', async () => {
    const fresh = base();
    fresh.strings[0]!.name = 'Color, renamed';
    vi.stubGlobal('fetch', vi.fn(async () => json(409, { error: 'stale', graph: fresh })));
    const onChanged = vi.fn();
    render(<StringPanel graph={base()} status={okStatus} stringId="s1" levelOf={levelOf} editable authorName="Pat" onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('New name'), { target: { value: 'Other' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(await screen.findByText('Someone else changed this string. Reloaded.')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledWith(fresh);
  });

  it('read-only shows only the cluster link', () => {
    const status = { ...okStatus, p2: { kind: 'unchecked' } as PointStatus };
    render(<StringPanel graph={base()} status={status} stringId="s1" levelOf={levelOf} editable={false} editHref="/build/clusters/new?courses=GC%201010" onChanged={() => {}} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'Edit in a cluster' })).toHaveAttribute('href', '/build/clusters/new?courses=GC%201010');
  });

  it('asks for a why on a link that has none', () => {
    const g = base();
    g.links[0]!.why = null;
    render(<StringPanel graph={g} status={okStatus} stringId="s1" levelOf={levelOf} editable authorName="Pat" onChanged={() => {}} />);
    expect(screen.getByText(/carried on past GC 1010/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add why' })).toBeInTheDocument();
  });

  it('shows evidence only when there is some', () => {
    render(<StringPanel graph={base()} status={okStatus} stringId="s1" levelOf={levelOf} editable={false}
      evidenceOf={(c) => (c === 'GC 2400' ? ['Poster project'] : [])} onChanged={() => {}} />);
    expect(screen.getAllByText(/Evidence/)).toHaveLength(1);
    expect(screen.getByText(/Poster project/)).toBeInTheDocument();
  });
});
