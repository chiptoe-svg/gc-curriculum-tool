import type { Area7Block } from '@/lib/ai/capture/area7-types';

export type ProblemSolvingBand = 'none' | 'slight' | 'moderate' | 'significant';

const PF_KEYS = [
  'generate_then_consolidate', 'open_ended_problems', 'revision_cycles',
  'structured_post_mortem', 'abstraction_bridging',
] as const;

const LABELS: Record<ProblemSolvingBand, string> = {
  none: 'no real', slight: 'slight', moderate: 'moderate', significant: 'significant',
};

/**
 * Weighted evidence score over the five present/partial/absent Area-7
 * conditions (present=2, partial=1, absent/unassessed=0) → a qualitative band.
 * `max_supporting_depth` is a separate signal and is NOT scored here.
 */
export function problemSolvingBand(block: Area7Block): { band: ProblemSolvingBand; label: string; score: number } {
  let score = 0;
  for (const k of PF_KEYS) {
    const v = block[k];
    if (v === 'present') score += 2;
    else if (v === 'partial') score += 1;
  }
  const band: ProblemSolvingBand =
    score === 0 ? 'none' : score <= 3 ? 'slight' : score <= 7 ? 'moderate' : 'significant';
  return { band, label: LABELS[band], score };
}
