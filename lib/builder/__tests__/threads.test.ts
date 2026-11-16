import { describe, it, expect } from 'vitest';
import { textHash } from '@/lib/catalog/bundles';
import { normalizeStatement } from '@/lib/catalog/project-trail';
import { CUTOFFS, MODEL_IN_USE } from '@/lib/ai/match-judge';
import { heldAt, placeCourses } from '../compute';
import { requiredByCourse } from '../threads';
import {
  EMPTY_PLAN, type Candidate, type CourseEdits, type Depth, type Library, type LibraryCourse, type MatchDecision, type PlanState,
} from '../types';

const hash = (s: string) => textHash(normalizeStatement(s));
const FULLY = CUTOFFS[MODEL_IN_USE].fully;
const NEED = 'Read a job ticket';
const SUP = 'Mix ink';

const course = (code: string, skills: Array<[string, number, number, number]>, required: Array<[string, Depth]> = []): LibraryCourse => ({
  code, title: code, level: 1, category: 'gc_core', track: 'Core', description: '', credits: null, wiki: null,
  objectives: [], sheetProjects: [], stated: [], whatIfs: [],
  versions: [{
    snapshotId: code, instructorName: null, createdAt: '2026-01-01T00:00:00.000Z', depths: [], outcomes: [], disagreements: [],
    projects: [], conditions: null, unmapped: [], suggestions: [], linked: false,
    skills: skills.map(([s, k, u, d]) => ({ skillRef: hash(s), statement: s, k, u, d })),
    required: required.map(([s, need]) => ({ ref: hash(s), statement: s, need })),
  }],
});
const cand = (course: string, sup: string, pFully: number | null, pPartly: number | null = null): Candidate => ({
  requiredRef: hash(NEED), suppliedRef: hash(sup), suppliedCourse: course, suppliedStatement: sup, similarity: 0.8, pFully, pPartly,
});
const lib = (courses: LibraryCourse[], cands: Candidate[], decisions: Library['decisions'] = {}, prereqs: Library['prereqs'] = []): Library => ({
  courses, competencies: [], targets: [], prereqs, decisions,
  candidates: { ['GC 2|' + hash(NEED)]: cands },
});
/** terms: course -> [act, slot]. */
const mk = (l: Library, terms: Record<string, [1 | 2 | 3, 0 | 1 | 2]>, over: Partial<PlanState> = {}) => {
  const plan: PlanState = {
    ...EMPTY_PLAN, fade: 0, ...over,
    placements: Object.entries(terms).map(([ref, [act, slot]]) => ({ ref, act, branch: null, slot, x: 0 })),
  };
  return { plan, courses: placeCourses(l, plan) };
};
const run = (l: Library, terms: Record<string, [1 | 2 | 3, 0 | 1 | 2]>, over: Partial<PlanState> = {}, drafts = {}, pd: Record<string, MatchDecision> = {}) => {
  const { plan, courses } = mk(l, terms, over);
  return requiredByCourse(l, plan, courses, drafts, pd)['GC 2']!;
};
const need = (d: number): Depth => ({ k: null, u: null, d });
const dec = (label: MatchDecision['label'], draft = false): MatchDecision =>
  ({ requiredRef: hash(NEED), suppliedRef: hash(SUP), label, by: 'X', at: '2026-11-16T00:00:00Z', draft });
const key = `${hash(NEED)}|${hash(SUP)}`;

