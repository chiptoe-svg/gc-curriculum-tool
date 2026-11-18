import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { textHash } from '@/lib/catalog/bundles';
import { normalizeStatement } from '@/lib/catalog/project-trail';
import type { StringGraph } from '@/lib/builder/strings/types';
import { LockString } from '../LockString';
import { CAPTURED_ONLY, type LockPoint } from '../stringsOnCluster';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const SNAP = '8b1f0c2e-0000-4000-8000-0000000000a1';
const pt = (courseCode: string, role: 'develops' | 'requires', statement: string): LockPoint =>
  ({ courseCode, role, statement, snapshotId: SNAP, k: 3, u: 2, d: 3 });
const REQ = pt('GC 3400', 'requires', 'Read a job ticket');
const S1 = pt('GC 1010', 'develops', 'Name press parts');
const S2 = pt('GC 2070', 'develops', 'Mix ink to a spot color');
const EMPTY: StringGraph = { strings: [], points: {}, links: [], events: [] };

const row = (id: string, p: LockPoint) => ({ id, ...p, statementHash: textHash(normalizeStatement(p.statement)), term: null });
const ID = '8b1f0c2e-0000-4000-8000-0000000000b1';
/** A locked string GC 1010 -> GC 3400. */
const graphOf = (path: Array<[string, LockPoint]>): StringGraph => ({
  strings: [{ id: ID, name: 'Ink path', description: '', status: 'active', endNote: null, mergedInto: null, version: 3, path: path.map(([i]) => i) }],
  points: Object.fromEntries(path.map(([i, p]) => [i, row(i, p)])),
  links: [], events: [],
});

const levelOf = () => 1;
const mount = (over: Partial<Parameters<typeof LockString>[0]> = {}, onLocked = vi.fn()) => {
  render(<LockString required={REQ} suppliers={[S1, S2]} strings={EMPTY} levelOf={levelOf}
    authorName="Dr Who" onLocked={onLocked} {...over} />);
  return onLocked;
};

describe('LockString', () => {
  it('ticks every supplier by default and refuses to untick the last one', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Lock as string' }));
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map(b => b.checked)).toEqual([true, true]);
    fireEvent.click(boxes[0]!);
    expect(boxes.map(b => b.checked)).toEqual([false, true]);
    expect(boxes[1]!.disabled).toBe(true);
  });

  it('posts the ticked suppliers and the required skill in order, with one reason per link', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(init.body as string) });
      return new Response(JSON.stringify({ graph: EMPTY }), { status: 201 });
    }));
    const onLocked = mount({ suppliers: [S2, S1] });
    fireEvent.click(screen.getByRole('button', { name: 'Lock as string' }));
    fireEvent.change(screen.getByLabelText('String name'), { target: { value: 'Ink path' } });
    const submit = screen.getByRole('button', { name: 'Lock string' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    const whys = screen.getAllByLabelText(/^Why /);
    expect(whys).toHaveLength(2);
    fireEvent.change(whys[0]!, { target: { value: 'first' } });
    fireEvent.change(whys[1]!, { target: { value: 'second' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(onLocked).toHaveBeenCalledWith(EMPTY));
    expect(calls[0]!.url).toBe('/api/strings');
    expect((calls[0]!.body.points as LockPoint[]).map(p => p.courseCode)).toEqual(['GC 1010', 'GC 2070', 'GC 3400']);
    expect(calls[0]!.body.whys).toEqual(['first', 'second']);
    expect(calls[0]!.body).toMatchObject({ name: 'Ink path', authorName: 'Dr Who' });
  });

  it('a supplier that cannot be locked disables the button and says why; unticking it clears that', () => {
    mount({ suppliers: [S1, { ...S2, snapshotId: null }] });
    const lock = screen.getByRole('button', { name: 'Lock as string' }) as HTMLButtonElement;
    expect(lock.disabled).toBe(true);
    expect(screen.getByText(CAPTURED_ONLY)).toBeInTheDocument();
  });

  it('offers to extend a string that ends at a supplier, and posts an extend at the end', async () => {
    const calls: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method!, body: JSON.parse(init.body as string) });
      return new Response(JSON.stringify({ graph: EMPTY }), { status: 200 });
    }));
    const g = graphOf([['p1', S1]]); // a string ending at S1 needs 2 points in real life; the options only read the path
    mount({ strings: g, suppliers: [S1] });
    fireEvent.click(screen.getByRole('button', { name: 'Add to string…' }));
    fireEvent.click(screen.getByLabelText(/Extend Ink path/));
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'needs it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to string' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ url: `/api/strings/${ID}`, method: 'PATCH', body: { action: 'extend', at: 'end', version: 3, why: 'needs it' } });
    expect((calls[0]!.body.point as LockPoint).courseCode).toBe('GC 3400');
  });

  it('offers nothing for an unlocked string', () => {
    const g = graphOf([['p1', S1]]);
    g.strings[0]!.status = 'unlocked';
    mount({ strings: g, suppliers: [S1] });
    expect(screen.queryByRole('button', { name: 'Add to string…' })).toBeNull();
  });

  it('offers a branch at a supplier in mid-path, asking for a new name', async () => {
    const calls: Array<{ body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      calls.push({ body: JSON.parse(init.body as string) });
      return new Response(JSON.stringify({ graph: EMPTY }), { status: 200 });
    }));
    const other = pt('GC 4400', 'requires', 'Plan a job');
    mount({ strings: graphOf([['p1', S1], ['p2', other]]), suppliers: [S1] });
    fireEvent.click(screen.getByRole('button', { name: 'Add to string…' }));
    fireEvent.click(screen.getByLabelText(/Branch off Ink path/));
    fireEvent.change(screen.getByLabelText('New string name'), { target: { value: 'Side path' } });
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'because' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to string' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.body).toMatchObject({ action: 'branch', atPosition: 0, name: 'Side path', why: 'because' });
  });
});
