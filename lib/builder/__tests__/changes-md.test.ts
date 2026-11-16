import { describe, it, expect } from 'vitest';
import { textHash } from '@/lib/catalog/bundles';
import { normalizeStatement } from '@/lib/catalog/project-trail';
import { CUTOFFS, MODEL_IN_USE } from '@/lib/ai/match-judge';
import { placeCourses } from '../compute';
import { requiredByCourse } from '../threads';
import { draftPairs, esc, renderChangesMarkdown } from '../changes-md';
import { EMPTY_PLAN, type Candidate, type CourseEdits, type Library, type LibraryCourse, type MatchDecision, type PlanState } from '../types';

const hash = (s: string) => textHash(normalizeStatement(s));
const NEED = 'Read a job ticket';
const SUP = 'Mix ink';
const course = (code: string, title: string, objectives: string[], skills: string[], required: string[]): LibraryCourse => ({
  code, title, level: 1, category: 'gc_core', track: 'Core', description: '', credits: null, wiki: null,
  objectives, sheetProjects: [], stated: [], whatIfs: [],
  versions: [{
    snapshotId: code, instructorName: null, createdAt: '2026-01-01T00:00:00.000Z', depths: [], outcomes: [], disagreements: [],
    projects: [], conditions: null, unmapped: [], suggestions: [], linked: false,
    skills: skills.map(s => ({ skillRef: hash(s), statement: s, k: 3, u: 3, d: 3 })),
    required: required.map(s => ({ ref: hash(s), statement: s, need: { k: null, u: null, d: 3 } })),
  }],
});
const cand: Candidate = { requiredRef: hash(NEED), suppliedRef: hash(SUP), suppliedCourse: 'GC 1', suppliedStatement: SUP, similarity: 0.8, pFully: CUTOFFS[MODEL_IN_USE].fully + 0.05, pPartly: null };
const lib: Library = {
  courses: [course('GC 1', 'Intro', ['Identify press parts'], [SUP], []), course('GC 2', 'Prepress', [], [], [NEED]), course('GC 3', 'Color', [], [], [])],
  competencies: [], targets: [], prereqs: [{ courseCode: 'GC 3', prereqCode: 'GC 1', kind: 'prereq', anyOfGroup: null }],
  candidates: { [`GC 2|${hash(NEED)}`]: [cand] }, decisions: {},
};
const place = (extra: Partial<PlanState> = {}): PlanState => ({
  ...EMPTY_PLAN, fade: 0, ...extra,
  placements: [{ ref: 'GC 1', act: 1, branch: null, slot: 0, x: 0 }, { ref: 'GC 2', act: 1, branch: null, slot: 2, x: 0 }, { ref: 'GC 3', act: 1, branch: null, slot: 1, x: 100 }],
});
const render = (plan: PlanState, decisions: MatchDecision[] = []) => renderChangesMarkdown({
  planName: 'Core plan', catalogYear: '2026-2027', exportedBy: 'Dr Ruiz', date: '2026-11-16', lib, plan,
  required: requiredByCourse(lib, plan, placeCourses(lib, plan), {}, Object.fromEntries(decisions.map(d => [`${d.requiredRef}|${d.suppliedRef}`, d]))), decisions,
});
const edit = { id: 'e', by: 'Dr Ruiz', at: '2026-11-16T10:00:00.000Z' };
const none: CourseEdits = { objectives: [], required: [], developed: [] };

