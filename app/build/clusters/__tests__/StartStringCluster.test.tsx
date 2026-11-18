import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { StartStringCluster } from '../new/StartStringCluster';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); replace.mockReset(); localStorage.clear(); });

const stub = () => {
  const calls: Array<Record<string, unknown>> = [];
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => { calls.push(JSON.parse(init.body as string)); return new Response(JSON.stringify({ id: 'abc' }), { status: 201 }); }));
  return calls;
};

describe('StartStringCluster', () => {
  it('creates the cluster with the courses and goes to it, keeping the slug', async () => {
    const calls = stub();
    render(<StartStringCluster slug="s1" codes={['GC 1010', 'GC 2070', 'GC 4400']} knownName="Dr Who" />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/build/clusters/abc?slug=s1'));
    expect(calls).toEqual([{ name: 'Strings: GC 1010 and 2 more', courses: ['GC 1010', 'GC 2070', 'GC 4400'], authorName: 'Dr Who' }]);
  });
  it('asks for a name when the login names nobody', async () => {
    const calls = stub();
    render(<StartStringCluster slug="s1" codes={['GC 1010']} knownName={null} />);
    fireEvent.change(await screen.findByLabelText('Your name'), { target: { value: 'Pat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create cluster' }));
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(calls[0]).toMatchObject({ name: 'Strings: GC 1010', authorName: 'Pat' });
  });
});
