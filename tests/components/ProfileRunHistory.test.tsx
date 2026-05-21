import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ refresh: mockRefresh })),
}));

import { ProfileRunHistory } from '@/components/ProfileRunHistory';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
});

const baseRuns = [
  {
    id: 'run-2',
    courseCode: 'GC 1010',
    materialCount: 3,
    model: 'gpt-5.4-mini',
    costUsdCents: 42,
    createdAt: '2026-05-21T10:00:00Z',
  },
  {
    id: 'run-1',
    courseCode: 'GC 1010',
    materialCount: 2,
    model: 'gpt-5.4-mini',
    costUsdCents: 28,
    createdAt: '2026-05-20T09:00:00Z',
  },
];

describe('ProfileRunHistory', () => {
  it('renders nothing (null) when runs array is empty', () => {
    const { container } = render(
      <ProfileRunHistory runs={[]} slug="test-slug" courseCode="GC 1010" currentRunId={null} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a row for each run', () => {
    render(<ProfileRunHistory runs={baseRuns} slug="test-slug" courseCode="GC 1010" currentRunId={null} />);
    expect(screen.getByText(/3 files/i)).toBeTruthy();
    expect(screen.getByText(/2 files/i)).toBeTruthy();
  });

  it('shows cost in cents for each run', () => {
    render(<ProfileRunHistory runs={baseRuns} slug="test-slug" courseCode="GC 1010" currentRunId={null} />);
    expect(screen.getByText(/42/)).toBeTruthy();
    expect(screen.getByText(/28/)).toBeTruthy();
  });

  it('marks the current run with a "Current" badge', () => {
    render(<ProfileRunHistory runs={baseRuns} slug="test-slug" courseCode="GC 1010" currentRunId="run-2" />);
    expect(screen.getByText('Current')).toBeTruthy();
  });

  it('shows Restore button only on non-current runs', () => {
    render(<ProfileRunHistory runs={baseRuns} slug="test-slug" courseCode="GC 1010" currentRunId="run-2" />);
    const restoreButtons = screen.getAllByRole('button', { name: /restore/i });
    expect(restoreButtons).toHaveLength(1);
  });

  it('calls restore endpoint and refreshes on Restore click', async () => {
    render(<ProfileRunHistory runs={baseRuns} slug="test-slug" courseCode="GC 1010" currentRunId="run-2" />);
    fireEvent.click(screen.getByRole('button', { name: /restore/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/courses/GC%201010/profile/restore/run-1'),
      expect.objectContaining({ method: 'POST' })
    ));
  });

  it('shows an error message when restore fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'db error' }) });
    render(<ProfileRunHistory runs={baseRuns} slug="test-slug" courseCode="GC 1010" currentRunId="run-2" />);
    fireEvent.click(screen.getByRole('button', { name: /restore/i }));
    await waitFor(() => expect(screen.getByText(/restore failed/i)).toBeTruthy());
  });
});
