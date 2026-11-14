import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { WHAT_IF_COPY } from '@/lib/what-if/copy';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/faculty', () => ({ FACULTY_ROSTER: ['Alice Appleton', 'Bob Brennan'] }));

import { StartWhatIf } from '@/app/explore/[code]/StartWhatIf';

const created = () => vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'abc' }), { status: 201 }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); push.mockReset(); });

describe('StartWhatIf', () => {
  it('shows the drafted wording', () => {
    render(<StartWhatIf courseCode="GC 3460" slug="s" defaultName="Pat Faculty" />);
    expect(screen.getByRole('button', { name: WHAT_IF_COPY.startButton })).toBeInTheDocument();
    expect(screen.getByText(WHAT_IF_COPY.startLine)).toBeInTheDocument();
  });

  it('with a personal link there is no name picker, and the request goes out without a name from the page', async () => {
    const fetchMock = created();
    vi.stubGlobal('fetch', fetchMock);
    render(<StartWhatIf courseCode="GC 3460" slug="s" defaultName="Pat Faculty" />);
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: WHAT_IF_COPY.startButton }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/explore/GC%203460/what-ifs');
    await waitFor(() => expect(push).toHaveBeenCalledWith('/explore/GC%203460/what-ifs/abc/talk?slug=s'));
  });

  it('under the department login the name picker must be filled before the request is sent', async () => {
    const fetchMock = created();
    vi.stubGlobal('fetch', fetchMock);
    render(<StartWhatIf courseCode="GC 3460" slug="s" defaultName={null} />);
    const start = screen.getByRole('button', { name: WHAT_IF_COPY.startButton });
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    fireEvent.click(start);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(WHAT_IF_COPY.startNameNeeded)).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Bob Brennan' } });
    fireEvent.click(screen.getByRole('button', { name: WHAT_IF_COPY.startButton }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ authorName: 'Bob Brennan' });
  });

  it('shows the server message when the start is refused', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'This course has no approved version yet.' }), { status: 409 })));
    render(<StartWhatIf courseCode="GC 3460" slug="s" defaultName="Pat Faculty" />);
    fireEvent.click(screen.getByRole('button', { name: WHAT_IF_COPY.startButton }));
    expect(await screen.findByText('This course has no approved version yet.')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
