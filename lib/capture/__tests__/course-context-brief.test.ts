import { describe, it, expect, vi, beforeEach } from 'vitest';

const pairs = [
  { focal: 'GC 3460', prereq: 'GC 1040' },
  { focal: 'GC 4060', prereq: 'GC 3460' },
  { focal: 'GC 4400', prereq: 'GC 3460' },
];
vi.mock('@/lib/curriculum/sheet-prereq-graph', async (orig) => ({
  ...(await orig<typeof import('@/lib/curriculum/sheet-prereq-graph')>()),
  loadSheetPrereqPairs: vi.fn(async () => pairs),
}));
const courses: Record<string, { code: string; title: string; majorProjects: string[] }> = {
  'GC 1040': { code: 'GC 1040', title: 'Intro to Print', majorProjects: [] },
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
    : c === 'GC 1040' ? { profile: { incoming_expectations: [], major_projects: [] }, createdAt: new Date('2026-06-18T12:00:00Z') }
    : null);
  draft.mockReset().mockResolvedValue(null);
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
  it('lists prerequisites first with capture status', async () => {
    const md = renderCourseContextBrief(await buildCourseContextBrief('GC 3460'));
    expect(md).toContain('- GC 1040 — Intro to Print: captured (GC 1040 capture snapshot 2026-06-18)');
    expect(md.indexOf('### Students arrive from')).toBeLessThan(md.indexOf('### Courses that build on this one'));
    expect(md.indexOf('GC 4060 — Flexo')).toBeLessThan(md.indexOf('GC 4400 — Packaging'));
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
    expect(capped).toMatch(/_\(\d+ more line\(s\) left out to stay within the size cap\.\)_$/);
    expect(full).not.toContain('left out');
  });
  it('gives a course with no links a one-line note', async () => {
    const md = renderCourseContextBrief(await buildCourseContextBrief('GC 9000'));
    expect(md).toBe(`## ${BRIEF_HEADING}\nNo linked courses: the course sheet lists no prerequisites for GC 9000, and no course lists it as a prerequisite.`);
  });
});
