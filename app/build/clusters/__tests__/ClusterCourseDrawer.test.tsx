import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { textHash } from '@/lib/catalog/bundles';
import { normalizeStatement } from '@/lib/catalog/project-trail';
import { emptyClusterState, type ClusterState } from '@/lib/builder/cluster/state';
import { clusterStatuses, type StatusResult } from '@/lib/builder/cluster/status';
import type { DraftJudgments } from '@/lib/builder/threads';
import type { Depth, Library, LibraryCourse } from '@/lib/builder/types';
import type { ObjectiveGuideSection } from '@/lib/wiki/objective-guide-section';
import { ClusterCourseDrawer } from '../[id]/ClusterCourseDrawer';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const hash = (s: string) => textHash(normalizeStatement(s));
const NONE: Depth = { k: null, u: null, d: null };
const SUP = 'Mix ink to a spot color';
const NEED = 'Read a job ticket';
const OBJ = 'Run a press check';
const DRAFT = 'Check a press sheet against the proof';
const ID = '11111111-1111-4111-8111-111111111111';

const course = (code: string, o: { skills?: string[]; required?: string[]; objectives?: string[] } = {}): LibraryCourse => ({
  code, title: `Title ${code}`, level: 1, category: 'gc_core', track: 'Core', description: `About ${code}`, credits: '3', wiki: null,
  objectives: o.objectives ?? [], sheetProjects: [], stated: [], whatIfs: [],
  versions: [{
    snapshotId: code, instructorName: null, createdAt: '2026-01-15T12:00:00.000Z', depths: [], outcomes: [], disagreements: [],
    projects: [], conditions: null, unmapped: [], suggestions: [], linked: false,
    skills: (o.skills ?? []).map(s => ({ skillRef: hash(s), statement: s, k: 3, u: 3, d: 3 })),
    required: (o.required ?? []).map(s => ({ ref: hash(s), statement: s, need: NONE })),
  }],
});
const library: Library = {
  courses: [course('GC 1010', { skills: [SUP] }), course('GC 2070', { required: [NEED], objectives: [OBJ] })],
  competencies: [], targets: [], decisions: {}, candidates: {},
  prereqs: [{ prereqCode: 'GC 1010', courseCode: 'GC 2070', kind: 'prereq', anyOfGroup: null }],
};
const EDIT = { id: 'e1', by: 'Tester', at: '2026-11-17T10:00:00.000Z' };
const base = (over: Partial<ClusterState> = {}): ClusterState => ({
  ...emptyClusterState(),
  cards: [{ ref: 'GC 1010', x: 20, y: 20 }, { ref: 'GC 2070', x: 300, y: 20 }, { ref: 'new-1', x: 600, y: 20 }],
  proposed: [{ id: 'new-1', source: 'new', code: 'GC 9001', credits: null, title: 'Press lab', description: '', objectives: [], depths: [] }],
  courseEdits: { 'GC 2070': { objectives: [], required: [], developed: [{ ...EDIT, action: 'add', target: null, statement: DRAFT, levels: null }] } },
  ...over,
});
const judged: DraftJudgments = {
  [`${hash(OBJ)}|${hash(DRAFT)}`]: { pFully: 0.95, pPartly: 0.95 },
  [`${hash(NEED)}|${hash(SUP)}`]: { pFully: 0.95, pPartly: 0.95 },
};

function mount(o: { state?: ClusterState; ref?: string; guide?: ObjectiveGuideSection | null; judgments?: DraftJudgments; judging?: Record<string, string>; errorOf?: (r: StatusResult, kind: 'required' | 'objective') => string | null } = {}) {
  const state = o.state ?? base();
  const ref = o.ref ?? 'GC 2070';
  const s = clusterStatuses(library, state, o.judgments ?? judged, {}, {});
  const update = vi.fn();
  const onRetry = vi.fn();
  const decide = vi.fn(async () => null);
  const codeOf = (r: string) => (r === 'new-1' ? 'GC 9001' : r);
  render(
    <ClusterCourseDrawer courseRef={ref} clusterId={ID} slug="s" library={library} cluster={state} update={update}
      required={s.required[ref] ?? []} objectives={s.objectives[ref] ?? []} codeOf={codeOf}
      decisions={{}} decide={decide} errorOf={o.errorOf ?? (() => null)} onRetry={onRetry}
      judging={{ judging: o.judging ?? {}, retryJudge: vi.fn() }}
      stamp={() => EDIT} who={() => 'Tester'} author={() => 'Tester'} guide={o.guide ?? null}
      onSelect={vi.fn()} onRemove={vi.fn()} onClose={vi.fn()} />,
  );
  return { update, state, onRetry, decide };
}
/** Run the updater the drawer passed to `update` on a state. */
const applied = (update: ReturnType<typeof vi.fn>, s: ClusterState): ClusterState => (update.mock.calls.at(-1)![0] as (x: ClusterState) => ClusterState)(s);
const section = (name: string) => screen.getByRole('region', { name });

