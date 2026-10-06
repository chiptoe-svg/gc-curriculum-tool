import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useStressTest } from '@/app/capture/[code]/useStressTest';

afterEach(() => vi.unstubAllGlobals());

const RESULT = {
  per_competency: [], profile_level: { catalog_vs_evidence_concerns: [], consistency_concerns: [], coverage_concerns: [] },
  overall_assessment: 'sound', summary: 'ok',
};

describe('useStressTest', () => {
  it('POSTs once, goes running → done, and keeps the result + telemetry', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ result: RESULT, telemetry: { costUsdCents: 1100, durationMs: 9, model: 'gpt-6.1-sol' } }) });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useStressTest('GC 3800', 'slug1'));
    expect(result.current.status).toBe('idle');
    act(() => { result.current.run(); });
    expect(result.current.status).toBe('running');
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/capture/GC%203800/stress-test?slug=slug1');
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe('POST');
    expect(result.current.result).toEqual(RESULT);
    expect(result.current.telemetry?.model).toBe('gpt-6.1-sol');
  });

  it('ignores a second run() while one is in flight', async () => {
    let resolve!: (v: unknown) => void;
    const fetchMock = vi.fn().mockReturnValue(new Promise((r) => { resolve = r; }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useStressTest('GC 3800', 's'));
    act(() => { result.current.run(); });
    act(() => { result.current.run(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ ok: true, status: 200, json: async () => ({ result: RESULT }) }); });
    await waitFor(() => expect(result.current.status).toBe('done'));
  });

  it('a server error (e.g. the daily cap in block mode) ends in status error with the message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: 'daily cost cap reached' }) }));
    const { result } = renderHook(() => useStressTest('GC 3800', 's'));
    act(() => { result.current.run(); });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('daily cost cap reached');
    expect(result.current.result).toBeNull();
  });

  it('a network failure ends in status error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { result } = renderHook(() => useStressTest('GC 3800', 's'));
    act(() => { result.current.run(); });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('offline');
  });
});
