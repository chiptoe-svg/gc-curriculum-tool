// Problem solving as it emerges by the end of each act, for the curriculum builder. Problem solving is a program-level outcome,
// never a 0–5 score per course (spec 2026-10-19 §2.6; docs/problem-solving-deep-dive.html): it is read from the
// conditions course capture records (Audit Area 7) and from where students reach integration depth. This
// reports both, cumulatively, for the courses on the plan up to the end of each act (owner, 2026-11-15:
// emergent at the end of Acts 1, 2 and 3). Pure.
import { problemSolvingBand, type ProblemSolvingBand } from '@/lib/program/problem-solving-band';
import { versionOf, type ObjectiveResult, type PlacedCourse } from './compute';
import type { Library, PlanState } from './types';

export const CONDITIONS = [
  { key: 'generate_then_consolidate', name: 'Generate, then consolidate' },
  { key: 'open_ended_problems', name: 'Open-ended problems' },
  { key: 'revision_cycles', name: 'Revision cycles' },
  { key: 'structured_post_mortem', name: 'Structured post-mortem' },
  { key: 'abstraction_bridging', name: 'Abstraction bridging' },
] as const;
export type ConditionKey = (typeof CONDITIONS)[number]['key'];

export interface ProblemSolvingResult {
  /** Courses on the plan (in view) by their evidence band; 'no_data' = no conditions recorded for the version in use. */
  bands: Record<ProblemSolvingBand | 'no_data', string[]>;
  /** For each condition, the courses where it is present, and where it is partial. */
  conditions: Record<ConditionKey, { present: string[]; partial: string[] }>;
  /** Plan competencies worked at integration depth (Understand or Do of 4 or more) by the end of the act. */
  integration: Array<{ id: string; name: string }>;
}

/** One result per act: the courses up to the end of that act, and the depth reached by then. */
export function problemSolvingByAct(lib: Library, plan: PlanState, courses: readonly PlacedCourse[], objectives: readonly ObjectiveResult[]): [ProblemSolvingResult, ProblemSolvingResult, ProblemSolvingResult] {
  return ([1, 2, 3] as const).map(act => {
    const bands: ProblemSolvingResult['bands'] = { significant: [], moderate: [], slight: [], none: [], no_data: [] };
    const conditions = Object.fromEntries(CONDITIONS.map(c => [c.key, { present: [] as string[], partial: [] as string[] }])) as ProblemSolvingResult['conditions'];
    for (const c of courses) {
      if (c.requirement || c.act > act) continue;
      const lc = lib.courses.find(x => x.code === c.ref);
      const block = lc ? versionOf(lc, plan)?.conditions ?? null : null;
      if (!block) { bands.no_data.push(c.code); continue; }
      bands[problemSolvingBand(block).band].push(c.code);
      for (const { key } of CONDITIONS) {
        if (block[key] === 'present') conditions[key].present.push(c.code);
        else if (block[key] === 'partial') conditions[key].partial.push(c.code);
      }
    }
    const integration = objectives
      .filter(o => (o.byAct[act - 1]!.u ?? 0) >= 4 || (o.byAct[act - 1]!.d ?? 0) >= 4)
      .map(o => ({ id: o.competency.id, name: o.competency.name }));
    return { bands, conditions, integration };
  }) as [ProblemSolvingResult, ProblemSolvingResult, ProblemSolvingResult];
}
