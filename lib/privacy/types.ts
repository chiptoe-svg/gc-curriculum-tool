/**
 * Privacy scrub (spec docs/superpowers/specs/2026-10-05-privacy-scrub-design.md).
 * Placeholders written in place of student-identifying data.
 */
export const STUDENT_NAME = '[student]';
export const STUDENT_ID = '[student ID]';
export const EMAIL = '[email]';
export const SSN = '[SSN]';

/** Keys of the redaction counts. */
export type RedactionKind = 'student-name' | 'student-id' | 'email' | 'ssn';

/**
 * Shape of `course_materials.redactions` (migration 0052). The column is null
 * for rows written before the scrub existed.
 */
export interface MaterialRedactions {
  /** How many of each placeholder the stored text holds (empty on failure). */
  counts: Record<string, number>;
  /** Why the scrub failed (then no text is stored), or null on success. */
  failedReason: string | null;
}
