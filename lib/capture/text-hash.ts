import { createHash } from 'node:crypto';

/** Fingerprint of a material's extracted text, frozen into each snapshot so a
 *  later edit is noticed even when the file size did not change (spec
 *  2026-11-08-course-revision-modes-labels-design.md). Null when there is no text. */
export function hashText(text: string | null | undefined): string | null {
  if (!text) return null;
  return createHash('sha256').update(text).digest('hex');
}
