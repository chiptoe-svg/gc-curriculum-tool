import { describe, it, expect } from 'vitest';
import { textHash } from '@/lib/catalog/bundles';
import { normalizeStatement } from '@/lib/catalog/project-trail';
import { effectiveCourse } from '../edits';
import { mergeSyllabusDraft, removeObjective, removeSkill, saveObjective, saveSkill, withEdits } from '../edit-ops';
import { EMPTY_PLAN, type CourseEdits, type LibraryCourse, type LibraryVersion, type PlanState } from '../types';

const hash = (s: string) => textHash(normalizeStatement(s));
let n = 0;
const stamp = () => ({ id: `e${n++}`, by: 'Dr X', at: '2026-11-16T00:00:00.000Z' });
const lv = { k: 2, u: null, d: 2 };
const version: LibraryVersion = {
  snapshotId: 's', instructorName: null, createdAt: '2026-01-01T00:00:00.000Z', depths: [], outcomes: [], disagreements: [], projects: [],
  conditions: null, unmapped: [], suggestions: [], linked: false,
  skills: [{ skillRef: hash('Mix ink'), statement: 'Mix ink', k: 2, u: 2, d: 3 }],
  required: [{ ref: hash('Read a spec'), statement: 'Read a spec', need: { k: 2, u: null, d: 2 } }],
};
const lc = { code: 'GC 1', objectives: ['Identify press parts'] } as LibraryCourse;
const req = (list: ReturnType<typeof saveSkill>) => effectiveCourse(lc, version, { objectives: [], developed: [], required: list }).required;

describe('map edit operations', () => {
  it('editing an edited captured skill replaces the first edit (one edit per target)', () => {
    const orig = req([])[0]!;
    let list = saveSkill([], orig, 'Read a job ticket', lv, stamp());
    const edited = req(list)[0]!;
    expect(edited.draft).toBe(true);
    list = saveSkill(list, edited, 'Read a job ticket and spec', lv, stamp());
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ action: 'edit', target: orig.ref, statement: 'Read a job ticket and spec' });
    expect(req(list).map(r => r.statement)).toEqual(['Read a job ticket and spec']);
  });

  it('editing an added skill rewrites the add; removing it deletes the add', () => {
    let list = saveSkill([], null, 'Trap a file', lv, stamp());
    const added = req(list).find(r => r.draft)!;
    list = saveSkill(list, added, 'Trap a PDF', lv, stamp());
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ action: 'add', target: null, statement: 'Trap a PDF' });
    list = removeSkill(list, req(list).find(r => r.draft)!, stamp());
    expect(list).toEqual([]);
  });

  it('removing an edited captured skill records one remove of the original', () => {
    const orig = req([])[0]!;
    let list = saveSkill([], orig, 'Read a job ticket', lv, stamp());
    list = removeSkill(list, req(list)[0]!, stamp());
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ action: 'remove', target: orig.ref });
    expect(req(list)).toEqual([]);
  });

  it('objectives collapse the same way', () => {
    const obj = (list: ReturnType<typeof saveObjective>) => effectiveCourse(lc, version, { required: [], developed: [], objectives: list }).objectives;
    let list = saveObjective([], { text: 'Identify press parts', draft: false }, 'Name press parts', 'Remember', stamp());
    list = saveObjective(list, obj(list)[0]!, 'Diagnose press faults', 'Analyze', stamp());
    expect(list).toHaveLength(1);
    expect(obj(list)).toEqual([{ text: 'Diagnose press faults', bloom: 'Analyze', draft: true }]);
    list = saveObjective(list, null, 'Plan a run', 'Create', stamp());
    list = removeObjective(list, obj(list)[1]!, stamp());
    expect(list).toHaveLength(1);
  });

  it('a course left with no edits is dropped from courseEdits', () => {
    const p1 = withEdits(EMPTY_PLAN, 'GC 1', e => ({ ...e, required: saveSkill(e.required, null, 'Trap a file', lv, stamp()) }));
    expect(Object.keys(p1.courseEdits!)).toEqual(['GC 1']);
    const p2 = withEdits(p1, 'GC 1', e => ({ ...e, required: [] }));
    expect(p2.courseEdits).toEqual({});
  });
});

describe('mergeSyllabusDraft', () => {
  const src = { kind: 'syllabus' as const, draftId: 'd1', fileName: 'syl.pdf', at: '2026-11-16T15:00:00.000Z' };
  const add = { by: 'Ada', at: src.at, origin: 'syllabus' as const, action: 'add' as const, target: null };
  const drafted: CourseEdits = {
    objectives: [{ ...add, id: 'o1', text: 'Explain halftones', bloom: 'Understand' }],
    required: [{ ...add, id: 'r1', statement: 'Use Illustrator', levels: { k: 2, u: null, d: 2 } }],
    developed: [{ ...add, id: 'd1', statement: 'Prepare a PDF', levels: { k: 2, u: 1, d: 2 }, conditionMissing: true },
      { ...add, id: 'd2', statement: 'Mix ink', levels: { k: 1, u: 1, d: 1 } }],
    source: src,
  };
  const base: PlanState = { ...EMPTY_PLAN, links: [{ from: 'GC 1', to: 'X' }] };
  it('appends every drafted item as an add with its origin, and records the source', () => {
    const p = mergeSyllabusDraft(base, 'X', { edits: drafted, links: [] }, { objectives: [], required: [], developed: [] }, []);
    const e = p.courseEdits!.X!;
    expect(e.source).toEqual(src);
    expect([...e.objectives, ...e.required, ...e.developed].every(x => x.action === 'add' && x.origin === 'syllabus')).toBe(true);
    expect(e.developed[0]!.conditionMissing).toBe(true);
  });
  it('skips an item the course already shows, and keeps edits already made', () => {
    const before = withEdits(base, 'X', e => ({ ...e, objectives: [{ id: 'f', by: 'Bo', at: src.at, action: 'add', target: null, text: 'Old', bloom: null }] }));
    const p = mergeSyllabusDraft(before, 'X', { edits: drafted, links: [] }, { objectives: ['Old'], required: [], developed: ['mix ink.'] }, []);
    expect(p.courseEdits!.X!.objectives.map(o => o.text)).toEqual(['Old', 'Explain halftones']);
    expect(p.courseEdits!.X!.developed.map(d => d.statement)).toEqual(['Prepare a PDF']);
  });
  it('adds links the plan and the catalog do not already have', () => {
    const links = [{ from: 'GC 1', to: 'X' }, { from: 'GC 2', to: 'X', kind: 'coreq' as const }, { from: 'GC 3', to: 'X' }, { from: 'X', to: 'X' }];
    const p = mergeSyllabusDraft(base, 'X', { edits: drafted, links }, { objectives: [], required: [], developed: [] }, [{ from: 'GC 3', to: 'X' }]);
    expect(p.links).toEqual([{ from: 'GC 1', to: 'X' }, { from: 'GC 2', to: 'X', kind: 'coreq' }]);
  });
});
