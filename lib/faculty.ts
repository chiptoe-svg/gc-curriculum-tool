/**
 * GC faculty roster — drives the "Who's auditing?" dropdown at session
 * start in /capture/[code]. Each capture is tagged with the auditor's
 * identity so the same course taught by different faculty is captured
 * as distinct snapshots (same course code can vary a lot section to
 * section; depth scoring is a function of what students under that
 * specific instructor actually do).
 *
 * NOT a faculty management surface — just a list. Edit the constant
 * below to add/remove names. The "Department canonical" sentinel is
 * used for snapshots captured before instructor identity was tracked
 * (backfilled in migration 0027); it should stay in the list so the
 * dropdown can show those snapshots' lineage explicitly.
 *
 * If/when per-user auth lands (magic link, SSO), this list can move to
 * a `faculty` DB table populated from the same identity source.
 */

/** Sentinel for pre-instructor-attribution snapshots. Always present. */
export const DEPARTMENT_CANONICAL = 'Department canonical';

/**
 * GC faculty who may audit courses. Order is display order in the
 * dropdown. "Department canonical" is always last (it's a lineage
 * marker, not a real person).
 *
 * TODO: populate with the actual GC faculty roster. The placeholder
 * "Faculty A/B/C" entries make the UI testable without committing
 * specific names. Replace by editing this file — no other code needs
 * to change.
 */
export const FACULTY_ROSTER: readonly string[] = [
  // Sorted by last name (standard academic convention) but displayed
  // First Last in the UI. Add/remove by editing this file.
  'Carl Blue',
  'Amanda Bridges',
  'Bobby Congdon',
  'Kern Cox',
  'Gerry Dersken',
  'Michelle Fox',
  'Jesse Alan Godfrey',
  'Gilbert Santiago Gomez',
  'Jackie Herr',
  'Katie Hildebrand',
  'Carla Marchione',
  'Lori Pindar',
  'John Seymour',
  'Daryl Stevens',
  'Danita Swaney',
  'Chip Tonkin',
  'Erica Walker',
  'Eric Weisenmiller',
  'Charles Weiss',
  'Charles Williams',
  DEPARTMENT_CANONICAL,
] as const;

/** Returns true if the name appears in the roster (case-sensitive). */
export function isKnownFaculty(name: string): boolean {
  return FACULTY_ROSTER.includes(name);
}
