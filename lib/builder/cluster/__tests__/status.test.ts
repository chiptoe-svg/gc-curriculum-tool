import { describe, it, expect } from 'vitest';
import { textHash } from '@/lib/catalog/bundles';
import { normalizeStatement } from '@/lib/catalog/project-trail';
import { clusterStatuses, statusLabel, type SetVerdicts, type StatusResult } from '../status';
import { emptyClusterState, type ClusterState } from '../state';
import type { DraftJudgments } from '../../threads';
import type { Depth, Library, LibraryCourse, MatchDecision, ProposedCourse } from '../../types';

const hash = (s: string) => textHash(normalizeStatement(s));
const NONE: Depth = { k: null, u: null, d: null };

const course = (code: string, o: { skills?: string[]; required?: Array<[string, Depth]>; objectives?: string[]; level?: number } = {}): LibraryCourse => ({
  code, title: code, level: 1, category: 'gc_core', track: 'Core', description: '', credits: null, wiki: null,
  objectives: o.objectives ?? [], sheetProjects: [], stated: [], whatIfs: [],
  versions: [{
    snapshotId: code, instructorName: null, createdAt: '2026-01-01T00:00:00.000Z', depths: [], outcomes: [], disagreements: [],
    projects: [], conditions: null, unmapped: [], suggestions: [], linked: false,
    skills: (o.skills ?? []).map(s => ({ skillRef: hash(s), statement: s, k: o.level ?? 3, u: o.level ?? 3, d: o.level ?? 3 })),
    required: (o.required ?? []).map(([s, need]) => ({ ref: hash(s), statement: s, need })),
  }],
});

const NEED = 'Read a job ticket';
const SUP = 'Mix ink to a spot color';
const OBJ = 'Plan a print run';
const OWN = 'Schedule a press run';
const A = 'Calibrate a proof';
const B = 'Explain color profiles to a client';
const COBJ = 'Manage color across a print workflow';

/** GC 1010 -> GC 2070 -> GC 4400 by catalog prerequisite. */
const lib = (o: { c1?: Parameters<typeof course>[1]; c2?: Parameters<typeof course>[1]; c3?: Parameters<typeof course>[1]; extra?: LibraryCourse[]; decisions?: Library['decisions']; candidates?: Library['candidates'] } = {}): Library => ({
  courses: [course('GC 1010', o.c1), course('GC 2070', o.c2), course('GC 4400', o.c3), ...(o.extra ?? [])],
  competencies: [], targets: [], decisions: o.decisions ?? {}, candidates: o.candidates ?? {},
  prereqs: [
    { prereqCode: 'GC 1010', courseCode: 'GC 2070', kind: 'prereq', anyOfGroup: null },
    { prereqCode: 'GC 2070', courseCode: 'GC 4400', kind: 'prereq', anyOfGroup: null },
  ],
});
const state = (over: Partial<ClusterState> = {}, refs = ['GC 1010', 'GC 2070', 'GC 4400']): ClusterState => ({
  ...emptyClusterState(), cards: refs.map((ref, i) => ({ ref, x: 0, y: i * 100 })), ...over,
});
const j = (pFully: number | null, pPartly: number | null = null) => ({ pFully, pPartly });
const run = (l: Library, s: ClusterState, judgments: DraftJudgments = {}, sets: SetVerdicts = {}, decisions: Record<string, MatchDecision> = {}) =>
  clusterStatuses(l, s, judgments, sets, decisions);
const codeOf = (s: ClusterState) => (ref: string) => s.proposed.find(p => p.id === ref)?.code ?? ref;
const label = (r: StatusResult, s: ClusterState) => statusLabel(r, codeOf(s));
const proposed = (id: string, code: string): ProposedCourse => ({ id, source: 'new', code, credits: null, title: code, description: '', objectives: [], depths: [] });
const add = (statement: string, origin: 'syllabus' | 'faculty') =>
  ({ id: `e-${statement}`, by: 'X', at: '2026-11-17T00:00:00Z', origin, action: 'add' as const, target: null, statement, levels: null });

