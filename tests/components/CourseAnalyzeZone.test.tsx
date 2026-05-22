import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { CourseAnalyzeZone } from '@/components/CourseAnalyzeZone';

// Mock fetch
global.fetch = vi.fn();

const mockFetch = global.fetch as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

const baseProps = {
  slug: 'valid-slug-12345',
  courseCode: 'GC 4060',
  okCount: 2,
  lastRun: null,
  manuallyEdited: false,
  onAnalyzed: vi.fn(),
};

describe('CourseAnalyzeZone', () => {
  it('renders an enabled Analyze button when okCount > 0', () => {
    render(<CourseAnalyzeZone {...baseProps} />);
    const btn = screen.getByRole('button', { name: /analyze materials/i });
    expect(btn).not.toBeDisabled();
  });

  it('renders a disabled Analyze button when okCount is 0', () => {
    render(<CourseAnalyzeZone {...baseProps} okCount={0} />);
    const btn = screen.getByRole('button', { name: /analyze materials/i });
    expect(btn).toBeDisabled();
  });

  it('shows last-run metadata when lastRun is provided', () => {
    render(
      <CourseAnalyzeZone
        {...baseProps}
        lastRun={{ id: 'run-1', createdAt: '2026-05-20T10:00:00Z', materialCount: 3, costUsdCents: 42000 }}
      />
    );
    expect(screen.getByText(/3 files/i)).toBeTruthy();
    expect(screen.getByText(/\$4\.20/)).toBeTruthy();
  });

  it('shows the overwrite warning when manuallyEdited is true', () => {
    render(<CourseAnalyzeZone {...baseProps} manuallyEdited={true} />);
    expect(screen.getByText(/your edits will be replaced/i)).toBeTruthy();
  });

  it('does not show the overwrite warning when manuallyEdited is false', () => {
    render(<CourseAnalyzeZone {...baseProps} manuallyEdited={false} />);
    expect(screen.queryByText(/your edits will be replaced/i)).toBeNull();
  });

  it('calls the analyze endpoint on button click and invokes onAnalyzed on success', async () => {
    const onAnalyzed = vi.fn();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ runId: 'run-1', totalCostUsdCents: 22, materialCount: 1, newlyAnalyzed: 1 }),
    } as Response);

    render(<CourseAnalyzeZone {...baseProps} onAnalyzed={onAnalyzed} />);
    fireEvent.click(screen.getByRole('button', { name: /analyze materials/i }));

    await waitFor(() => expect(onAnalyzed).toHaveBeenCalledTimes(1));
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/courses/GC%204060/analyze-materials'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('shows an error message when the fetch fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'no readable materials' }),
    } as Response);

    render(<CourseAnalyzeZone {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /analyze materials/i }));

    await waitFor(() => expect(screen.getByText(/no readable materials/i)).toBeTruthy());
  });
});
