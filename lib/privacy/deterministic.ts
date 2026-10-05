import { STUDENT_NAME, STUDENT_ID, EMAIL, type RedactionKind } from './types';

// Same shapes as lib/capture/ferpa-detect.ts and lib/capture/redact-pii.ts.
const CUID = /\bC\d{8}\b/g;
const EMAIL_ADDRESS = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/**
 * The deterministic layer of the privacy scrub: every CUID becomes
 * [student ID]; every email becomes [email] unless `keepEmails` (syllabi,
 * whose instructor/TA contacts are public).
 */
export function scrubIdentifiers(text: string, opts: { keepEmails: boolean }): string {
  const out = text.replace(CUID, STUDENT_ID);
  return opts.keepEmails ? out : out.replace(EMAIL_ADDRESS, EMAIL);
}

/** Distinct email / CUID patterns still present — the wiki hard check. */
export function findResidualIdentifiers(text: string): string[] {
  const hits = [...text.matchAll(CUID), ...text.matchAll(EMAIL_ADDRESS)].map(m => m[0]);
  return [...new Set(hits)];
}

/**
 * Placeholder counts in a text. Counting the stored text (rather than summing
 * what each pass replaced) keeps the count right when text is scrubbed twice.
 */
export function countRedactionMarkers(text: string): Record<RedactionKind, number> {
  const count = (marker: string) => text.split(marker).length - 1;
  return {
    'student-name': count(STUDENT_NAME),
    'student-id': count(STUDENT_ID),
    email: count(EMAIL),
  };
}