describe('clusterStatuses', () => {
  it('met from two steps upstream', () => {
    const l = lib({ c1: { skills: [SUP] }, c3: { required: [[NEED, NONE]] } });
    const s = state();
    const r = run(l, s, { [`${hash(NEED)}|${hash(SUP)}`]: j(0.9, 0.9) }).required['GC 4400']![0]!;
    expect(r).toMatchObject({ targetKey: `req:GC 4400|${hash(NEED)}`, text: NEED, status: 'met', proposed: [], reason: null });
    expect(r.suppliers).toEqual([{ course: 'GC 1010', statement: SUP, ref: hash(SUP) }]);
    expect(label(r, s)).toBe('Met');
  });

  it('not met: no upstream courses', () => {
    const l = lib({ c1: { required: [[NEED, NONE]] }, c2: { skills: [SUP] } });
    const s = state();
    const r = run(l, s, { [`${hash(NEED)}|${hash(SUP)}`]: j(0.9, 0.9) }).required['GC 1010']![0]!;
    expect(r).toMatchObject({ status: 'not', reason: 'no upstream courses', suppliers: [] });
    expect(label(r, s)).toBe('Not met');
  });

  it('objective met by its own course\'s skill', () => {
    const l = lib({ c1: { skills: [SUP] }, c2: { skills: [OWN], objectives: [OBJ] } });
    const s = state();
    // A fully judgment against an upstream course's skill does not count: the pool is the course's own skills.
    const out = run(l, s, { [`${hash(OBJ)}|${hash(OWN)}`]: j(0.8, 0.9), [`${hash(OBJ)}|${hash(SUP)}`]: j(0.99, 0.99) });
    const r = out.objectives['GC 2070']![0]!;
    expect(r).toMatchObject({ targetKey: `obj:GC 2070|${hash(OBJ)}`, status: 'met' });
    expect(r.suppliers).toEqual([{ course: 'GC 2070', statement: OWN, ref: hash(OWN) }]);
    const empty = out.objectives['GC 4400'];
    expect(empty).toEqual([]);
    const l2 = lib({ c1: { objectives: [OBJ] } });
    expect(run(l2, s).objectives['GC 1010']![0]).toMatchObject({ status: 'not', reason: 'this course has no developed skills yet' });
  });

  const setLib = () => lib({ c2: { skills: [A] }, c3: { skills: [B] } });
  const setJudgments = (pFullyA = 0.2): DraftJudgments => ({ [`${hash(COBJ)}|${hash(A)}`]: j(pFullyA, 0.6), [`${hash(COBJ)}|${hash(B)}`]: j(0.1, 0.5) });
  const verdict = (pCombining: number) => ({ 'cobj:o1': { pAny: 0.9, kept: [hash(A), hash(B)], pTogether: 0.8, pCombining } });

  it('cluster objective met by a set used together', () => {
    const s = state({ objectives: [{ id: 'o1', text: COBJ }] });
    const r = run(setLib(), s, setJudgments(), verdict(0.7)).cluster[0]!;
    expect(r).toMatchObject({ targetKey: 'cobj:o1', status: 'met_set' });
    expect(r.suppliers.map(x => x.course)).toEqual(['GC 2070', 'GC 4400']);
    expect(label(r, s)).toBe('Met by GC 2070 + GC 4400 (used together)');
  });

  it('parts met, combining not shown', () => {
    const s = state({ objectives: [{ id: 'o1', text: COBJ }] });
    const r = run(setLib(), s, setJudgments(), verdict(0.2)).cluster[0]!;
    expect(r.status).toBe('parts_met');
    expect(label(r, s)).toBe('Parts met, combining not shown');
  });

  it('a failing set test falls back to the best pair', () => {
    const s = state({ objectives: [{ id: 'o1', text: COBJ }] });
    const r = run(setLib(), s, setJudgments(), { 'cobj:o1': { pAny: 0.1, kept: [hash(A), hash(B)], pTogether: 0.9, pCombining: 0.9 } }).cluster[0]!;
    expect(r.status).toBe('partly');
    expect(r.suppliers).toEqual([{ course: 'GC 2070', statement: A, ref: hash(A) }]);
    expect(label(r, s)).toBe('Partly met');
  });

  it('single full supplier wins over a set', () => {
    const s = state({ objectives: [{ id: 'o1', text: COBJ }] });
    const r = run(setLib(), s, setJudgments(0.9), verdict(0.7)).cluster[0]!;
    expect(r.status).toBe('met');
    expect(r.suppliers).toEqual([{ course: 'GC 2070', statement: A, ref: hash(A) }]);
  });

  it('pending when a pair is unjudged', () => {
    const l = lib({ c1: { skills: [SUP] }, c3: { required: [[NEED, NONE]] } });
    const s = state();
    const r = run(l, s).required['GC 4400']![0]!;
    expect(r.status).toBe('pending');
    expect(label(r, s)).toBe('Matching…');
    // A catalog candidate with no judge reading yet is still pending; with one it is judged.
    const cand = (pFully: number | null) => ({ [`GC 4400|${hash(NEED)}`]: [{ requiredRef: hash(NEED), suppliedRef: hash(SUP), suppliedCourse: 'GC 1010', suppliedStatement: SUP, similarity: 0.8, pFully, pPartly: pFully }] });
    expect(run(lib({ c1: { skills: [SUP] }, c3: { required: [[NEED, NONE]] }, candidates: cand(null) }), s).required['GC 4400']![0]!.status).toBe('pending');
    expect(run(lib({ c1: { skills: [SUP] }, c3: { required: [[NEED, NONE]] }, candidates: cand(0.9) }), s).required['GC 4400']![0]!.status).toBe('met');
    // Judged and not supplied reads Not met, not pending.
    expect(run(l, s, { [`${hash(NEED)}|${hash(SUP)}`]: j(0.01, 0.01) }).required['GC 4400']![0]!.status).toBe('not');
  });

  it('a failed judgment (null/null) reads pending, not Not met', () => {
    const l = lib({ c1: { skills: [SUP] }, c3: { required: [[NEED, NONE]] } });
    const s = state();
    const r = run(l, s, { [`${hash(NEED)}|${hash(SUP)}`]: j(null, null) }).required['GC 4400']![0]!;
    expect(r.status).toBe('pending');
    expect(label(r, s)).toBe('Matching…');
  });

  it('a pending target reads just Matching…, without a proposed suffix', () => {
    const l = lib({ c1: { skills: [SUP] } });
    const s = state({ courseEdits: { 'GC 4400': { objectives: [], required: [add(NEED, 'faculty')], developed: [] } } });
    const r = run(l, s).required['GC 4400']![0]!;
    expect(r).toMatchObject({ status: 'pending', proposed: ['edited skill in GC 4400'] });
    expect(label(r, s)).toBe('Matching…');
  });

  it('pending when a set verdict is needed but absent', () => {
    const s = state({ objectives: [{ id: 'o1', text: COBJ }] });
    expect(run(setLib(), s, setJudgments()).cluster[0]!.status).toBe('pending');
  });

  it('says when a set verdict is the missing piece, and which skills were checked', () => {
    const s = state({ objectives: [{ id: 'o1', text: COBJ }] });
    const waiting = run(setLib(), s, setJudgments()).cluster[0]!;
    expect(waiting).toMatchObject({ status: 'pending', needsSet: true, judgeRef: hash(COBJ) });
    expect(waiting.pool).toEqual([
      { course: 'GC 2070', code: 'GC 2070', ref: hash(A), statement: A, judged: true },
      { course: 'GC 4400', code: 'GC 4400', ref: hash(B), statement: B, judged: true },
    ]);
    // Answered, a full single supplier, or no pair judged yet: no set request.
    expect(run(setLib(), s, setJudgments(), verdict(0.7)).cluster[0]!.needsSet).toBe(false);
    expect(run(setLib(), s, setJudgments(0.9)).cluster[0]!.needsSet).toBe(false);
    const unjudged = run(setLib(), s).cluster[0]!;
    expect(unjudged).toMatchObject({ status: 'pending', needsSet: false });
    expect(unjudged.pool.map(p => p.judged)).toEqual([false, false]);
    // An override in force needs no set test.
    const over = state({ objectives: [{ id: 'o1', text: COBJ }], overrides: [{ targetKey: 'cobj:o1', textHash: hash(COBJ), label: 'met', by: 'X', at: 'now', reason: null }] });
    expect(run(setLib(), over, setJudgments()).cluster[0]!.needsSet).toBe(false);
  });

  it('a pair decision decides, ahead of the judge', () => {
    const l = lib({ c1: { skills: [SUP] }, c3: { required: [[NEED, NONE]] } });
    const s = state();
    const key = `${hash(NEED)}|${hash(SUP)}`;
    const dec = (label: MatchDecision['label']): MatchDecision => ({ requiredRef: hash(NEED), suppliedRef: hash(SUP), label, by: 'X', at: 'now', draft: false });
    expect(run(l, s, {}, {}, { [key]: dec('fully') }).required['GC 4400']![0]!.status).toBe('met');
    expect(run(lib({ c1: { skills: [SUP] }, c3: { required: [[NEED, NONE]] }, decisions: { [key]: dec('fully') } }), s).required['GC 4400']![0]!.status).toBe('met');
    expect(run(l, s, { [key]: j(0.99, 0.99) }, {}, { [key]: dec('not') }).required['GC 4400']![0]!.status).toBe('not');
  });

  it('proposed label names a syllabus-drafted supplier', () => {
    const l = lib({ c3: { required: [[NEED, NONE]] } });
    const s = state({
      proposed: [proposed('new:1', 'GC 4xxx')], courseEdits: { 'new:1': { objectives: [], required: [], developed: [add(SUP, 'syllabus')] } },
      links: [{ from: 'new:1', to: 'GC 4400' }],
    }, ['GC 1010', 'GC 2070', 'GC 4400', 'new:1']);
    const r = run(l, s, { [`${hash(NEED)}|${hash(SUP)}`]: j(0.9, 0.9) }).required['GC 4400']![0]!;
    expect(r.proposed).toEqual(['GC 4xxx drafted from syllabus']);
    expect(label(r, s)).toBe('Met: proposed (GC 4xxx drafted from syllabus)');
  });

  it('proposed label lists two sources joined by "; "', () => {
    const s = state({
      objectives: [{ id: 'o1', text: COBJ }],
      proposed: [proposed('new:2', 'GC 4yyy')],
      courseEdits: {
        'GC 2070': { objectives: [], required: [], developed: [add(A, 'faculty')] },
        'new:2': { objectives: [], required: [], developed: [add(B, 'faculty')] },
      },
    }, ['GC 1010', 'GC 2070', 'GC 4400', 'new:2']);
    const r = run(lib(), s, setJudgments(), verdict(0.7)).cluster[0]!;
    expect(r.status).toBe('met_set');
    expect(r.proposed).toEqual(['edited skill in GC 2070', 'new course GC 4yyy']);
    expect(label(r, s)).toBe('Met by a set: proposed (edited skill in GC 2070; new course GC 4yyy)');
  });

  it('stale override is shown and not applied', () => {
    const over = (text: string) => ({ targetKey: 'cobj:o1', textHash: hash(text), label: 'met' as const, by: 'X', at: 'now', reason: null });
    const stale = state({ objectives: [{ id: 'o1', text: COBJ }], overrides: [over('Old wording')] });
    const r = run(setLib(), stale, setJudgments(), verdict(0.2)).cluster[0]!;
    expect(r).toMatchObject({ status: 'parts_met', staleOverride: true, override: { label: 'met' } });
    const fresh = state({ objectives: [{ id: 'o1', text: COBJ }], overrides: [over(COBJ)] });
    expect(run(setLib(), fresh, setJudgments(), verdict(0.2)).cluster[0]).toMatchObject({ status: 'met', staleOverride: false, override: { label: 'met' } });
    // A course objective edited after its override: the override is found under the old wording and shown stale.
    const l = lib({ c2: { skills: [OWN], objectives: [OBJ] } });
    const edited = state({
      courseEdits: { 'GC 2070': { objectives: [{ id: 'e1', by: 'X', at: 'now', action: 'edit', target: OBJ, text: 'Plan a long print run', bloom: null }], required: [], developed: [] } },
      overrides: [{ targetKey: `obj:GC 2070|${hash(OBJ)}`, textHash: hash(OBJ), label: 'met', by: 'X', at: 'now', reason: null }],
    });
    const o = run(l, edited, { [`${hash('Plan a long print run')}|${hash(OWN)}`]: j(0.1, 0.01) }).objectives['GC 2070']![0]!;
    expect(o).toMatchObject({ status: 'not', staleOverride: true, override: { label: 'met' }, proposed: ['edited skill in GC 2070'] });
  });

  it('a required skill edited after its override shows the override stale, not applied', () => {
    const NEW = 'Read and check a job ticket';
    const l = lib({ c1: { skills: [SUP] }, c3: { required: [[NEED, NONE]] } });
    const s = state({
      courseEdits: { 'GC 4400': { objectives: [], required: [{ id: 'e1', by: 'X', at: 'now', action: 'edit', target: hash(NEED), statement: NEW, levels: null }], developed: [] } },
      overrides: [{ targetKey: `req:GC 4400|${hash(NEED)}`, textHash: hash(NEED), label: 'met', by: 'X', at: 'now', reason: null }],
    });
    const r = run(l, s, { [`${hash(NEW)}|${hash(SUP)}`]: j(0.01, 0.01) }).required['GC 4400']![0]!;
    expect(r).toMatchObject({ targetKey: `req:GC 4400|${hash(NEW)}`, status: 'not', staleOverride: true, override: { label: 'met' } });
  });

  it('override on a removed course is ignored', () => {
    const removed = course('GC 4800', { skills: [OWN], objectives: [OBJ], required: [[NEED, NONE]] });
    const l = lib({ c2: { skills: [OWN], objectives: [OBJ] }, extra: [removed] });
    const s = state({
      overrides: [
        { targetKey: `obj:GC 4800|${hash(OBJ)}`, textHash: hash(OBJ), label: 'met', by: 'X', at: 'now', reason: null },
        { targetKey: `req:GC 4800|${hash(NEED)}`, textHash: hash(NEED), label: 'met', by: 'X', at: 'now', reason: null },
      ],
    });
    const out = run(l, s, { [`${hash(OBJ)}|${hash(OWN)}`]: j(0.01, 0.01) });
    expect(out.objectives['GC 4800']).toBeUndefined();
    expect(out.required['GC 4800']).toBeUndefined();
    expect(out.objectives['GC 2070']![0]).toMatchObject({ status: 'not', override: null, staleOverride: false });
  });

  it('a set whose member\'s course left the cluster is asked again, not shown', () => {
    const s = state({ objectives: [{ id: 'o1', text: COBJ }] }, ['GC 1010', 'GC 2070']);
    const r = run(setLib(), s, setJudgments(), verdict(0.7)).cluster[0]!;
    expect(r.status).toBe('pending');
    expect(r.suppliers).toEqual([]);
    // A drawn arrow from a course no longer on the cluster supplies nothing.
    const l = lib({ c3: { required: [[NEED, NONE]] }, extra: [course('GC 4800', { skills: [SUP] })] });
    const s2 = state({ links: [{ from: 'GC 4800', to: 'GC 1010' }] }, ['GC 1010']);
    expect(run(l, s2, { [`${hash(NEED)}|${hash(SUP)}`]: j(0.9, 0.9) }).required['GC 1010']).toEqual([]);
    const s3 = state({ links: [{ from: 'GC 4800', to: 'GC 4400' }] }, ['GC 4400']);
    expect(run(l, s3, { [`${hash(NEED)}|${hash(SUP)}`]: j(0.9, 0.9) }).required['GC 4400']![0]).toMatchObject({ status: 'not', reason: 'no upstream courses' });
  });

  it('need levels do not change a status', () => {
    const l = lib({ c1: { skills: [SUP], level: 1 }, c3: { required: [[NEED, { k: 5, u: 5, d: 5 }]] } });
    expect(run(l, state(), { [`${hash(NEED)}|${hash(SUP)}`]: j(0.9, 0.9) }).required['GC 4400']![0]!.status).toBe('met');
  });
});