describe('ClusterCourseDrawer', () => {
  it('shows objective statuses with proposed wording', () => {
    mount();
    const obj = section('Objectives');
    expect(within(obj).getByText(OBJ)).toBeInTheDocument();
    expect(obj).toHaveTextContent('Met: proposed (edited skill in GC 2070)');
    expect(section('Required skills')).toHaveTextContent('Met');
    expect(section('Required skills')).toHaveTextContent(`From GC 1010: ${SUP}`);
  });

  it('override sets a cluster override', () => {
    const { update, state } = mount({ judgments: {} });
    const obj = section('Objectives');
    fireEvent.click(within(obj).getByRole('button', { name: 'Override' }));
    fireEvent.change(within(obj).getByRole('textbox', { name: 'Reason (optional)' }), { target: { value: 'Seen in the lab' } });
    fireEvent.click(within(obj).getByRole('button', { name: 'Partly' }));
    const next = applied(update, { ...state, overrides: [{ targetKey: `obj:GC 2070|${hash(OBJ)}`, textHash: 'old', label: 'not', by: 'X', at: 'y', reason: null }] });
    expect(next.overrides).toHaveLength(1);
    expect(next.overrides[0]).toMatchObject({ targetKey: `obj:GC 2070|${hash(OBJ)}`, textHash: hash(OBJ), label: 'partly', by: 'Tester', reason: 'Seen in the lab' });
  });

  it('a required skill can be overridden; it replaces an override under the same or former key', () => {
    const NEW = 'Read and check a job ticket';
    const former = { targetKey: `req:GC 2070|${hash(NEED)}`, textHash: hash(NEED), label: 'met' as const, by: 'Ann', at: '2026-11-17T10:00:00.000Z', reason: null };
    const edited = base({
      overrides: [former],
      courseEdits: { 'GC 2070': { objectives: [], developed: [], required: [{ ...EDIT, action: 'edit', target: hash(NEED), statement: NEW, levels: null }] } },
    });
    const { update, state } = mount({ state: edited, judgments: {} });
    const req = section('Required skills');
    expect(req).toHaveTextContent('Override out of date (the skill changed)');
    fireEvent.click(within(req).getByRole('button', { name: 'Override' }));
    fireEvent.change(within(req).getByRole('textbox', { name: 'Reason (optional)' }), { target: { value: 'Taught in the lab' } });
    fireEvent.click(within(req).getByRole('button', { name: 'Not' }));
    const key = `req:GC 2070|${hash(NEW)}`;
    const next = applied(update, { ...state, overrides: [...state.overrides, { ...former, targetKey: key, label: 'partly' }] });
    expect(next.overrides).toEqual([expect.objectContaining({ targetKey: key, textHash: hash(NEW), label: 'not', by: 'Tester', reason: 'Taught in the lab' })]);
    fireEvent.click(within(req).getByRole('button', { name: 'Clear override' }));
    expect(applied(update, state).overrides).toEqual([]);
  });

  it('a met course objective names the course skill that meets it', () => {
    mount();
    expect(section('Objectives')).toHaveTextContent(`From GC 2070: ${DRAFT}`);
  });

  it('an override in force can be cleared; an out-of-date one says so', () => {
    const key = `obj:GC 2070|${hash(OBJ)}`;
    const o = { targetKey: key, textHash: hash(OBJ), label: 'met' as const, by: 'Ann', at: '2026-11-17T10:00:00.000Z', reason: null };
    const { update, state } = mount({ state: base({ overrides: [o] }), judgments: {} });
    const obj = section('Objectives');
    expect(obj).toHaveTextContent('Met');
    fireEvent.click(within(obj).getByRole('button', { name: 'Clear override' }));
    expect(applied(update, state).overrides).toEqual([]);
    cleanup();
    mount({ state: base({ overrides: [{ ...o, textHash: 'stale' }, { ...o, targetKey: `req:GC 2070|${hash(NEED)}`, textHash: 'stale' }] }), judgments: {} });
    expect(section('Objectives')).toHaveTextContent('Override out of date (the objective changed)');
    expect(section('Required skills')).toHaveTextContent('Override out of date (the skill changed)');
  });

  it('a failed match shows the error and Try again, not Not met', () => {
    const { onRetry } = mount({ judgments: {}, errorOf: () => 'The campus model did not answer; try again.' });
    const req = section('Required skills');
    expect(req).toHaveTextContent('The campus model did not answer; try again.');
    expect(req).not.toHaveTextContent('Not met');
    fireEvent.click(within(req).getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ targetKey: `req:GC 2070|${hash(NEED)}` }), 'required');
  });

  it('save as new version posts the course ref', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ id: 'w1', title: 'GC 2070 as edited on Print run' }), { status: 201 });
    }));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Save as a new version' }));
    await waitFor(() => expect(screen.getByText('Saved as a new version: GC 2070 as edited on Print run')).toBeInTheDocument());
    expect(calls).toEqual([{ url: `/api/build/clusters/${ID}/versions`, body: { courseRef: 'GC 2070', authorName: 'Tester' } }]);
    expect(screen.getByRole('link', { name: 'Download changes' })).toHaveAttribute('href', `/api/build/clusters/${ID}/changes.md`);
  });

  it('save as new version is off for a proposed course, with the reason', () => {
    mount({ ref: 'new-1' });
    const b = screen.getByRole('button', { name: 'Save as a new version' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('title', 'Only a tracked course can be saved as a version.');
  });

  it('no competency section renders', () => {
    mount();
    const panel = screen.getByRole('complementary');
    expect(panel).not.toHaveTextContent(/competenc/i);
    expect(panel).not.toHaveTextContent(/thread/i);
    for (const s of panel.querySelectorAll('.cl-status')) expect(s.textContent).not.toMatch(/\b[KUD]\s?\d/);
  });

  it('guide hidden when absent', () => {
    mount({ guide: null });
    expect(screen.queryByRole('region', { name: 'How it is graded' })).toBeNull();
    cleanup();
    mount({ guide: { kind: 'guide', guide: { intro: 'How the objectives are measured.', objectives: [], checklist: [] } as never, text: 't', canvasPrompt: 'p', capturedOn: '2026-01-01' } });
    expect(section('How it is graded')).toHaveTextContent('How the objectives are measured.');
  });

  it('lists the prerequisites on this cluster and selects one', () => {
    mount();
    const pre = section('Prerequisites on this cluster');
    expect(within(pre).getByRole('button', { name: 'GC 1010 Title GC 1010' })).toBeInTheDocument();
  });

  it('the version picker lists captures and skills-only what-ifs, not page what-ifs (they have no skills)', () => {
    const lib2 = { ...library };
    lib2.courses = library.courses.map(c => (c.code !== 'GC 2070' ? c : {
      ...c, whatIfs: [
        { id: 'w1', title: 'Bigger lab', author: 'Ann', depths: [], notComputed: [], skills: null, baseSnapshotId: 'GC 2070' },
        { id: 'w2', title: 'GC 2070 as edited on Print run', author: 'Ann', depths: [], notComputed: [], skills: { objectives: [], developed: [], required: [], fromCluster: ID }, baseSnapshotId: 'GC 2070' },
      ],
    }));
    const state = base();
    const s = clusterStatuses(lib2, state, judged, {}, {});
    const update = vi.fn();
    render(
      <ClusterCourseDrawer courseRef="GC 2070" clusterId={ID} slug="s" library={lib2} cluster={state} update={update}
        required={s.required['GC 2070']!} objectives={s.objectives['GC 2070']!} codeOf={r => r}
        decisions={{}} decide={vi.fn()} errorOf={() => null} onRetry={vi.fn()} judging={{ judging: {}, retryJudge: vi.fn() }}
        stamp={() => EDIT} who={() => 'Tester'} author={() => 'Tester'} guide={null}
        onSelect={vi.fn()} onRemove={vi.fn()} onClose={vi.fn()} />,
    );
    const pick = screen.getByRole('combobox', { name: 'Version on this cluster' });
    expect(within(pick).getAllByRole('option').map(o => o.textContent)).toEqual([
      'Newest capture (department, Jan 2026)', 'What-if: GC 2070 as edited on Print run (Ann), skills only',
    ]);
    fireEvent.change(pick, { target: { value: 'whatif:w2' } });
    expect(applied(update, state).versions).toEqual({ 'GC 2070': 'whatif:w2' });
    // One capture and only a page what-if: nothing to pick.
    cleanup();
    const lib3 = { ...library, courses: library.courses.map(c => (c.code !== 'GC 2070' ? c : { ...c, whatIfs: [lib2.courses[1]!.whatIfs[0]!] })) };
    render(
      <ClusterCourseDrawer courseRef="GC 2070" clusterId={ID} slug="s" library={lib3} cluster={state} update={update}
        required={s.required['GC 2070']!} objectives={s.objectives['GC 2070']!} codeOf={r => r}
        decisions={{}} decide={vi.fn()} errorOf={() => null} onRetry={vi.fn()} judging={{ judging: {}, retryJudge: vi.fn() }}
        stamp={() => EDIT} who={() => 'Tester'} author={() => 'Tester'} guide={null}
        onSelect={vi.fn()} onRemove={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.queryByRole('combobox', { name: 'Version on this cluster' })).toBeNull();
  });
});
