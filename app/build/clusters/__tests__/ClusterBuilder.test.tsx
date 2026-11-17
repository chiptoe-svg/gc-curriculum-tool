import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import { textHash } from '@/lib/catalog/bundles';
import { normalizeStatement } from '@/lib/catalog/project-trail';
import { emptyClusterState, type ClusterState } from '@/lib/builder/cluster/state';
import type { Depth, Library, LibraryCourse } from '@/lib/builder/types';
import { ClusterBuilder } from '../[id]/ClusterBuilder';

vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const hash = (s: string) => textHash(normalizeStatement(s));
const NONE: Depth = { k: null, u: null, d: null };
const SUP = 'Mix ink to a spot color';
const NEED = 'Read a job ticket';
const A = 'Calibrate a proof';
const COBJ = 'Manage color across a print workflow';
const ID = '11111111-1111-4111-8111-111111111111';

const course = (code: string, o: { skills?: string[]; required?: string[] } = {}): LibraryCourse => ({
  code, title: `Title ${code}`, level: 1, category: 'gc_core', track: 'Core', description: '', credits: null, wiki: null,
  objectives: [], sheetProjects: [], stated: [], whatIfs: [],
  versions: [{
    snapshotId: code, instructorName: null, createdAt: '2026-01-01T00:00:00.000Z', depths: [], outcomes: [], disagreements: [],
    projects: [], conditions: null, unmapped: [], suggestions: [], linked: false,
    skills: (o.skills ?? []).map(s => ({ skillRef: hash(s), statement: s, k: 3, u: 3, d: 3 })),
    required: (o.required ?? []).map(s => ({ ref: hash(s), statement: s, need: NONE })),
  }],
});
const library: Library = {
  courses: [course('GC 1010', { skills: [SUP, A] }), course('GC 2070', { required: [NEED] })],
  competencies: [], targets: [], decisions: {}, candidates: {},
  prereqs: [{ prereqCode: 'GC 1010', courseCode: 'GC 2070', kind: 'prereq', anyOfGroup: null }],
};
const state = (over: Partial<ClusterState> = {}): ClusterState => ({
  ...emptyClusterState(), cards: [{ ref: 'GC 1010', x: 20, y: 20 }, { ref: 'GC 2070', x: 300, y: 20 }], ...over,
});

type Call = { url: string; body: Record<string, unknown> };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function stubFetch(respond: (c: Call) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const c = { url, body: init?.body ? JSON.parse(String(init.body)) : {} };
    calls.push(c);
    return respond(c);
  }));
  return calls;
}
const mount = (s: ClusterState) => render(
  <ClusterBuilder clusterId={ID} slug="s" library={library} initialName="Print run" initialState={s} initialVersion={1} knownName="Tester" clusterDecisions={{}} />,
);
const card = (code: string) => screen.getByRole('group', { name: `${code} Title ${code}` });

