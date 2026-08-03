/**
 * Persistence-boundary scrub for `extracted_text`, applied in finalizeExtraction
 * so it covers EVERY source path (docling-text and vision).
 *
 * Removes two measured contamination flavours (see the 2026-08-02 design + the
 * rag-core contamination report) while PRESERVING real content:
 *
 *  - Flavour A: docling picture-description VLM reasoning. A thinking-capable model
 *    emits its scaffolding INLINE with the description — "The user wants a
 *    description of the image. 1. Identify the main subject: a framed diploma. …".
 *    The reasoning IS the description, so the scrub is SURGICAL: it strips only the
 *    framing (the "the user wants a description" opener + the numbered
 *    "N. Identify/Analyze/Synthesize…:" step labels) and KEEPS the substance after
 *    each colon. For raw_cleared decks that substance is the only surviving record
 *    of the slide, so whole-span removal would be permanent content loss.
 *
 *  - Flavour B: qwen failure narration ("the image is completely blank…", "does
 *    not contain any textual content…") — here there is NO substance to keep, so
 *    the whole sentence goes. Plus decoder-pathology repetition runs.
 *
 * Returns '' only when nothing survives.
 */

// Flavour A (surgical, framing only) —
// (1) the meta opener sentence(s) the model addresses to itself.
const REASONING_OPENER =
  /(?:^|\n)[ \t]*(?:the user (?:wants|is asking for|is asking)\b|let me (?:describe|analyze|look|break|synthesize)\b|here is (?:a|the) description\b|okay[,. ]|i(?:'ll| will| need to) (?:describe|analyze|provide)\b)[^\n]*/gi;
// (2) numbered reasoning-step labels ("N. **Identify the main subject:**") — remove
//     the label, keep the described value that follows the colon. Anchored to the
//     numbered-list + reasoning-verb register so it does not eat legitimate prose.
const REASONING_LABEL =
  /(?:^|\n)[ \t]*\d+[.)][ \t]*\*{0,2}(?:identify (?:the |specific |any )|synthesi[sz]e (?:the |into )|analy[sz]e the |draft the |describe the |break down the |note (?:the |any )|examine the )[^:\n*]{0,45}:\*{0,2}[ \t]*/gi;

// Flavour B: failure-narration sentences (no substance to keep → whole sentence).
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
  out = out.replace(REASONING_OPENER, '\n'); // drop the opener line, keep line boundary
  out = out.replace(REASONING_LABEL, '\n');  // drop the step label, keep the value after it
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
