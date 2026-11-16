import { describe, it, expect } from 'vitest';
import { textHash } from '@/lib/catalog/bundles';
import { normalizeStatement } from '@/lib/catalog/project-trail';
import { effectiveCourse } from '../edits';
import { removeObjective, removeSkill, saveObjective, saveSkill, withEdits } from '../edit-ops';
import { EMPTY_PLAN, type LibraryCourse, type LibraryVersion } from '../types';

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
