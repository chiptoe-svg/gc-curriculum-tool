import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { CourseStrings } from '../CourseStrings';
import type { PointRow, PointStatus, StringGraph } from '@/lib/builder/strings/types';

const pt = (id: string, courseCode: string, over: Partial<PointRow> = {}): PointRow => ({
  id, courseCode, role: 'develops', statement: `Skill at ${courseCode}`, statementHash: `h-${id}`, snapshotId: null,
  k: 2, u: 2, d: 2, term: null, ...over,
});
const graph: StringGraph = {
  strings: [{ id: 's1', name: 'Color', description: '', status: 'active', endNote: null, mergedInto: null, version: 1, path: ['p1', 'p2'] }],
  points: { p1: pt('p1', 'GC 1010'), p2: pt('p2', 'GC 2400') },
  links: [{ id: 'l1', from: 'p1', to: 'p2', why: 'builds on it', createdBy: 'x', createdAt: '2026-01-01' }],
  events: [],
};
const intact: PointStatus = { kind: 'intact', now: { k: 2, u: 2, d: 2 } };
const reply = (status: PointStatus) => ({ graph, status: { p1: intact, p2: status }, levels: { 'GC 1010': 1, 'GC 2400': 2 }, notes: [], orphans: { 'GC 2400': { developed: [{ statement: 'Mix spot inks', hash: 'x', note: null }], unsupplied: [] } } });
const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;
const stub = (res: Response) => { const f = vi.fn().mockResolvedValue(res); vi.stubGlobal('fetch', f); return f; };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('CourseStrings', () => {
  it('lists strings through the course, links keep the access query, no Changes when intact', async () => {
    stub(json(200, reply(intact)));
    render(<CourseStrings courseCode="GC 2400" mode="course" query="?slug=ab-12" />);
    expect(await screen.findByRole('link', { name: 'Color' })).toHaveAttribute('href', '/strings/s1?slug=ab-12');
    expect(screen.getByText('Strings through this course')).toBeInTheDocument();
    expect(screen.queryByText('Changes')).toBeNull();
  });

  it('lists a reworded point with Confirm, which posts the candidate', async () => {
    const f = stub(json(200, reply({ kind: 'changed', now: null, candidate: { statement: 'New wording', hash: 'hx' } })));
    render(<CourseStrings courseCode="GC 2400" mode="capture" />);
    expect(await screen.findByText('Reworded at GC 2400: "New wording"')).toBeInTheDocument();
    f.mockResolvedValueOnce(json(200, { graph })).mockResolvedValue(json(200, reply(intact)));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(f.mock.calls.some((c) => c[0] === '/api/strings/points/p2')).toBe(true));
    const call = f.mock.calls.find((c) => c[0] === '/api/strings/points/p2')!;
    expect(JSON.parse(call[1].body).candidate).toEqual({ statement: 'New wording', hash: 'hx' });
  });

  it('uses no alert or banner role', async () => {
    stub(json(200, reply({ kind: 'unchecked' })));
    const { container } = render(<CourseStrings courseCode="GC 2400" mode="course" />);
    expect(await screen.findByText(/Couldn't check/)).toBeInTheDocument();
    expect(container.querySelector('[role="alert"], [role="banner"], [class*="warn"], [class*="alert"]')).toBeNull();
  });

  it('renders nothing on 401 and a quiet line on other errors', async () => {
    stub(json(401, {}));
    const a = render(<CourseStrings courseCode="GC 2400" mode="course" />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(a.container.textContent).toBe('');
    a.unmount();
    stub(json(500, {}));
    render(<CourseStrings courseCode="GC 2400" mode="course" />);
    expect(await screen.findByText("Couldn't load strings.")).toBeInTheDocument();
  });

  it('lists skills on no string and posts an orphan note', async () => {
    const f = stub(json(200, reply(intact)));
    render(<CourseStrings courseCode="GC 2400" mode="course" />);
    expect(await screen.findByText('Skills on no string')).toBeInTheDocument();
    expect(screen.getByText('Mix spot inks')).toBeInTheDocument();
    f.mockResolvedValue(json(200, { ...reply(intact), orphans: { 'GC 2400': { developed: [{ statement: 'Mix spot inks', hash: 'x', note: 'Taught as a one-off' }], unsupplied: [] } } }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a note' }));
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Taught as a one-off' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(f.mock.calls.some((c) => c[0] === '/api/strings/orphan-notes')).toBe(true));
    const call = f.mock.calls.find((c) => c[0] === '/api/strings/orphan-notes')!;
    expect(JSON.parse(call[1].body)).toMatchObject({ courseCode: 'GC 2400', role: 'develops', statement: 'Mix spot inks', reason: 'Taught as a one-off' });
    expect(await screen.findByText(/Taught as a one-off/)).toBeInTheDocument();
  });

  it('shows a standing for each point when a string runs through the course twice', async () => {
    const two: StringGraph = {
      ...graph,
      strings: [{ ...graph.strings[0]!, path: ['p1', 'p2', 'p3'] }],
      points: { ...graph.points, p3: pt('p3', 'GC 2400', { statement: 'Second skill' }) },
      links: [],
    };
    stub(json(200, { ...reply(intact), graph: two, status: { p1: intact, p2: intact, p3: { kind: 'unanchored', why: 'skill gone' } } }));
    render(<CourseStrings courseCode="GC 2400" mode="course" />);
    expect(await screen.findByText('Skill at GC 2400: Holds · Second skill: No longer anchored')).toBeInTheDocument();
  });
});
