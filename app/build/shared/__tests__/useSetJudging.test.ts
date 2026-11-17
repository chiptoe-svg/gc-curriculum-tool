import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useState } from 'react';
import type { SetVerdicts } from '@/lib/builder/cluster/status';
import { useSetJudging, type SetRequest } from '../useSetJudging';

const CLUSTER = '00000000-0000-4000-8000-000000000001';
const target = { key: 'req:GC 3|r2', text: 'Plans a print job end to end', course: 'GC 3', title: 'Print production' };
const pool = [
  { ref: 's1', text: 'Estimates job costs', course: 'GC 1', title: 'Estimating' },
  { ref: 's2', text: 'Schedules a press run', course: 'GC 2', title: 'Press' },
];
const req = (p = pool): SetRequest => ({ key: target.key, target, pool: p });
const verdict = (pAny: number) => ({ pAny, kept: ['s1', 's2'], pTogether: 0.7, pCombining: 0.6 });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function useCluster(requests: SetRequest[]) {
  const [sets, setSets] = useState<SetVerdicts>({});
  return { sets, ...useSetJudging({ requests, clusterId: CLUSTER, setSets }) };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('useSetJudging', () => {
  it('sends one judge-set call per request, one at a time, and stores the verdict by target key', async () => {
    let open = 0, most = 0;
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      open++; most = Math.max(most, open);
      bodies.push(JSON.parse(String(init.body)));
      await new Promise(r => setTimeout(r, 10));
      open--;
      return json(200, { verdict: verdict(0.8) });
    }));
    const other: SetRequest = { key: 'cobj:o1', target: { key: 'cobj:o1', text: 'Runs a print shop', course: 'GC 3', title: 'Print production' }, pool };
    const { result } = renderHook(() => useCluster([req(), other]));
    await waitFor(() => expect(Object.keys(result.current.sets)).toHaveLength(2));
    expect(most).toBe(1);
    expect(bodies[0]).toEqual({ action: 'judge-set', clusterId: CLUSTER, target, pool });
    expect(result.current.sets[target.key]).toEqual(verdict(0.8));
    expect(result.current.judging).toEqual({});
  });

  it('an error sets the retry message and stores no verdict', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(502, { error: 'detail' })));
    const { result } = renderHook(() => useCluster([req()]));
    await waitFor(() => expect(result.current.judging[target.key]).toBe('The campus model did not answer; try again.'));
    expect(result.current.sets).toEqual({});

    vi.stubGlobal('fetch', vi.fn(async () => json(200, { verdict: verdict(0.9) })));
    act(() => result.current.retry(target.key));
    expect(result.current.judging[target.key]).toBe('matching');
    await waitFor(() => expect(result.current.sets[target.key]).toEqual(verdict(0.9)));
    expect(result.current.judging[target.key]).toBeUndefined();
  });

  it('a changed pool drops the verdict and asks again; the old pool comes back without a call', async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) =>
      json(200, { verdict: verdict(JSON.parse(String(init.body)).pool.length === 2 ? 0.8 : 0.4) }));
    vi.stubGlobal('fetch', fetch);
    const { result, rerender } = renderHook(({ p }) => useCluster([req(p)]), { initialProps: { p: pool } });
    await waitFor(() => expect(result.current.sets[target.key]?.pAny).toBe(0.8));

    rerender({ p: pool.slice(0, 1) });
    expect(result.current.sets[target.key]).toBeUndefined(); // not the old pool's answer
    await waitFor(() => expect(result.current.sets[target.key]?.pAny).toBe(0.4));
    expect(fetch).toHaveBeenCalledTimes(2);

    rerender({ p: pool });
    await waitFor(() => expect(result.current.sets[target.key]?.pAny).toBe(0.8));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a pool whose call failed is asked again when it comes back', async () => {
    let fail = true;
    const fetch = vi.fn(async () => (fail ? json(502, {}) : json(200, { verdict: verdict(0.8) })));
    vi.stubGlobal('fetch', fetch);
    const { result, rerender } = renderHook(({ p }) => useCluster([req(p)]), { initialProps: { p: pool } });
    await waitFor(() => expect(result.current.judging[target.key]).toBe('The campus model did not answer; try again.'));
    fail = false;
    rerender({ p: pool.slice(0, 1) });
    await waitFor(() => expect(result.current.sets[target.key]).toBeDefined());
    rerender({ p: pool });
    expect(result.current.sets[target.key]).toBeUndefined();
    await waitFor(() => expect(result.current.sets[target.key]).toBeDefined());
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('the same pool in another order is not asked again', async () => {
    const fetch = vi.fn(async () => json(200, { verdict: verdict(0.8) }));
    vi.stubGlobal('fetch', fetch);
    const { result, rerender } = renderHook(({ p }) => useCluster([req(p)]), { initialProps: { p: pool } });
    await waitFor(() => expect(result.current.sets[target.key]).toBeDefined());
    rerender({ p: [...pool].reverse() });
    await new Promise(r => setTimeout(r, 20));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.current.sets[target.key]).toEqual(verdict(0.8));
  });
});
