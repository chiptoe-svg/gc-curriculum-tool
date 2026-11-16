// Course codes for a syllabus import (spec §4b). Pure and client-safe: the dialog checks a new course's code against
// the library and the plan before sending; the route repeats the tracked-course check against the database.

/** "gc4800" / "GC  4800" / "GC-4800" → "GC 4800"; null when the text is not a course code. */
export function normalizeCourseCode(raw: string): string | null {
  const m = /^\s*([A-Za-z]{2,5})\s*[- ]?\s*(\d{4}[A-Za-z]{0,3})\s*$/.exec(raw);
  return m ? `${m[1]!.toUpperCase()} ${m[2]!.toUpperCase()}` : null;
}

/** Same course code, ignoring case and spacing (tracked codes may carry a lower-case suffix, e.g. "GC 4900ap"). */
export const sameCode = (a: string, b: string) => (normalizeCourseCode(a) ?? a.trim()).toUpperCase() === (normalizeCourseCode(b) ?? b.trim()).toUpperCase();

export const capturedMessage = (code: string) => `${code} already has a capture, so it cannot be drafted from a syllabus.`;
export const trackedMessage = (code: string) => `${code} is already in the catalog; choose it from the list instead.`;
export const proposedMessage = (code: string) => `${code} is already proposed on this map; choose it from the list instead.`;

/**
 * Why a code typed for a NEW course cannot be used, or null: it names a tracked course (captured or not) or a course
 * already proposed on this plan. Drafts must attach to the real course, never a duplicate.
 */
export function newCourseConflict(
  code: string, tracked: Array<{ code: string; captured: boolean }>, proposed: Array<{ code: string }>,
): string | null {
  const t = tracked.find(c => sameCode(c.code, code));
  if (t) return t.captured ? capturedMessage(t.code) : trackedMessage(t.code);
  const p = proposed.find(c => sameCode(c.code, code));
  return p ? proposedMessage(p.code) : null;
}
