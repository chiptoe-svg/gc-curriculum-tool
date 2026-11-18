import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { useAutosave } from '../useAutosave';

// Pins the plan map's (/build/[id]) saving as it was in Builder.tsx before the move: debounce, PUT body and URL, a 409
// that stops saving until the person chooses, overwrite with the other person's version, and the flush on pagehide.
type S = { n: number };
type Call = { url: string; init: RequestInit };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function stubFetch(respond: (c: Call) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => { const c = { url, init }; calls.push(c); return respond(c); }));
  return calls;
}
// Stable, as Builder's useCallback'd `author` is: a new function each render would re-run the leave effect, whose cleanup flushes.
const author = () => 'Ann';
const mount = () => renderHook(() => useAutosave<S>({
  url: '/api/build/plans/p1', initialState: { n: 0 }, initialName: 'Plan A', initialVersion: 3, author, noun: 'plan',
}));

// Unmount first: leaving flushes unsaved edits through the stubbed fetch.
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('useAutosave (the plan map\'s saving)', () => {
  it('saves an edit after the pause with name, state, version and author, then keeps the new version', async () => {
    vi.useFakeTimers();
    const calls = stubFetch(() => json(200, { version: 4 }));
    const { result } = mount();
    act(() => result.current.update(s => ({ n: s.n + 1 })));
    expect(result.current.save).toBe('dirty');
    await act(async () => { await vi.advanceTimersByTimeAsync(1199); });
    expect(calls).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/build/plans/p1');
    expect(calls[0]!.init.method).toBe('PUT');
    expect(calls[0]!.init.body).toBe(JSON.stringify({ name: 'Plan A', state: { n: 1 }, version: 3, authorName: 'Ann' }));
    expect(result.current.save).toBe('saved');
    act(() => result.current.rename('Plan B'));
    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
    expect(calls[1]!.init.body).toBe(JSON.stringify({ name: 'Plan B', state: { n: 1 }, version: 4, authorName: 'Ann' }));
  });

  it('an update that returns the same state changes nothing; undo steps back', () => {
    stubFetch(() => json(200, { version: 4 }));
    const { result } = mount();
    act(() => result.current.update(s => s));
    expect(result.current.save).toBe('saved');
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.update(() => ({ n: 5 })));
    act(() => result.current.update(s => ({ n: s.n + 1 })));
    expect(result.current.state).toEqual({ n: 6 });
    act(() => result.current.stepBack());
    expect(result.current.state).toEqual({ n: 5 });
  });

  it('a 409 stops saving and names who saved; overwrite resends on their version', async () => {
    vi.useFakeTimers();
    let conflict = true;
    const calls = stubFetch(() => (conflict ? json(409, { error: 'x', version: 9, updatedBy: 'Bob' }) : json(200, { version: 10 })));
    const { result } = mount();
    act(() => result.current.update(() => ({ n: 1 })));
    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
    expect(result.current.save).toBe('conflict');
    expect(result.current.notice).toBe('Bob');
    // More edits do not clear the conflict or send anything.
    act(() => result.current.update(() => ({ n: 2 })));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(calls).toHaveLength(1);
    expect(result.current.save).toBe('conflict');
    conflict = false;
    await act(async () => { result.current.overwrite(); await vi.advanceTimersByTimeAsync(0); });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.init.body).toBe(JSON.stringify({ name: 'Plan A', state: { n: 2 }, version: 9, authorName: 'Ann' }));
    expect(result.current.save).toBe('saved');
  });

  it('refusals and errors use the noun', async () => {
    const calls = stubFetch(c => (c.init.method === 'PUT' && calls.length === 1 ? json(404, {}) : json(403, {})));
    const { result } = mount();
    await act(async () => { await result.current.persist(); });
    expect(result.current.save).toBe('refused');
    expect(result.current.notice).toBe('This plan has been deleted, so it can no longer be saved.');
    await act(async () => { await result.current.persist(); });
    expect(result.current.notice).toBe('This sign-in cannot save plans.');
  });

  it('pagehide sends unsaved edits once, with keepalive', async () => {
    const calls = stubFetch(() => json(200, { version: 4 }));
    const { result } = mount();
    act(() => result.current.update(() => ({ n: 7 })));
    window.dispatchEvent(new Event('pagehide'));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.init).toMatchObject({ method: 'PUT', keepalive: true });
    expect(calls[0]!.init.body).toBe(JSON.stringify({ name: 'Plan A', state: { n: 7 }, version: 3, authorName: 'Ann' }));
    window.dispatchEvent(new Event('pagehide'));
    expect(calls).toHaveLength(1);
  });

  it('pagehide sends nothing while a conflict is open', async () => {
    vi.useFakeTimers();
    const calls = stubFetch(() => json(409, { version: 9, updatedBy: 'Bob' }));
    const { result } = mount();
    act(() => result.current.update(() => ({ n: 1 })));
    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
    window.dispatchEvent(new Event('pagehide'));
    expect(calls).toHaveLength(1);
  });
});
