import { describe, expect, it } from 'vitest';
import { computePlan, placeCourses } from '../compute';
import { problemSolvingByAct } from '../problem-solving';
import { EMPTY_PLAN, type Library, type LibraryCourse } from '../types';

const course = (code: string, conditions: LibraryCourse['versions'][number]['conditions'], d = 2): LibraryCourse => ({
  code, title: code, level: 1, category: 'gc_core', track: 'Core', description: '', credits: '3', wiki: null, objectives: [], sheetProjects: [], stated: [], whatIfs: [],
  versions: [{ snapshotId: code, instructorName: null, createdAt: '2026-01-01T00:00:00.000Z', outcomes: [], disagreements: [], projects: [], conditions, skills: [], required: [], unmapped: [], suggestions: [], linked: false,
    depths: [{ competencyId: 'color', k: 2, u: 2, d }] }],
});
const lib: Library = {
  courses: [
    course('A', { open_ended_problems: 'present', revision_cycles: 'partial' }),
    course('B', null),
    course('C', { generate_then_consolidate: 'present', open_ended_problems: 'present', revision_cycles: 'present', structured_post_mortem: 'present', abstraction_bridging: 'partial' }, 4),
  ],
  competencies: [{ id: 'color', name: 'Color', foundational: false, stratum: 'technical', neighbors: [], know: 'k', understand: 'u', do: 'd' }],
  targets: [], prereqs: [],
} as unknown as Library;

describe('problem solving by act', () => {
  const plan = { ...EMPTY_PLAN, placements: [{ ref: 'A', act: 1 as const, branch: null }, { ref: 'B', act: 2 as const, branch: null }, { ref: 'C', act: 3 as const, branch: null }] };
  const r = computePlan(lib, plan);
  const ps = problemSolvingByAct(lib, plan, placeCourses(lib, plan), r.objectives);
  it('counts courses up to the end of each act, cumulatively', () => {
    expect(ps[0].bands.slight).toEqual(['A']);            // 2 + 1 = 3: slight
    expect(ps[1].bands.no_data).toEqual(['B']);           // no conditions recorded
    expect(ps[2].bands.significant).toEqual(['C']);       // 4 x 2 + 1 = 9
    expect(ps[2].conditions.open_ended_problems.present).toEqual(['A', 'C']);
    expect(ps[0].conditions.open_ended_problems.present).toEqual(['A']);
  });
  it('lists competencies at integration depth (U or D of 4+) by each act', () => {
    expect(ps[1].integration).toEqual([]);
    expect(ps[2].integration.map(c => c.id)).toEqual(['color']);
  });
});
