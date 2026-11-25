import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EvidenceMapStep } from '../EvidenceMapStep';
import type { EvidenceMap } from '@/lib/capture/staged/evidence-map';

const MAP: EvidenceMap = {
  summary: 'A press-operation course.',
  graded_work: [{ title: 'Press check project', weight: '30%', deliverables: 'A press sheet', rubric_criteria: ['Register'], source: 'syllabus.pdf' }],
  tests: [],
  competencies: [],
  assumed_skills: [{ skill: 'Color theory', used_in: 'Press check project', source: 'syllabus.pdf' }],
  objectives: [
    { text: 'Operate a press', status: 'graded_work_found', graded_work: ['Press check project'] },
    { text: 'Explain ink trapping', status: 'not_found', graded_work: [] },
  ],
  conflicts: [],
  unreadable: [{ file: 'scan.pdf', note: 'scanned image' }],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const KEY = 'gc-staged-session:GC 4060';
beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });
afterEach(() => vi.unstubAllGlobals());

describe('EvidenceMapStep', () => {
  it('shows "Reading your materials…" while the read runs', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<EvidenceMapStep courseCode="GC 4060" slug="s" onStart={vi.fn()} />);
    expect(screen.getByText('Reading your materials…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Looks right/ })).toBeNull();
  });

  it('POSTs {} to the evidence-map route', async () => {
    const f = vi.fn(async () => json({ sessionId: 's1', map: MAP, status: 'ready' }));
    vi.stubGlobal('fetch', f);
    render(<EvidenceMapStep courseCode="GC 4060" slug="abc" onStart={vi.fn()} />);
    await screen.findByText('A press-operation course.');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/capture/GC%204060/evidence-map?slug=abc');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
  });

  it('renders graded work, assumed skills, objectives with check marks, then what could not be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ sessionId: 's1', map: MAP, status: 'ready' })));
    render(<EvidenceMapStep courseCode="GC 4060" slug="s" onStart={vi.fn()} />);
    await screen.findByDisplayValue('Press check project');
    const headings = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent);
    expect(headings).toEqual(['Graded work', 'Skills the course assumes', 'Objectives', "What couldn't be read"]);
    expect(screen.getByDisplayValue('Color theory')).toBeInTheDocument();
    expect(screen.getByText('✓ graded work found')).toBeInTheDocument();
    expect(screen.getByText('✗ no graded work found')).toBeInTheDocument();
    expect(screen.getByText(/scan\.pdf/)).toBeInTheDocument();
  });

  it('on failed status says so and still offers start', async () => {
    const onStart = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => json({ sessionId: 's9', map: null, status: 'failed' })));
    render(<EvidenceMapStep courseCode="GC 4060" slug="s" onStart={onStart} />);
    await screen.findByText("Couldn't read the materials; the interview will ask instead");
    const start = screen.getByRole('button', { name: /Looks right/ });
    expect(start).toBeEnabled();
    fireEvent.click(start);
    await waitFor(() => expect(onStart).toHaveBeenCalledWith('s9'));
  });

  it('on status none gives the same copy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ sessionId: 's9', map: null, status: 'none' })));
    render(<EvidenceMapStep courseCode="GC 4060" slug="s" onStart={vi.fn()} />);
    await screen.findByText("Couldn't read the materials; the interview will ask instead");
    expect(screen.getByRole('button', { name: /Looks right/ })).toBeEnabled();
  });

  it('start without edits calls onStart and does not PUT', async () => {
    const onStart = vi.fn();
    const f = vi.fn(async () => json({ sessionId: 's1', map: MAP, status: 'ready' }));
    vi.stubGlobal('fetch', f);
    render(<EvidenceMapStep courseCode="GC 4060" slug="s" onStart={onStart} />);
    await screen.findByText('A press-operation course.');
    fireEvent.click(screen.getByRole('button', { name: /Looks right/ }));
    await waitFor(() => expect(onStart).toHaveBeenCalledWith('s1'));
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('an edit then start PUTs the edited map, then starts', async () => {
    const onStart = vi.fn();
    const f = vi.fn(async (_u: string, init?: RequestInit) =>
      init?.method === 'PUT' ? json({ sessionId: 's1', map: MAP, status: 'ready' }) : json({ sessionId: 's1', map: MAP, status: 'ready' }));
    vi.stubGlobal('fetch', f);
    render(<EvidenceMapStep courseCode="GC 4060" slug="s" onStart={onStart} />);
    const title = await screen.findByDisplayValue('Press check project');
    fireEvent.change(title, { target: { value: 'Press check and report' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add graded work' }));
    fireEvent.change(screen.getByLabelText('New graded work'), { target: { value: 'Final portfolio' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: /Looks right/ }));
    await waitFor(() => expect(onStart).toHaveBeenCalledWith('s1'));
    const put = f.mock.calls.find(c => c[1]?.method === 'PUT')!;
    expect(put[0]).toBe('/api/capture/GC%204060/evidence-map?slug=s');
    const body = JSON.parse(put[1]!.body as string);
    expect(body.sessionId).toBe('s1');
    expect(body.map.graded_work.map((g: { title: string }) => g.title)).toEqual(['Press check and report', 'Final portfolio']);
    expect(body.map.graded_work[1]).toMatchObject({ weight: null, deliverables: null, rubric_criteria: [] });
    expect(body.map.objectives).toHaveLength(2);
  });

  it('a removed assumed skill and an added objective are saved', async () => {
    const f = vi.fn(async () => json({ sessionId: 's1', map: MAP, status: 'ready' }));
    vi.stubGlobal('fetch', f);
    render(<EvidenceMapStep courseCode="GC 4060" slug="s" onStart={vi.fn()} />);
    await screen.findByDisplayValue('Color theory');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Color theory' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add objective' }));
    fireEvent.change(screen.getByLabelText('New objective'), { target: { value: 'Mix spot colors' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: /Looks right/ }));
    await waitFor(() => expect(f.mock.calls.some(c => (c as unknown as [string, RequestInit])[1]?.method === 'PUT')).toBe(true));
    const put = f.mock.calls.find(c => (c as unknown as [string, RequestInit])[1]?.method === 'PUT') as unknown as [string, RequestInit];
    const body = JSON.parse(put[1].body as string);
    expect(body.map.assumed_skills).toEqual([]);
    expect(body.map.objectives[2]).toEqual({ text: 'Mix spot colors', status: 'not_found', graded_work: [] });
  });

  it('a failed save shows the error and does not start', async () => {
    const onStart = vi.fn();
    const f = vi.fn(async (_u: string, init?: RequestInit) =>
      init?.method === 'PUT' ? json({ error: 'request too large' }, 413) : json({ sessionId: 's1', map: MAP, status: 'ready' }));
    vi.stubGlobal('fetch', f);
    render(<EvidenceMapStep courseCode="GC 4060" slug="s" onStart={onStart} />);
    fireEvent.change(await screen.findByDisplayValue('Press check project'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /Looks right/ }));
    await screen.findByRole('alert');
    expect(onStart).not.toHaveBeenCalled();
  });

  it('a failed read request shows the error and a retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'daily cost cap reached — service paused for today' }, 503)));
    render(<EvidenceMapStep courseCode="GC 4060" slug="s" onStart={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('daily cost cap reached');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Looks right/ })).toBeNull();
  });

  it('stores the new session id per course when the read returns', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ sessionId: 's1', map: MAP, status: 'ready' })));
    render(<EvidenceMapStep courseCode="GC 4060" slug="s" onStart={vi.fn()} />);
    await screen.findByText('A press-operation course.');
    expect(localStorage.getItem(KEY)).toBe('s1');
  });

  it('with a stored id, GETs that session and does not POST (no second paid read)', async () => {
    localStorage.setItem(KEY, 'old-1');
    const f = vi.fn(async () => json({ sessionId: 'old-1', map: MAP, status: 'ready' }));
    vi.stubGlobal('fetch', f);
    const onStart = vi.fn();
    render(<EvidenceMapStep courseCode="GC 4060" slug="abc" onStart={onStart} />);
    await screen.findByText('A press-operation course.');
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit | undefined];
    expect(url).toBe('/api/capture/GC%204060/evidence-map?slug=abc&sessionId=old-1');
    expect(init?.method ?? 'GET').toBe('GET');
    fireEvent.click(screen.getByRole('button', { name: /Looks right/ }));
    await waitFor(() => expect(onStart).toHaveBeenCalledWith('old-1'));
  });

  it('a 404 for the stored id clears it and POSTs a new read', async () => {
    localStorage.setItem(KEY, 'gone');
    const f = vi.fn(async (_u: string, init?: RequestInit) =>
      init?.method === 'POST' ? json({ sessionId: 'new-2', map: MAP, status: 'ready' }) : json({ error: 'session not found' }, 404));
    vi.stubGlobal('fetch', f);
    render(<EvidenceMapStep courseCode="GC 4060" slug="s" onStart={vi.fn()} />);
    await screen.findByText('A press-operation course.');
    expect(f.mock.calls.map(c => (c[1] as RequestInit | undefined)?.method ?? 'GET')).toEqual(['GET', 'POST']);
    expect(localStorage.getItem(KEY)).toBe('new-2');
  });

  it('still works when localStorage throws', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.stubGlobal('fetch', vi.fn(async () => json({ sessionId: 's1', map: MAP, status: 'ready' })));
    render(<EvidenceMapStep courseCode="GC 4060" slug="s" onStart={vi.fn()} />);
    await screen.findByText('A press-operation course.');
    spy.mockRestore(); set.mockRestore();
  });
});
