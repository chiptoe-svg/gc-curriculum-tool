/**
 * Turn the automatic stress test's per-competency annotations into the review
 * panel's "Worth a look" flags: index → one short plain-language reason.
 * Pure — unit-tested in lib/capture/__tests__/stress-flags.test.ts.
 *
 * A card is flagged when the second reviewer is unsure of it (confidence
 * 'low' or 'disputed') or suggests scores that differ from the current ones.
 * 'medium' / 'high' with no differing suggestion is not flagged.
 */
import type { StressTestResultType } from '@/lib/ai/stress-test/schema';
import type { CaptureCompetency } from '@/lib/ai/capture/schema';
import type { Dimension } from '@/lib/ai/capture/depth-anchors';
import { dimLabel } from '@/lib/ai/capture/portrait';
import { plainDepth, plainDepthPhrase } from '@/lib/capture/plain-depth';

const DEPTH_KEY: Record<Dimension, 'k_depth' | 'u_depth' | 'd_depth'> = { k: 'k_depth', u: 'u_depth', d: 'd_depth' };

export function stressTestFlags(
  result: StressTestResultType,
  competencies: ReadonlyArray<Pick<CaptureCompetency, 'k_depth' | 'u_depth' | 'd_depth'>>,
): Map<number, string> {
  const flags = new Map<number, string>();
  for (const a of result.per_competency) {
    const c = competencies[a.competency_index];
    if (!c) continue;
    const changes: string[] = [];
    if (a.suggested_adjustments) {
      for (const dim of ['k', 'u', 'd'] as const) {
        const next = a.suggested_adjustments[DEPTH_KEY[dim]];
        if (next !== null && next !== c[DEPTH_KEY[dim]]) {
          changes.push(`${dimLabel(dim)}: ${plainDepthPhrase(dim, next)}`);
        }
      }
    }
    const unsure = a.confidence === 'low' || a.confidence === 'disputed';
    if (!unsure && changes.length === 0) continue;
    const first = a.concerns[0]?.trim();
    const reason = first ? plainDepth(first) : 'The second reviewer doubts this score.';
    flags.set(
      a.competency_index,
      changes.length > 0 ? `${reason} Suggested instead — ${changes.join('; ')}.` : reason,
    );
  }
  return flags;
}
