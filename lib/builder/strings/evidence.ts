import type { Library } from '../types';

/** What a course's newest capture holds as evidence for its skills: the project titles and outcome statements. Course-wide, not per skill. */
export function courseEvidence(lib: Library, courseCode: string): string[] {
  const v = lib.courses.find((c) => c.code === courseCode)?.versions[0];
  return v ? [...v.projects.map((p) => p.title), ...v.outcomes.map((o) => o.statement)] : [];
}