describe('renderChangesMarkdown', () => {
  it('an unchanged plan says "No changes"', () => {
    const md = render(place());
    expect(md).toContain('# Core plan — changes (2026-11-16)');
    expect(md).toContain('No changes');
    expect(md).not.toContain('## GC');
    expect(md).toContain('1 met');
  });

  it('an edited objective shows before → after with its Bloom process', () => {
    const md = render(place({ courseEdits: { 'GC 1': { ...none, objectives: [{ ...edit, action: 'edit', target: 'Identify press parts', text: 'Explain press parts', bloom: 'Understand' }] } } }));
    expect(md).toContain('## GC 1 Intro');
    expect(md).toContain('- Changed: Identify press parts → Explain press parts* [Understand] (Dr Ruiz, 2026-11-16)');
    expect(md).toContain('## To confirm through capture');
    expect(md).toContain('- GC 1, objective: Explain press parts');
  });

  it('stamps a change with its New York date, not the UTC one', () => {
    const late = { ...edit, at: '2026-11-17T02:30:00.000Z' }; // 9:30 pm on Nov 16 in Clemson
    const md = render(place({ courseEdits: { 'GC 1': { ...none, objectives: [{ ...late, action: 'add', target: null, text: 'Explain press parts', bloom: 'Understand' }] } } }));
    expect(md).toContain('(Dr Ruiz, 2026-11-16)');
    expect(md).not.toContain('2026-11-17');
  });

  it('a course drafted from a syllabus says so in its heading, from its edits\' source', () => {
    const source = { kind: 'syllabus' as const, draftId: 'd1', fileName: 'gc2.pdf', at: '2026-11-17T02:30:00.000Z' };
    const md = render(place({ courseEdits: { 'GC 2': { ...none, source, objectives: [{ ...edit, origin: 'syllabus', action: 'add', target: null, text: 'Read a ticket', bloom: 'Understand' }] } } }));
    expect(md).toContain('## GC 2 Prepress (drafted from syllabus: gc2.pdf, 2026-11-16)');
  });

  it('a coreq added appears under Prerequisites and corequisites', () => {
    const md = render(place({ links: [{ from: 'GC 1', to: 'GC 2', kind: 'coreq' }], unlinked: [{ from: 'GC 1', to: 'GC 3' }] }));
    const sec = md.split('## GC 2')[1]!.split('### Prerequisites and corequisites')[1]!;
    expect(sec).toContain('- Added corequisite: GC 1');
    expect(md.split('## GC 3')[1]).toContain('- Removed prerequisite: GC 1 (set aside from the catalog)');
  });

  it('shows required-skill status, supplier and decisions', () => {
    const plan = place({ courseEdits: { 'GC 2': { ...none, required: [{ ...edit, action: 'edit', target: hash(NEED), statement: NEED + ' fast', levels: { k: null, u: null, d: 3 } }] } } });
    const d: MatchDecision = { requiredRef: hash(NEED + ' fast'), suppliedRef: hash(SUP), label: 'fully', by: 'Dr Lee', at: '2026-11-15T09:00:00Z', draft: true };
    const md = render(plan, [d]);
    expect(md).toContain(`- Changed: ${NEED} (K– U– D3) → ${NEED} fast (K– U– D3)* (Dr Ruiz, 2026-11-16) — Met*, from GC 1: "${SUP}"`);
    expect(md).toContain(`- Accepted fully: "${NEED} fast" ← GC 1: "${SUP}" (Dr Lee, 2026-11-15)`);
  });

  it('escapes Markdown in user text so a statement cannot break the layout', () => {
    expect(esc('a *b* _c_ `d` [e](f) <g>\nh')).toBe('a \\*b\\* \\_c\\_ \\`d\\` \\[e\\](f) \\<g\\> h');
    const plan = place({ courseEdits: { 'GC 1': { ...none, developed: [{ ...edit, action: 'add', target: null, statement: '# Heading *bold* [x](y)', levels: { k: 1, u: null, d: 2 } }] } } });
    const md = render(plan);
    expect(md).toContain('- Added: # Heading \\*bold\\* \\[x\\](y) (K1 U– D2)* (Dr Ruiz, 2026-11-16)');
  });

  it('a levels-only required edit still shows its status', () => {
    const plan = place({ courseEdits: { 'GC 2': { ...none, required: [{ ...edit, action: 'edit', target: hash(NEED), statement: null, levels: { k: null, u: null, d: 2 } }] } } });
    expect(render(plan)).toMatch(/Changed: .*— Met, from GC 1/);
  });
});

describe('draftPairs', () => {
  it('a draft required skill against a captured supplier yields the text-hash key', () => {
    const plan = place({ courseEdits: { 'GC 2': { ...none, required: [{ ...edit, action: 'add', target: null, statement: 'Proof a job', levels: null }] } } });
    expect(draftPairs(lib, plan)).toEqual([{ requiredHash: hash('Proof a job'), suppliedHash: hash(SUP) }]);
  });
  it('captured-only pairs are not listed', () => {
    expect(draftPairs(lib, place())).toEqual([]);
  });
});
