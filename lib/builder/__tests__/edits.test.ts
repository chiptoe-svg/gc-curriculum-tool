import { describe, it, expect } from 'vitest';
import { textHash } from '@/lib/catalog/bundles';
import { normalizeStatement } from '@/lib/catalog/project-trail';
import { parsePlanState } from '../plan-schema';
import { planEdges } from '../compute';
import { effectiveCourse, changeCount } from '../edits';
import { proposeBloom } from '../bloom';
import { EMPTY_PLAN, type CourseEdits, type Library, type LibraryCourse, type LibraryVersion } from '../types';

const hash = (s: string) => textHash(normalizeStatement(s));
const none = { k: null, u: null, d: null };
const base = { by: 'Dr X', at: '2026-11-16T00:00:00.000Z' };
const version: LibraryVersion = {
  snapshotId: 's', instructorName: null, createdAt: '2026-01-01T00:00:00.000Z', depths: [], outcomes: [], disagreements: [], projects: [],
  conditions: null, unmapped: [], suggestions: [], linked: false,
  skills: [{ skillRef: hash('Mix ink'), statement: 'Mix ink', k: 2, u: 2, d: 3 }],
  required: [{ ref: hash('Read a spec'), statement: 'Read a spec', need: { k: 2, u: null, d: 2 } }],
};
const lc = { code: 'GC 1', objectives: ['Identify press parts'] } as LibraryCourse;
const empty: CourseEdits = { objectives: [], required: [], developed: [] };

describe('map course edits', () => {
  it('a plan without courseEdits parses and loads unchanged', () => {
    const parsed = parsePlanState(EMPTY_PLAN);
    expect(parsed).toEqual(EMPTY_PLAN);
    expect(parsed!.courseEdits).toBeUndefined();
    const eff = effectiveCourse(lc, version, undefined);
    expect(eff.required.map(r => r.draft)).toEqual([false]);
    expect(eff.developed.map(r => r.draft)).toEqual([false]);
    expect(eff.objectives).toEqual([{ text: 'Identify press parts', bloom: 'Remember', draft: false }]);
  });

  it('an edited required skill gets a new ref and draft: true', () => {
    const e: CourseEdits = { ...empty, required: [{ ...base, id: 'e1', action: 'edit', target: hash('Read a spec'), statement: 'Read a job ticket', levels: null }] };
    const [r] = effectiveCourse(lc, version, e).required;
    expect(r!.ref).toBe(hash('Read a job ticket'));
    expect(r!.ref).not.toBe(hash('Read a spec'));
    expect(r!.draft).toBe(true);
    expect(r!.need).toEqual({ k: 2, u: null, d: 2 });
  });

  it('remove drops a captured developed skill', () => {
    const e: CourseEdits = { ...empty, developed: [{ ...base, id: 'e2', action: 'remove', target: hash('Mix ink'), statement: null, levels: null }] };
    expect(effectiveCourse(lc, version, e).developed).toEqual([]);
    expect(changeCount(e, [], [], 'GC 1')).toBe(1);
  });

  it('a coreq link becomes a concurrent_ok plan edge', () => {
    const lib = { prereqs: [] } as unknown as Library;
    const edges = planEdges(lib, { ...EMPTY_PLAN, links: [{ from: 'A', to: 'B', kind: 'coreq' }, { from: 'C', to: 'D' }] });
    expect(edges.map(x => [x.from, x.kind, x.source])).toEqual([['A', 'concurrent_ok', 'plan'], ['C', 'prereq', 'plan']]);
    expect(parsePlanState({ ...EMPTY_PLAN, links: [{ from: 'A', to: 'B', kind: 'coreq' }] })).not.toBeNull();
    expect(none).toBeDefined();
  });

  it('proposes a Bloom process from the leading verb, and only then', () => {
    expect(proposeBloom('Design a package')).toBe('Create');
    expect(proposeBloom('Students will be able to troubleshoot a press')).toBe('Analyze');
    expect(proposeBloom('Students will be great')).toBeNull();
  });
});
