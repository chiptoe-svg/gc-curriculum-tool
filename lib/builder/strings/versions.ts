/** Course captures as the skill tree reads them (client-safe). */
import type { Library } from '../types';
import type { VersionSkills } from '@/lib/skill-tree/types';

/** What a requires stop that names a tree skill reads: each of the course's newest captures, one per instructor. */
export function versionsOfCourse(lib: Pick<Library, 'courses'>, code: string): VersionSkills[] {
  const c = lib.courses.find((x) => x.code === code);
  return (c?.versions ?? []).map((v) => ({
    courseCode: code, instructor: v.instructorName ?? '',
    skills: new Map(v.skills.map((s) => [s.skillRef, { k: s.k, u: s.u, d: s.d }])),
  }));
}

/** The same, as plain data a server page can hand to the browser. */
export type VersionsData = Record<string, Array<{ instructor: string; skills: Array<[string, { k: number | null; u: number | null; d: number | null }]> }>>;

export function versionsData(lib: Pick<Library, 'courses'>, codes: string[]): VersionsData {
  const out: VersionsData = {};
  for (const code of codes) {
    out[code] = versionsOfCourse(lib, code).map((v) => ({ instructor: v.instructor, skills: [...v.skills] }));
  }
  return out;
}

export function versionsFromData(data: VersionsData, code: string): VersionSkills[] {
  return (data[code] ?? []).map((v) => ({ courseCode: code, instructor: v.instructor, skills: new Map(v.skills) }));
}
