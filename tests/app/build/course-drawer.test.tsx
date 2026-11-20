// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { CourseDrawer } from '@/app/build/[id]/CourseDrawer';
import { computePlan, placeCourses } from '@/lib/builder/compute';
import { requiredByCourse } from '@/lib/builder/threads';
import { EMPTY_PLAN, type Library, type PlanState } from '@/lib/builder/types';
import type { Tree } from '@/lib/skill-tree/types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const library: Library = {
  courses: [{
    code: 'GC 3400', title: 'Color science', level: 3, category: 'gc_core', track: 'Core', description: '', credits: '3', wiki: null,
    objectives: [], sheetProjects: [], stated: [], whatIfs: [],
    versions: [{
      snapshotId: 's1', instructorName: 'Dr Who', createdAt: '2026-01-15T12:00:00.000Z',
      depths: [{ competencyId: 'color', k: 4, u: 3, d: 2 }], outcomes: [], disagreements: [], projects: [], conditions: null,
      unmapped: [], suggestions: [], linked: false, required: [],
      skills: [
        { skillRef: 'a', statement: 'Build a profile', k: 2, u: 1, d: 3 },
        { skillRef: 'b', statement: 'Calibrate a press', k: 4, u: 2, d: 3 },
      ],
    }],
  }],
  competencies: [{ id: 'color', name: 'Color management', foundational: false, stratum: 'technical', neighbors: [], know: null, understand: null, do: 'x' }],
  targets: [], prereqs: [], decisions: {}, candidates: {},
};
const node = (id: string, name: string, parentId: string | null, over: object = {}) => ({
  id, name, description: null, parentId, competencyId: parentId ? null : id, foundational: false, weight: 1,
  weightSource: 'default' as const, mergedInto: null, retired: false, ...over,
});
const tree: Tree = {
  nodes: [node('color', 'Color management', null), node('icc', 'ICC profile building', 'color')],
  leaves: [
    { courseCode: 'GC 3400', skillRef: 'a', nodeId: 'icc', statement: 'Build a profile', share: null, source: 'faculty', status: 'confirmed' },
    { courseCode: 'GC 3400', skillRef: 'b', nodeId: 'color', statement: 'Calibrate a press', share: null, source: 'faculty', status: 'confirmed' },
  ],
  depths: [],
};

function renderDrawer() {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ tree }) })));
  const plan: PlanState = { ...EMPTY_PLAN, placements: [{ ref: 'GC 3400', act: 1, branch: null, slot: 0, x: 0 }] };
  const result = computePlan(library, plan);
  const allCourses = placeCourses(library, plan);
  const threads = { byCourse: requiredByCourse(library, plan, allCourses, {}, {}), decisions: {}, judging: {}, unasked: new Set<string>(), retryJudge: () => {}, decide: async () => null, stamp: () => ({ id: 'e', by: 'T', at: 'now' }) };
  render(<CourseDrawer courseRef="GC 3400" library={library} plan={plan} result={result} allCourses={allCourses} slug="s" update={() => {}} onRemove={() => {}} onClose={() => {}} onSelect={() => {}} threads={threads as never} focus={null} />);
}

describe('CourseDrawer tree readings', () => {
  it('course drawer shows the tree number beside the scorer\'s level', async () => {
    renderDrawer();
    // Master reading: icc leaf (2,1,3) and a direct leaf (4,2,3), equal weight -> K3.0 U1.5 D3.0.
    await screen.findByText('Tree: K3.0 U1.5 D3.0');
    expect(screen.getAllByText('K4 U3 D2').length).toBeGreaterThan(0); // the scorer's level is unchanged
  });

  it('opens the same drill-down as the panel', async () => {
    renderDrawer();
    fireEvent.click(await screen.findByRole('button', { name: 'Tree: K3.0 U1.5 D3.0' }));
    await waitFor(() => expect(screen.getByText('ICC profile building')).toBeTruthy());
  });
});
