'use client';

import type { StressTestCompetencyAnnotationType } from '@/lib/ai/stress-test/schema';
import { plainDepth } from '@/lib/capture/plain-depth';

interface Props {
  annotation: StressTestCompetencyAnnotationType | null;
}

/**
 * The second reviewer's note on a card it did NOT flag (flagged cards show
 * their reason above the card instead). Renders nothing when there is no
 * result or nothing to say.
 */
export function StressTestBadge({ annotation }: Props) {
  if (!annotation || annotation.concerns.length === 0) return null;
  return (
    <details className="mt-1 rounded border border-stone-300 bg-stone-50 px-2 py-1 text-sm text-stone-800 dark:border-stone-700 dark:bg-stone-900/20 dark:text-stone-200">
      <summary className="cursor-pointer font-medium">Second reviewer&apos;s note</summary>
      <ul className="mt-1 space-y-0.5 pl-4">
        {annotation.concerns.map((c, i) => (
          <li key={i} className="list-disc leading-relaxed">{plainDepth(c)}</li>
        ))}
      </ul>
    </details>
  );
}
