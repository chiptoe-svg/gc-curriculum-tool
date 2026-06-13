/**
 * Single source of truth for coverage-scorer reliability data.
 *
 * These are TEST-RETEST STABILITY numbers — the same model, same input, N=5
 * re-runs. They measure consistency, NOT validity/correctness. A consistently
 * wrong model looks stable; human-rater validation (Part iii) is separate and
 * still pending.
 *
 * Update LAST_MEASURED only from a committed study run
 * (docs/superpowers/audits/2026-06-12-reliability-study.md).
 */

/**
 * Tripwire floors — band-agreement fraction per dimension.
 * Set below tonight's observed-good heavy numbers (K .82 / U 1.0 / D .73)
 * so normal run-to-run variance doesn't false-alarm, but far above the mini
 * failure (25%) — a real regression trips it.
 */
export const RELIABILITY_THRESHOLDS = {
  k: 0.60,
  u: 0.70,
  d: 0.60,
} as const;

export interface ReliabilityEntry {
  /** ISO date of the study run that produced these numbers. */
  date: string;
  /** Full band-agreement fraction for the K dimension (0–1). */
  k: number;
  /** Full band-agreement fraction for the U dimension (0–1). */
  u: number;
  /** Full band-agreement fraction for the D dimension (0–1). */
  d: number;
  /** Fraction of D scores within ±1 integer across re-runs. */
  withinOneD: number;
  /** Citation for the study that produced these numbers. */
  source: string;
}

/**
 * Committed headline numbers keyed by model name.
 * Seed: Part 2b heavy A/B result from 2026-06-12-reliability-study.md.
 *
 * To add a new entry after a study run:
 *   1. Commit the study output to docs/superpowers/audits/.
 *   2. Add the model key + numbers here in the same commit.
 *   3. Do NOT auto-generate these — human stays in the loop.
 */
export const LAST_MEASURED: Record<string, ReliabilityEntry> = {
  'gpt-5.5': {
    date: '2026-06-13',
    k: 0.817,
    u: 1.0,
    d: 0.733,
    withinOneD: 1.0,
    source:
      'docs/superpowers/audits/2026-06-12-reliability-study.md (Part 2b)',
  },
};

/**
 * Returns the last-measured reliability entry for a model, or null if no
 * data exists. Used by the /program cell drawer to surface stability context.
 */
export function reliabilityForModel(model: string): ReliabilityEntry | null {
  return LAST_MEASURED[model] ?? null;
}
