'use client';

import type { StressTestCompetencyAnnotationType } from '@/lib/ai/stress-test/schema';

interface Props {
  annotation: StressTestCompetencyAnnotationType | null;
}

/**
 * Per-competency inline reviewer concern. Rendered next to each row in
 * ProfileReviewPanel when a stress-test result is loaded. null when no
 * result yet OR when the reviewer didn't annotate this index (shouldn't
 * happen given the prompt, but render-safe).
 *
 * "high" confidence with no concerns renders nothing — no need to chip
 * the row with "looks fine." Only flags worth surfacing get visible.
 */
const toneByConfidence: Record<string, string> = {
  high: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200',
  medium: 'border-stone-300 bg-stone-50 text-stone-800 dark:border-stone-700 dark:bg-stone-900/20 dark:text-stone-200',
  low: 'border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200',
  disputed: 'border-red-400 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-900/20 dark:text-red-200',
};

export function StressTestBadge({ annotation }: Props) {
  if (!annotation) return null;
  // Pure-positive case: don't chip the row at all.
  if (annotation.confidence === 'high' && annotation.concerns.length === 0) return null;

  const tone = toneByConfidence[annotation.confidence] ?? toneByConfidence.medium;

  return (
    <details className={`mt-1 rounded border px-2 py-1 text-xs ${tone}`}>
      <summary className="cursor-pointer font-medium">
        Reviewer: {annotation.confidence}
        {annotation.suggested_adjustments && (
          <span className="ml-2 font-mono-plex text-[10px] uppercase tracking-[0.14em]">
            suggests adjustment
          </span>
        )}
      </summary>
      {annotation.concerns.length > 0 && (
        <ul className="mt-1 space-y-0.5 pl-4">
          {annotation.concerns.map((c, i) => (
            <li key={i} className="list-disc leading-relaxed">{c}</li>
          ))}
        </ul>
      )}
      {annotation.suggested_adjustments && (
        <p className="mt-1 font-mono-plex text-[10px]">
          Suggested:&nbsp;
          K={annotation.suggested_adjustments.k_depth ?? '—'} ·&nbsp;
          U={annotation.suggested_adjustments.u_depth ?? '—'} ·&nbsp;
          D={annotation.suggested_adjustments.d_depth ?? '—'}
        </p>
      )}
    </details>
  );
}