describe('requiredByCourse', () => {
  const c1 = course('GC 1', [[SUP, 3, 3, 3]]);
  const c2 = course('GC 2', [], [[NEED, need(3)]]);
  const base = lib([c1, c2], [cand('GC 1', SUP, 0.9)]);
  const early = { 'GC 1': [1, 0], 'GC 2': [1, 2] } as Record<string, [1, 0 | 2]>;

  it('met from an earlier term', () => {
    const r = run(base, early);
    expect(r.results[0]).toMatchObject({ status: 'met', short: [], faded: [], supplier: { course: 'GC 1', draft: false, source: 'judge', label: 'fully' } });
  });

  it('same term without coreq is not eligible', () => {
    expect(run(base, { 'GC 1': [1, 1], 'GC 2': [1, 1] }).results[0]!.status).toBe('not');
  });

  it('same term with a plan coreq is Met*', () => {
    const r = run(base, { 'GC 1': [1, 1], 'GC 2': [1, 1] }, { links: [{ from: 'GC 1', to: 'GC 2', kind: 'coreq' }] });
    expect(r.results[0]).toMatchObject({ status: 'met_draft', supplier: { draft: true } });
  });

  it('same term with a catalog coreq is Met', () => {
    const l = lib([c1, c2], [cand('GC 1', SUP, 0.9)], {}, [{ courseCode: 'GC 2', prereqCode: 'GC 1', kind: 'concurrent_ok', anyOfGroup: null }]);
    expect(run(l, { 'GC 1': [1, 1], 'GC 2': [1, 1] }).results[0]!.status).toBe('met');
  });

  it('rejected decision beats pFully 0.99', () => {
    const l = lib([c1, c2], [cand('GC 1', SUP, 0.99)], { [key]: dec('not') });
    expect(run(l, early).results[0]!.status).toBe('not');
  });

  it('accepted decision beats pFully 0.1', () => {
    const l = lib([c1, c2], [cand('GC 1', SUP, 0.1)], { [key]: dec('fully') });
    expect(run(l, early).results[0]).toMatchObject({ status: 'met', supplier: { source: 'decision' } });
  });

  it('a plan decision overrides a library decision', () => {
    const l = lib([c1, c2], [cand('GC 1', SUP, 0.9)], { [key]: dec('fully') });
    expect(run(l, early, {}, {}, { [key]: dec('not', true) }).results[0]!.status).toBe('not');
  });

  it('short on D gives partly with short [d]', () => {
    const l = lib([course('GC 1', [[SUP, 3, 3, 2]]), c2], [cand('GC 1', SUP, 0.9)]);
    expect(run(l, early).results[0]).toMatchObject({ status: 'partly', short: ['d'] });
  });

  it('a partly match gives partly', () => {
    const l = lib([c1, c2], [cand('GC 1', SUP, 0.1, 0.95)]);
    expect(run(l, early).results[0]).toMatchObject({ status: 'partly', supplier: { label: 'partly' } });
  });

  it('a draft developed skill gives Met*', () => {
    const draftSkill = 'Run a proof';
    const edits: CourseEdits = { objectives: [], required: [], developed: [
      { id: 'e', by: 'X', at: 't', action: 'add', target: null, statement: draftSkill, levels: { k: 3, u: 3, d: 3 } }] };
    const l = lib([course('GC 1', []), c2], []);
    const dk = `${hash(NEED)}|${hash(draftSkill)}`;
    const r = run(l, early, { courseEdits: { 'GC 1': edits } }, { [dk]: { pFully: 0.9, pPartly: null } });
    expect(r.results[0]).toMatchObject({ status: 'met_draft', supplier: { statement: draftSkill, draft: true } });
    // without a draft judgment it is not a candidate
    expect(run(l, early, { courseEdits: { 'GC 1': edits } }).results[0]!.status).toBe('not');
  });

  it('an edited required skill does not reuse the old wording judgments', () => {
    const edits: CourseEdits = { objectives: [], required: [
      { id: 'e', by: 'X', at: 't', action: 'edit', target: hash(NEED), statement: 'Read a ticket', levels: null }], developed: [] };
    const r = run(base, early, { courseEdits: { 'GC 2': edits } });
    expect(r.results[0]).toMatchObject({ status: 'not', required: { draft: true } });
    const nk = `${hash('Read a ticket')}|${hash(SUP)}`;
    expect(run(base, early, { courseEdits: { 'GC 2': edits } }, { [nk]: { pFully: 0.9, pPartly: null } }).results[0]!.status).toBe('met_draft');
  });

  it('supplier removed from the map gives not', () => {
    expect(run(base, { 'GC 2': [1, 2] }).results[0]!.status).toBe('not');
  });

  it('a course own skills are never suppliers', () => {
    const self = course('GC 2', [[SUP, 3, 3, 3]], [[NEED, need(3)]]);
    const l = lib([self], [cand('GC 2', SUP, 0.9)]);
    expect(run(l, { 'GC 2': [1, 2] }).results[0]!.status).toBe('not');
  });

  it('counts sum to the number of required skills', () => {
    const two = course('GC 2', [], [[NEED, need(3)], ['Other thing', need(1)]]);
    const l = lib([c1, two], [cand('GC 1', SUP, 0.9)]);
    const r = run(l, early);
    expect(Object.values(r.counts).reduce((a, b) => a + b, 0)).toBe(2);
    expect(r.counts).toMatchObject({ met: 1, not: 1 });
  });

  it('skips courses with no required skills and placeholders', () => {
    const { plan, courses } = mk(base, early);
    expect(Object.keys(requiredByCourse(base, plan, courses, {}))).toEqual(['GC 2']);
  });

  it('a D3 supplier four terms back with fade 1 gives partly, faded [d], against a D3 need', () => {
    const r = run(base, { 'GC 1': [1, 0], 'GC 2': [2, 1] }, { fade: 1 }); // term 1 -> term 5
    expect(r.results[0]).toMatchObject({ status: 'partly', short: [], faded: ['d'] });
  });

  it('fade 0 never fades', () => {
    expect(run(base, { 'GC 1': [1, 0], 'GC 2': [3, 2] }, { fade: 0 }).results[0]!.status).toBe('met');
  });

  it('a later fully supplier restores the level, though its own level falls short', () => {
    // GC 1 D3 at term 1; GC 3 D2 at term 4 (near the peak, but short of D3 itself); GC 2 needs D3 at term 4 (catalog coreq with GC 3).
    const c3 = course('GC 3', [['Check a ticket', 3, 3, 2]]);
    const two = course('GC 2', [], [[NEED, need(3)]]);
    const l = lib([c1, c3, two], [cand('GC 1', SUP, 0.9), cand('GC 3', 'Check a ticket', 0.8)], {},
      [{ courseCode: 'GC 2', prereqCode: 'GC 3', kind: 'concurrent_ok', anyOfGroup: null }]);
    const terms = { 'GC 1': [1, 0], 'GC 3': [2, 0], 'GC 2': [2, 0] } as Record<string, [1 | 2, 0]>;
    expect(run(l, terms, { fade: 1 }).results[0]).toMatchObject({ status: 'met', faded: [], supplier: { course: 'GC 1' } });
    // Without the later supplier the level has faded.
    const l2 = lib([c1, two], [cand('GC 1', SUP, 0.9)]);
    expect(run(l2, { 'GC 1': [1, 0], 'GC 2': [2, 0] }, { fade: 1 }).results[0]).toMatchObject({ status: 'partly', faded: ['d'] });
  });

  it('a draft supplier that restores the level gives Met*, not Met', () => {
    const draftSkill = 'Check a ticket';
    const edits: CourseEdits = { objectives: [], required: [], developed: [
      { id: 'e', by: 'X', at: 't', action: 'add', target: null, statement: draftSkill, levels: { k: 3, u: 3, d: 3 } }] };
    const two = course('GC 2', [], [[NEED, need(2)]]);
    const l = lib([c1, course('GC 3', []), two], [cand('GC 1', SUP, 0.9)]);
    const dk = `${hash(NEED)}|${hash(draftSkill)}`;
    const terms = { 'GC 1': [1, 0], 'GC 3': [2, 0], 'GC 2': [2, 1] } as Record<string, [1 | 2, 0 | 1]>;
    // GC 1 alone: D3 at term 1 held to term 5 = 1, short of D2.
    expect(run(l, terms, { fade: 1 }).results[0]!.status).toBe('partly');
    const r = run(l, terms, { fade: 1, courseEdits: { 'GC 3': edits } }, { [dk]: { pFully: 0.9, pPartly: null } }).results[0]!;
    expect(r.status).toBe('met_draft');
    expect(r.supplier!.draft).toBe(false); // the captured supplier is not italicized
    expect(r.restoredByDraft).toBe(true);
  });

  it('a short dimension does not hide a faded one', () => {
    const l = lib([course('GC 1', [[SUP, 3, 3, 2]]), course('GC 2', [], [[NEED, { k: 3, u: null, d: 3 }]])], [cand('GC 1', SUP, 0.9)]);
    expect(run(l, { 'GC 1': [1, 0], 'GC 2': [2, 1] }, { fade: 1 }).results[0]).toMatchObject({ status: 'partly', short: ['d'], faded: ['k'] });
  });
});

describe('heldAt', () => {
  it('truncates, never rounds up', () => {
    expect(heldAt([{ term: 1, level: 3 }], 1, 1)).toBe(3);
    expect(heldAt([{ term: 1, level: 3 }], 2, 1)).toBe(2); // 2.67
    expect(heldAt([{ term: 1, level: 3 }], 4, 1)).toBe(2); // 2.0
    expect(heldAt([{ term: 1, level: 3 }], 5, 1)).toBe(1); // 1.67
  });
  it('fade 0 holds, and a near-peak contribution restores', () => {
    expect(heldAt([{ term: 1, level: 3 }], 9, 0)).toBe(3);
    expect(heldAt([{ term: 1, level: 3 }, { term: 5, level: 3 }], 6, 1)).toBe(2);
    expect(heldAt([{ term: 1, level: 3 }, { term: 5, level: 3 }], 5, 1)).toBe(3);
    expect(heldAt([{ term: 1, level: 3 }, { term: 5, level: 2 }], 5, 1)).toBe(3); // within one level of the peak restores
  });
  it('is 0 with no contribution', () => { expect(heldAt([], 5, 1)).toBe(0); });
});
