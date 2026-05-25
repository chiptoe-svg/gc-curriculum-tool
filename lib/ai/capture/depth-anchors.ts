/**
 * Human-readable anchors for each K/U/D depth value (0-5).
 *
 * **Source of truth:** `lib/ai/prompts/shared/depth-scale.md` — that file
 * is loaded by the AI prompts at runtime. This TS file is a hand-mirrored
 * copy for UI display (review panel slider labels, tooltips, etc.) so
 * the client doesn't have to parse markdown.
 *
 * If you change the scale, update BOTH files. The depth-scale.md
 * docstring carries a note pointing here.
 *
 * The labels here are the short anchor headings, lightly edited for
 * tight slider-row display (e.g., "Use correct terminology when
 * discussing the domain" stays verbatim — it's already concise).
 */

export type Dimension = 'k' | 'u' | 'd';

export const DEPTH_ANCHORS: Record<Dimension, readonly [string, string, string, string, string, string]> = {
  k: [
    'Not present in this course',
    'Exposure — student encountered it in delivery',
    'Recognize — can identify when shown options',
    'Recall — can produce on cue without prompt',
    'Use correct terminology when discussing the domain',
    'Fluent across full vocabulary, including conventions and edge cases',
  ],
  u: [
    'Not present',
    'Restates the explanation as given',
    'Explains the rationale in own words',
    'Predicts consequences (if X then Y, because…)',
    'Reasons through novel cases not previously seen',
    'Critiques the principle, identifies limits, extends to new domains',
  ],
  d: [
    'Not present',
    'Performs with per-step direction or supervision',
    'Performs using a reference or checklist',
    'Performs independently in familiar conditions',
    'Adapts performance to new conditions or constraints',
    'Performs creatively with critical judgment; can guide others',
  ],
} as const;

/**
 * Returns the short anchor description for a (dimension, value) pair.
 * Returns an empty string for null values (foundational K/U) so the
 * caller can render an empty line cleanly without a conditional.
 */
export function describeDepth(dimension: Dimension, value: number | null): string {
  if (value === null || value < 0 || value > 5) return '';
  // Tuple indexing returns string | undefined under noUncheckedIndexedAccess;
  // we just validated the range, so `??''` is a safe (and quiet) fallback.
  return DEPTH_ANCHORS[dimension][value] ?? '';
}
