import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrereqMap } from '@/lib/curriculum/prereq-map';

const catalogMap: PrereqMap = {
  catalogYear: '2026-2027',
  catalogCourses: new Set(['GC 2070', 'GC 3460', 'GC 4060', 'GC 4400', 'GC 9000']),
  edges: [
    { focal: 'GC 3460', prereq: 'GC 2070', kind: 'prereq', source: 'catalog', anyOfGroup: null },
    { focal: 'GC 4060', prereq: 'GC 3460', kind: 'concurrent_ok', source: 'catalog', anyOfGroup: null },
    { focal: 'GC 4400', prereq: 'GC 3460', kind: 'concurrent_ok', source: 'catalog', anyOfGroup: null },
  ],
};
const mapState = vi.hoisted(() => ({ map: null as unknown }));
vi.mock('@/lib/curriculum/prereq-map', async (orig) => ({
  ...(await orig<typeof import('@/lib/curriculum/prereq-map')>()),
  loadPrereqMap: vi.fn(async () => mapState.map),
}));
const courses: Record<string, { code: string; title: string; majorProjects: string[] }> = {
  'GC 1040': { code: 'GC 1040', title: 'Intro to Print', majorProjects: [] },
  'GC 2070': { code: 'GC 2070', title: 'Graphic Communications II', majorProjects: [] },
  'GC 4500': { code: 'GC 4500', title: 'Capstone', majorProjects: [] },
  'GC 4900ap': { code: 'GC 4900ap', title: 'Alt Photo', majorProjects: [] },
  'GC 3460': { code: 'GC 3460', title: 'Flexography', majorProjects: [] },
  'GC 4060': { code: 'GC 4060', title: 'Flexo Production', majorProjects: ['Sheet project A'] },
  'GC 4400': { code: 'GC 4400', title: 'Packaging', majorProjects: ['Board carton build'] },
  'GC 9000': { code: 'GC 9000', title: 'Island', majorProjects: [] },
};
vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode: vi.fn(async (c: string) => courses[c] ?? null) }));
const snapshot = vi.fn();
const draft = vi.fn();
vi.mock('@/lib/db/capture-snapshots-queries', () => ({ getLatestSnapshotByCourse: (c: string) => snapshot(c) }));
vi.mock('@/lib/db/course-capture-profiles-queries', () => ({ getCaptureProfileByCourse: (c: string) => draft(c) }));

import { buildCourseContextBrief, renderCourseContextBrief, BRIEF_HEADING } from '@/lib/capture/course-context-brief';

const profile4060 = {
  incoming_expectations: [{ statement: 'Run a flexo press make-ready', expected_depth: { k: 2, u: null, d: 3 }, evidenced_by: ['x'], confidence: 'high' }],
  major_projects: [{ title: 'Film and board run', description: 'Students print a job on film and on board.', competencies: ['c'] }],
};

beforeEach(() => {
  snapshot.mockReset().mockImplementation(async (c: string) =>
    c === 'GC 4060' ? { profile: profile4060, createdAt: new Date('2026-08-14T12:00:00Z') }
    : c === 'GC 2070' ? { profile: { incoming_expectations: [], major_projects: [] }, createdAt: new Date('2026-06-18T12:00:00Z') }
    : null);
  draft.mockReset().mockResolvedValue(null);
  mapState.map = catalogMap;
});

