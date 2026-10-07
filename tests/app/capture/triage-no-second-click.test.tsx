/**
 * Owner, 2026-10-07: "what is the point of the 2nd click?" — the triage step
 * goes on to the interview by itself unless something needs attention.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/capture/fetch-course-materials', () => ({ fetchCourseMaterials: vi.fn(async () => null) }));

import { TriageStep } from '@/app/capture/[code]/TriageStep';
import * as fetchMaterials from '@/lib/capture/fetch-course-materials';

const row = (o: Record<string, unknown>) => ({
  id: 'm1', fileName: 'f.pdf', mimeType: 'application/pdf', tier: 'high', indexingStatus: 'pending',
  ignored: false, pageCount: 2, ...o,
}) as never;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function backfill(results: Array<{ id: string; status: string }>) {
  vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ results }), { status: 200 }));
}

describe('triage — no pointless second click', () => {
  it('when every file is already read, the button just continues', async () => {
    backfill([{ id: 'm1', status: 'skipped' }]);
    const onIngested = vi.fn();
    render(<TriageStep courseCode="GC 1010" slug="s" materials={[row({ indexingStatus: 'ready' })]} onIngested={onIngested} onBack={() => {}} />);
    expect(screen.getByText(/all files are already read/i)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /continue to interview/i })); });
    expect(onIngested).toHaveBeenCalledOnce();
  });

  it('when reading finishes cleanly, it goes on to the interview by itself', async () => {
    backfill([{ id: 'm1', status: 'queued' }]);
    let status = 'indexing';
    vi.mocked(fetchMaterials.fetchCourseMaterials).mockImplementation(async () => [row({ indexingStatus: status })] as never);
    const onIngested = vi.fn();
    render(<TriageStep courseCode="GC 1010" slug="s" materials={[row({})]} onIngested={onIngested} onBack={() => {}} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /read files & continue/i })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(onIngested).not.toHaveBeenCalled();
    status = 'ready';
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(onIngested).toHaveBeenCalledOnce();
  });

  it('when a file fails, it stops and says so, with a Continue button', async () => {
    backfill([{ id: 'm1', status: 'queued' }]);
    vi.mocked(fetchMaterials.fetchCourseMaterials).mockImplementation(async () => [row({ indexingStatus: 'failed' })] as never);
    const onIngested = vi.fn();
    render(<TriageStep courseCode="GC 1010" slug="s" materials={[row({})]} onIngested={onIngested} onBack={() => {}} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /read files & continue/i })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(onIngested).not.toHaveBeenCalled();
    expect(screen.getByText(/1 file couldn.t be read/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /continue to interview/i }));
    expect(onIngested).toHaveBeenCalledOnce();
  });
});
