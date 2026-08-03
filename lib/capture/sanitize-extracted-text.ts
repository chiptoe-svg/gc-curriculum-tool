/**
 * Persistence-boundary scrub for `extracted_text`, applied in finalizeExtraction
 * so it covers EVERY source path (docling-text and vision).
 *
 * Removes two measured contamination flavours (see the 2026-08-02 design + the
 * rag-core contamination report) while preserving real content:
 *  - Flavour A: docling picture-description VLM reasoning preambles ("The user
 *    wants a description… 1. Identify the main subject…"), span-scrubbed from
 *    within otherwise-good markdown up to the next structural marker.
 *  - Flavour B: qwen failure narration ("the image is completely blank…", "does
 *    not contain any textual content…") and decoder-pathology repetition runs.
 *
 * Span-scrub, not whole-field drop: contaminated files also carry real content.
 * Returns '' only when nothing survives.
 */

// Flavour A: a reasoning-preamble sentence and everything up to the next docling
// structural marker (--- page N ---, <!-- image -->, a blank line, or end-of-text).
const REASONING_PREAMBLE =
  /(?:the user (?:wants|is asking for) a description|the user is asking|i (?:need|should|will) (?:to )?describe|let me describe|here is a description of|1\.\s+identify the main subject)[\s\S]*?(?=\n\s*---\s*page|\n\s*<!--\s*image|\n\s*\n|$)/gi;

// Flavour B: failure-narration sentences (bounded by sentence end or newline).
const FAILURE_NARRATION =
  /[^.\n]*?(?:the (?:provided )?image is (?:completely )?blank|no (?:visible )?content to transcribe|does not contain any (?:textual )?content)[^.\n]*(?:\.|(?=\n)|$)/gi;

// Decoder pathology: a short (2–6 char) cycle repeated many times without spaces.
const REPETITION_RUN = /(?:([a-z]{2,6}?))\1{4,}/gi;
// Fallback for non-exact cycles: a long run of lowercase letters with no spaces
// and low distinct-character variety is decoder garbage, not a real word.
const LONG_NOSPACE_RUN = /[a-z]{40,}/gi;

export function sanitizeExtractedText(text: string): string {
  if (!text) return text;
  let out = text;
  out = out.replace(REASONING_PREAMBLE, '');
  out = out.replace(FAILURE_NARRATION, '');
  out = out.replace(REPETITION_RUN, '');
  out = out.replace(LONG_NOSPACE_RUN, (m) =>
    // keep it only if it has ≥12 distinct characters (real long token vs. cycle garbage)
    new Set(m).size >= 12 ? m : '',
  );
  // collapse the blank lines / stray spaces the removals leave behind
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return out;
}
