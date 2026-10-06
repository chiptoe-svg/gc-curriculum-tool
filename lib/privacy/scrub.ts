/**
 * Privacy scrub (spec docs/superpowers/specs/2026-10-05-privacy-scrub-design.md,
 * narrowed by the owner 2026-10-06).
 *
 * Removes only unambiguous identifiers before text is stored or published:
 * CUIDs, SSNs, and emails (emails kept in syllabi, which are public). Names
 * are NEVER removed automatically: an AI name pass replaced ordinary words and
 * would remove inventors, historical figures and industry leaders too. Called
 * by the single writer of course_materials.extracted_text
 * (updateExtractionResult) and by the single writer of wiki files (writeAndPush).
 */
import { scrubIdentifiers, countRedactionMarkers } from './deterministic';
import type { RedactionKind } from './types';

export interface ScrubOptions { fileName: string; isSyllabus: boolean }
export interface ScrubResult { text: string; redactions: Record<RedactionKind, number> }

/** Kept for callers' failure handling; the deterministic scrub does not throw. */
export class ScrubError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScrubError';
  }
}

export async function scrubForRecord(text: string, opts: ScrubOptions): Promise<ScrubResult> {
  const out = scrubIdentifiers(text, { keepEmails: opts.isSyllabus });
  return { text: out, redactions: countRedactionMarkers(out) };
}
