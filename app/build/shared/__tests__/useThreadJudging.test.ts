import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useState } from 'react';
import type { PlacedCourse } from '@/lib/builder/compute';
import type { EffectiveCourse } from '@/lib/builder/edits';
import type { DraftJudgments } from '@/lib/builder/threads';
import { planJudgeAnchor, planJudgeOthers } from '@/app/build/[id]/Builder';
import { useThreadJudging, type JudgeJob } from '../useThreadJudging';

// A three-term plan map: GC 1 (term 1) needs r0; GC 2 (term 2) develops a draft skill s1 and needs r1; GC 3 (term 3) needs r2.
const placed = (ref: string, term: number): PlacedCourse =>
  ({ ref, code: ref, title: `Title ${ref}`, act: 1, branch: null, seq: term, term, credits: 3, proposed: false } as unknown as PlacedCourse);
const eff = (required: Array<[string, string]>, developed: Array<[string, string]>): EffectiveCourse => ({
  objectives: [],
  required: required.map(([ref, statement]) => ({ ref, statement, need: { k: null, u: null, d: 2 }, draft: false })),
  developed: developed.map(([skillRef, statement]) => ({ skillRef, statement, k: null, u: null, d: 3, draft: true })),
});
const effective = new Map([
  ['GC 1', { placed: placed('GC 1', 1), eff: eff([['r0', 'Needs zero']], []), snapshotId: null }],
  ['GC 2', { placed: placed('GC 2', 2), eff: eff([['r1', 'Needs one']], [['s1', 'Develops one']]), snapshotId: null }],
  ['GC 3', { placed: placed('GC 3', 3), eff: eff([['r2', 'Needs two'], ['r3', '   ']], []), snapshotId: null }],
]);
// Builder's `supplies` without corequisites: an earlier term supplies a later one.
const supplies = (sup: PlacedCourse, req: PlacedCourse) => sup.ref !== req.ref && sup.term < req.term;
const job: JudgeJob = { key: 'GC 2|supplied|s1', sig: 'GC 2|supplied|s1', courseRef: 'GC 2', side: 'supplied', ref: 's1', text: 'Develops one' };

type Call = { url: string; body: string };
function stubFetch(respond: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, body: String(init.body) }); return respond(); }));
  return calls;
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The hook as Builder mounts it: Builder owns `drafts` (its statuses feed the jobs), the hook fills it. */
function usePlanJudging(jobs: JudgeJob[]) {
  const [drafts, setDrafts] = useState<DraftJudgments>({});
  const j = useThreadJudging({
    jobs, setDrafts, owner: { planId: 'p1' },
    othersFor: x => planJudgeOthers(effective, supplies, x), anchorOf: x => planJudgeAnchor(effective, x),
  });
  return { drafts, ...j };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('useThreadJudging', () => {
  it('judges a draft developed skill against later courses only', async () => {
    const calls = stubFetch(() => json(200, { results: [{ ref: 'r2', similarity: 0.8, pFully: 0.9, pPartly: 0.05 }] }));
    const { result } = renderHook(() => usePlanJudging([job]));
    await waitFor(() => expect(result.current.judging[job.key]).toBeUndefined());
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/build/match');
    // The exact body Builder sent before the move: same keys, same order, later courses' required skills only.
    expect(calls[0]!.body).toBe(JSON.stringify({
      action: 'judge', planId: 'p1',
      anchor: { text: 'Develops one', course: 'GC 2', title: 'Title GC 2', side: 'supplied' },
      others: [{ ref: 'r2', text: 'Needs two', course: 'GC 3', title: 'Title GC 3' }],
    }));
    expect(result.current.drafts).toEqual({ 'r2|s1': { pFully: 0.9, pPartly: 0.05 } });
    expect(result.current.unasked.size).toBe(0);
  });

  it('judges a required skill against earlier courses, keyed required|supplied', async () => {
    const calls = stubFetch(() => json(200, { results: [{ ref: 's1', similarity: 0.7, pFully: 0.4, pPartly: 0.5 }] }));
    const req: JudgeJob = { key: 'GC 3|required|r2', sig: 'GC 3|required|r2|GC 2', courseRef: 'GC 3', side: 'required', ref: 'r2', text: 'Needs two' };
    const { result } = renderHook(() => usePlanJudging([req]));
    await waitFor(() => expect(result.current.drafts['r2|s1']).toBeDefined());
    expect(JSON.parse(calls[0]!.body).others).toEqual([{ ref: 's1', text: 'Develops one', course: 'GC 2', title: 'Title GC 2' }]);
  });

  it('an error sets the retry message, not a status', async () => {
    const calls = stubFetch(() => json(502, { error: 'upstream detail' }));
    const { result } = renderHook(() => usePlanJudging([job]));
    await waitFor(() => expect(result.current.judging[job.key]).toBe('The campus model did not answer; try again.'));
    // A failed call stores no judgment: the pair stays absent (pending), never a status.
    expect(result.current.drafts).toEqual({});
    expect(calls).toHaveLength(1);

    vi.stubGlobal('fetch', vi.fn(async () => json(200, { results: [{ ref: 'r2', similarity: 0.8, pFully: 0.9, pPartly: 0.05 }] })));
    act(() => result.current.retryJudge(job.key));
    expect(result.current.judging[job.key]).toBe('matching');
    await waitFor(() => expect(result.current.judging[job.key]).toBeUndefined());
    expect(result.current.drafts).toEqual({ 'r2|s1': { pFully: 0.9, pPartly: 0.05 } });
  });

  it('a network failure says the server could not be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    const { result } = renderHook(() => usePlanJudging([job]));
    await waitFor(() => expect(result.current.judging[job.key]).toBe('Could not reach the server; try again.'));
    expect(result.current.drafts).toEqual({});
  });

  it('sends a cluster id in place of the plan id', async () => {
    const calls = stubFetch(() => json(200, { results: [] }));
    renderHook(() => {
      const [, setDrafts] = useState<DraftJudgments>({});
      return useThreadJudging({ jobs: [job], setDrafts, owner: { clusterId: 'c1' }, othersFor: x => planJudgeOthers(effective, supplies, x), anchorOf: x => planJudgeAnchor(effective, x) });
    });
    await waitFor(() => expect(calls).toHaveLength(1));
    const body = JSON.parse(calls[0]!.body);
    expect(body.clusterId).toBe('c1');
    expect(body.planId).toBeUndefined();
  });

  it('asks nothing when there is nothing to compare with', async () => {
    const calls = stubFetch(() => json(200, { results: [] }));
    const first: JudgeJob = { key: 'GC 1|required|r0', sig: 'GC 1|required|r0', courseRef: 'GC 1', side: 'required', ref: 'r0', text: 'Needs zero' };
    const { result } = renderHook(() => usePlanJudging([first]));
    await waitFor(() => expect(result.current.unasked.size).toBe(0));
    await waitFor(() => expect(result.current.judging[first.key]).toBeUndefined());
    expect(calls).toHaveLength(0);
  });
});
