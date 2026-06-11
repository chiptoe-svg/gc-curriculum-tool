export type CourseCategory = 'gc_core' | 'specialty' | 'major_req' | 'other';

/** Display order on the public landing page. */
export const CATEGORY_ORDER: CourseCategory[] = ['gc_core', 'specialty', 'major_req', 'other'];

export const CATEGORY_LABELS: Record<CourseCategory, string> = {
  gc_core: 'GC Core',
  specialty: 'Specialty Area / GC Tech',
  major_req: 'Major Requirements + GenEds',
  other: 'Other courses',
};

export interface CourseClassification {
  category: CourseCategory;
  buildsToCareer: boolean;
}

/**
 * Single source of truth for the initial classification of the 46 catalog
 * courses. The 0033 migration backfills `category` + `builds_to_career` from
 * this map; `course-category-migration.test.ts` guards the SQL against drift.
 * Newly-added courses are NOT here — they default to category='other',
 * builds_to_career=false at the DB level.
 */
export const COURSE_CLASSIFICATION_SEED: Record<string, CourseClassification> = {
  // ── GC Core (16) — all build to career ──────────────────────────────────
  'GC 1010': { category: 'gc_core', buildsToCareer: true },
  'GC 1020': { category: 'gc_core', buildsToCareer: true },
  'GC 1040': { category: 'gc_core', buildsToCareer: true },
  'GC 1050': { category: 'gc_core', buildsToCareer: true },
  'GC 2070': { category: 'gc_core', buildsToCareer: true },
  'GC 2400': { category: 'gc_core', buildsToCareer: true },
  'GC 3400': { category: 'gc_core', buildsToCareer: true },
  'GC 3460': { category: 'gc_core', buildsToCareer: true },
  'GC 3500': { category: 'gc_core', buildsToCareer: true },
  'GC 3800': { category: 'gc_core', buildsToCareer: true },
  'GC 4060': { category: 'gc_core', buildsToCareer: true },
  'GC 4400': { category: 'gc_core', buildsToCareer: true },
  'GC 4440': { category: 'gc_core', buildsToCareer: true },
  'GC 4480': { category: 'gc_core', buildsToCareer: true },
  'GC 4500': { category: 'gc_core', buildsToCareer: true },
  'GC 4800': { category: 'gc_core', buildsToCareer: true },
  // ── Specialty Area / GC Tech (14) — all excluded ────────────────────────
  'GC 3620': { category: 'specialty', buildsToCareer: false },
  'GC 3700': { category: 'specialty', buildsToCareer: false },
  'GC 3710': { category: 'specialty', buildsToCareer: false },
  'GC 3720': { category: 'specialty', buildsToCareer: false },
  'GC 3730': { category: 'specialty', buildsToCareer: false },
  'GC 3740': { category: 'specialty', buildsToCareer: false },
  'GC 3760': { category: 'specialty', buildsToCareer: false },
  'GC 3780': { category: 'specialty', buildsToCareer: false },
  'GC 3790': { category: 'specialty', buildsToCareer: false },
  'GC 4070': { category: 'specialty', buildsToCareer: false },
  'GC 4900ap': { category: 'specialty', buildsToCareer: false },
  'GC 4900bl': { category: 'specialty', buildsToCareer: false },
  'GC 4900or': { category: 'specialty', buildsToCareer: false },
  'GC 4990ta': { category: 'specialty', buildsToCareer: false },
  // ── Major Requirements + GenEds (16) — 11 included / 5 excluded ──────────
  'ACCT 2010': { category: 'major_req', buildsToCareer: true },
  'ACCT 2020': { category: 'major_req', buildsToCareer: true },
  'MGT 2010': { category: 'major_req', buildsToCareer: true },
  'MKT 3010': { category: 'major_req', buildsToCareer: true },
  'PKSC 1020': { category: 'major_req', buildsToCareer: true },
  'STAT 2300': { category: 'major_req', buildsToCareer: true },
  'ENGL 1030': { category: 'major_req', buildsToCareer: true },
  'ENSP 2000': { category: 'major_req', buildsToCareer: true },
  'PSYC 2010': { category: 'major_req', buildsToCareer: true },
  'ECON 2110': { category: 'major_req', buildsToCareer: true },
  'PCID 3040': { category: 'major_req', buildsToCareer: true },
  'STAT 2220': { category: 'major_req', buildsToCareer: false },
  'STAT 3090': { category: 'major_req', buildsToCareer: false },
  'STAT 3300': { category: 'major_req', buildsToCareer: false },
  'ECON 2000': { category: 'major_req', buildsToCareer: false },
  'PCID 3140': { category: 'major_req', buildsToCareer: false },
};

export function codesForCategory(category: CourseCategory): string[] {
  return Object.entries(COURSE_CLASSIFICATION_SEED)
    .filter(([, v]) => v.category === category)
    .map(([code]) => code);
}

export function codesBuildingToCareer(): string[] {
  return Object.entries(COURSE_CLASSIFICATION_SEED)
    .filter(([, v]) => v.buildsToCareer)
    .map(([code]) => code);
}
