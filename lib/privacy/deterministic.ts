import { STUDENT_NAME, STUDENT_ID, EMAIL, SSN, type RedactionKind } from './types';

// Same shapes as lib/capture/ferpa-detect.ts and lib/capture/redact-pii.ts.
const CUID = /\bC\d{8}\b/g;
const EMAIL_ADDRESS = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
// US Social Security number in its written form (123-45-6789).
const SSN_NUMBER = /\b\d{3}-\d{2}-\d{4}\b/g;

/**
 * The privacy scrub: every CUID becomes [student ID], every SSN [SSN], and
 * every email [email] unless `keepEmails` (syllabi, whose instructor/TA
 * contacts are public). Names are never removed (owner, 2026-10-06).
 */
export function scrubIdentifiers(text: string, opts: { keepEmails: boolean }): string {
  const out = text.replace(CUID, STUDENT_ID).replace(SSN_NUMBER, SSN);
  return opts.keepEmails ? out : out.replace(EMAIL_ADDRESS, EMAIL);
}

/** Distinct email / CUID / SSN patterns still present — the wiki hard check. */
export function findResidualIdentifiers(text: string): string[] {
  const hits = [...text.matchAll(CUID), ...text.matchAll(SSN_NUMBER), ...text.matchAll(EMAIL_ADDRESS)].map(m => m[0]);
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
    ssn: count(SSN),
  };
}