describe('ClusterBuilder judging', () => {
  it('judges a required skill against its upstream course and lands the answer where the status reads it', async () => {
    const calls = stubFetch(c => (c.body.action === 'judge'
      ? json(200, { results: [{ ref: hash(SUP), similarity: 0.9, pFully: 0.95, pPartly: 0.95 }, { ref: hash(A), similarity: 0.2, pFully: 0.01, pPartly: 0.01 }] })
      : json(500, {})));
    mount(state());
    expect(card('GC 2070')).toHaveTextContent('0 met · 0 partly · 0 not · 1 matching');
    await waitFor(() => expect(card('GC 2070')).toHaveTextContent('1 met · 0 partly · 0 not'));
    const judge = calls.filter(c => c.body.action === 'judge');
    expect(judge).toHaveLength(1);
    expect(judge[0]!.body).toMatchObject({
      clusterId: ID, anchor: { text: NEED, course: 'GC 2070', title: 'Title GC 2070', side: 'required' },
      others: [{ ref: hash(SUP), text: SUP, course: 'GC 1010', title: 'Title GC 1010' }, { ref: hash(A), text: A, course: 'GC 1010', title: 'Title GC 1010' }],
    });
  });

  it('asks the set judge when only partial pairs are found, and shows the set', async () => {
    const calls = stubFetch(c => {
      if (c.body.action === 'judge') {
        const anchor = c.body.anchor as { text: string };
        return anchor.text === COBJ
          ? json(200, { results: [{ ref: hash(SUP), similarity: 0.5, pFully: 0.1, pPartly: 0.6 }, { ref: hash(A), similarity: 0.5, pFully: 0.1, pPartly: 0.6 }] })
          : json(200, { results: [{ ref: hash(SUP), similarity: 0.9, pFully: 0.01, pPartly: 0.01 }, { ref: hash(A), similarity: 0.9, pFully: 0.01, pPartly: 0.01 }] });
      }
      if (c.body.action === 'judge-set') return json(200, { verdict: { pAny: 0.9, kept: [hash(SUP), hash(A)], pTogether: 0.9, pCombining: 0.9 } });
      return json(500, {});
    });
    mount(state({ objectives: [{ id: 'o1', text: COBJ }] }));
    const strip = screen.getByRole('region', { name: 'Cluster objectives' });
    await waitFor(() => expect(within(strip).getByRole('listitem')).toHaveTextContent('Met by GC 1010 (used together)'));
    const set = calls.filter(c => c.body.action === 'judge-set');
    expect(set).toHaveLength(1);
    expect(set[0]!.body).toMatchObject({ clusterId: ID, target: { key: 'cobj:o1', text: COBJ, course: 'Cluster', title: 'Print run' } });
    expect((set[0]!.body.pool as Array<{ ref: string }>).map(p => p.ref).sort()).toEqual([hash(SUP), hash(A)].sort());
  });

  it('two cluster objectives with the same text each get their set request and their status', async () => {
    const calls = stubFetch(c => {
      if (c.body.action === 'judge') return json(200, { results: [{ ref: hash(SUP), similarity: 0.5, pFully: 0.1, pPartly: 0.6 }, { ref: hash(A), similarity: 0.5, pFully: 0.1, pPartly: 0.6 }] });
      if (c.body.action === 'judge-set') return json(200, { verdict: { pAny: 0.9, kept: [hash(SUP), hash(A)], pTogether: 0.9, pCombining: 0.9 } });
      return json(500, {});
    });
    mount(state({ cards: [{ ref: 'GC 1010', x: 20, y: 20 }], objectives: [{ id: 'o1', text: COBJ }, { id: 'o2', text: COBJ }] }));
    const items = within(screen.getByRole('region', { name: 'Cluster objectives' })).getAllByRole('listitem');
    await waitFor(() => { for (const i of items) expect(i).toHaveTextContent('Met by GC 1010 (used together)'); });
    expect(calls.filter(c => c.body.action === 'judge-set').map(c => (c.body.target as { key: string }).key).sort()).toEqual(['cobj:o1', 'cobj:o2']);
  });

  it('a campus outage shows the error and Try again on a cluster objective, never Not met', async () => {
    let down = true;
    const calls = stubFetch(c => (c.body.action === 'judge'
      ? (down ? json(502, { error: 'x' }) : json(200, { results: [{ ref: hash(SUP), similarity: 0.9, pFully: 0.9, pPartly: 0.9 }, { ref: hash(A), similarity: 0.1, pFully: 0.01, pPartly: 0.01 }] }))
      : json(500, {})));
    mount(state({ cards: [{ ref: 'GC 1010', x: 20, y: 20 }], objectives: [{ id: 'o1', text: COBJ }] }));
    const item = within(screen.getByRole('region', { name: 'Cluster objectives' })).getByRole('listitem');
    await waitFor(() => expect(item).toHaveTextContent('The campus model did not answer; try again.'));
    expect(item).not.toHaveTextContent('Not met');
    down = false;
    fireEvent.click(within(item).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(item).toHaveTextContent('Met'));
    expect(calls.filter(c => c.body.action === 'judge')).toHaveLength(2);
  });
});