describe('course-context brief', () => {
  it('shows a captured dependent\'s incoming expectations with a source label', async () => {
    const md = renderCourseContextBrief(await buildCourseContextBrief('GC 3460'));
    expect(md).toContain('#### GC 4060 — Flexo Production');
    expect(md).toContain('- Expects students to arrive with (GC 4060 capture snapshot 2026-08-14):');
    expect(md).toContain('  - Run a flexo press make-ready (expects K2 U– D3)');
    expect(md).toContain('- Major projects (GC 4060 capture snapshot 2026-08-14):');
    expect(md).toContain('  - Film and board run — Students print a job on film and on board.');
  });
  it('shows an uncaptured dependent as not yet captured, with sheet projects', async () => {
    const md = renderCourseContextBrief(await buildCourseContextBrief('GC 3460'));
    expect(md).toContain('#### GC 4400 — Packaging');
    expect(md).toContain('- Expects students to arrive with: not yet captured');
    expect(md).toContain('- Major projects (course sheet):\n  - Board carton build');
  });
  it('falls back to the draft profile, labelled as a draft', async () => {
    draft.mockImplementation(async (c: string) => c === 'GC 4400'
      ? { profile: { incoming_expectations: [{ statement: 'Score a dieline', expected_depth: { k: null, u: null, d: 2 }, evidenced_by: ['y'], confidence: 'low' }], major_projects: null }, reviewerStatus: 'ai_drafted' }
      : null);
    const md = renderCourseContextBrief(await buildCourseContextBrief('GC 3460'));
    expect(md).toContain('- Expects students to arrive with (GC 4400 capture draft (ai_drafted)):');
    expect(md).toContain('- Major projects (course sheet):\n  - Board carton build');
  });
  it('lists prerequisites first with capture status, relation and source', async () => {
    const md = renderCourseContextBrief(await buildCourseContextBrief('GC 3460'));
    expect(md).toContain('### Students arrive from (Clemson catalog 2026–27)');
    expect(md).toContain('- GC 2070 — Graphic Communications II [prerequisite; Clemson catalog 2026–27]: captured (GC 2070 capture snapshot 2026-06-18)');
    expect(md).not.toContain('GC 1040');
    expect(md.indexOf('### Students arrive from')).toBeLessThan(md.indexOf('### Courses that build on this one'));
    expect(md.indexOf('GC 4060 — Flexo')).toBeLessThan(md.indexOf('GC 4400 — Packaging'));
  });
  it('carries the captured profile on the prerequisite entry', async () => {
    const brief = await buildCourseContextBrief('GC 3460');
    expect(brief.prerequisites[0]!.profile).toEqual({ incoming_expectations: [], major_projects: [] });
  });
  it('labels a "before or alongside" (concurrent enrollment) link distinctly, on both sides', async () => {
    const md = renderCourseContextBrief(await buildCourseContextBrief('GC 3460'));
    expect(md).toContain('#### GC 4060 — Flexo Production [takes GC 3460 before or alongside (prerequisite or concurrent enrollment); Clemson catalog 2026–27]');
    const md4060 = renderCourseContextBrief(await buildCourseContextBrief('GC 4060'));
    expect(md4060).toContain('- GC 3460 — Flexography [before or alongside (prerequisite or concurrent enrollment); Clemson catalog 2026–27]: not yet captured');
  });
  it('names any-of alternatives', async () => {
    mapState.map = { ...catalogMap, edges: [
      { focal: 'GC 4500', prereq: 'GC 4060', kind: 'prereq', source: 'catalog', anyOfGroup: 1 },
      { focal: 'GC 4500', prereq: 'GC 4400', kind: 'prereq', source: 'catalog', anyOfGroup: 1 },
    ] };
    const md = renderCourseContextBrief(await buildCourseContextBrief('GC 4500'));
    expect(md).toContain('- GC 4060 — Flexo Production [prerequisite, or alternatively GC 4400; Clemson catalog 2026–27]');
  });
  it('labels course-sheet fallback links as such', async () => {
    mapState.map = { ...catalogMap, edges: [
      { focal: 'GC 4900ap', prereq: 'GC 3460', kind: 'prereq', source: 'sheet', anyOfGroup: null },
    ] };
    const md = renderCourseContextBrief(await buildCourseContextBrief('GC 4900ap'));
    expect(md).toContain('### Students arrive from (course sheet)');
    expect(md).toContain('- GC 3460 — Flexography [prerequisite; course sheet]: not yet captured');
    const md3460 = renderCourseContextBrief(await buildCourseContextBrief('GC 3460'));
    expect(md3460).toContain('#### GC 4900ap — Alt Photo [takes GC 3460 as a prerequisite; course sheet]');
  });
  it('starts with the never-evidence heading', async () => {
    const md = renderCourseContextBrief(await buildCourseContextBrief('GC 3460'));
    expect(md.split('\n')[0]).toBe(`## ${BRIEF_HEADING}`);
    expect(BRIEF_HEADING).toBe("Neighboring courses — context for better questions, never evidence for this course's scores.");
  });
  it('trims beyond the size cap and reports what was left out', async () => {
    const brief = await buildCourseContextBrief('GC 3460');
    const full = renderCourseContextBrief(brief);
    const capped = renderCourseContextBrief(brief, 300);
    expect(capped.length).toBeLessThanOrEqual(300);
    expect(capped).toMatch(/_\(\d+ more line\(s\) left out to stay within the size cap(; courses not shown: [^)]+)?\.\)_$/);
    expect(full).not.toContain('left out');
  });
  it('names a fully-dropped dependent course in the size-cap note', async () => {
    const brief = await buildCourseContextBrief('GC 3460');
    const full = renderCourseContextBrief(brief);
    const idx4060 = full.indexOf('#### GC 4060 — Flexo Production');
    const idx4400 = full.indexOf('#### GC 4400 — Packaging');
    expect(idx4060).toBeGreaterThan(-1);
    expect(idx4400).toBeGreaterThan(idx4060);
    // Search upward for the smallest cap that keeps GC 4060's header but
    // cuts before GC 4400's header ever gets emitted.
    let maxChars = idx4400;
    let capped = renderCourseContextBrief(brief, maxChars);
    while (!capped.includes('#### GC 4060 — Flexo Production') && maxChars < full.length) {
      maxChars += 5;
      capped = renderCourseContextBrief(brief, maxChars);
    }
    expect(capped).toContain('#### GC 4060 — Flexo Production');
    expect(capped).not.toContain('#### GC 4400');
    expect(capped).toMatch(/courses not shown: GC 4400\.\)_$/);
    expect(capped.length).toBeLessThanOrEqual(maxChars);
  });
  it('gives a course with no links a one-line note', async () => {
    const md = renderCourseContextBrief(await buildCourseContextBrief('GC 9000'));
    expect(md).toBe(`## ${BRIEF_HEADING}\nNo linked courses: the Clemson catalog 2026–27 lists no course prerequisites for GC 9000, and no course lists it as a prerequisite.`);
  });
});
