import { describe, it, expect } from 'vitest';
import { stressTestFlags } from '@/lib/capture/stress-flags';
import type { StressTestResultType } from '@/lib/ai/stress-test/schema';
import type { CaptureCompetency } from '@/lib/ai/capture/schema';

const comps = [
  { statement: 'Budget', k_depth: 2, u_depth: 2, d_depth: 3 },
  { statement: 'LinkedIn', k_depth: 3, u_depth: 1, d_depth: 2 },
  { statement: 'Agency', k_depth: null, u_depth: null, d_depth: 2 },
  { statement: 'Fair', k_depth: 1, u_depth: 0, d_depth: 1 },
] as unknown as CaptureCompetency[];

function result(per: StressTestResultType['per_competency']): StressTestResultType {
  return {
    per_competency: per,
    profile_level: { catalog_vs_evidence_concerns: [], consistency_concerns: [], coverage_concerns: [] },
    overall_assessment: 'mixed',
    summary: 's',
  };
}

describe('stressTestFlags', () => {
  it('flags low and disputed cards, with the first concern (in plain words) as the reason', () => {
    const flags = stressTestFlags(result([
      { competency_index: 0, confidence: 'low', concerns: ['D3 rests on one Budget submission.', 'second'], suggested_adjustments: null },
      { competency_index: 1, confidence: 'disputed', concerns: ['No rubric for the profile.'], suggested_adjustments: null },
      { competency_index: 2, confidence: 'high', concerns: [], suggested_adjustments: null },
      { competency_index: 3, confidence: 'medium', concerns: ['Minor wording.'], suggested_adjustments: null },
    ]), comps);
    expect([...flags.keys()]).toEqual([0, 1]);
    expect(flags.get(0)).toBe('does it independently in familiar situations rests on one Budget submission.');
    expect(flags.get(1)).toBe('No rubric for the profile.');
  });

  it('flags any card with a suggested adjustment that differs, and says the suggestion in words', () => {
    const flags = stressTestFlags(result([
      { competency_index: 0, confidence: 'medium', concerns: ['Independence is not shown.'], suggested_adjustments: { k_depth: 2, u_depth: 2, d_depth: 2 } },
    ]), comps);
    expect(flags.get(0)).toBe('Independence is not shown. Suggested instead — Doing: does it with a reference or checklist.');
  });

  it('lists several suggested changes in Knowing, Reasoning, Doing order', () => {
    const flags = stressTestFlags(result([
      { competency_index: 1, confidence: 'low', concerns: [], suggested_adjustments: { k_depth: 2, u_depth: 0, d_depth: 2 } },
    ]), comps);
    expect(flags.get(1)).toBe(
      "The second reviewer doubts this score. Suggested instead — Knowing: recognizes it; Reasoning: doesn't yet reason about why.",
    );
  });

  it('ignores a suggestion identical to the current scores (medium confidence → not flagged)', () => {
    const flags = stressTestFlags(result([
      { competency_index: 0, confidence: 'medium', concerns: ['fine'], suggested_adjustments: { k_depth: 2, u_depth: 2, d_depth: 3 } },
    ]), comps);
    expect(flags.size).toBe(0);
  });

  it('ignores annotations whose index is out of range', () => {
    const flags = stressTestFlags(result([
      { competency_index: 9, confidence: 'disputed', concerns: ['x'], suggested_adjustments: null },
    ]), comps);
    expect(flags.size).toBe(0);
  });
});
