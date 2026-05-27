'use client';

import { useEffect, useState } from 'react';
import type { CheckInResult } from '@/lib/ai/analyze/ingestion-checkin';

interface Props {
  courseCode: string;
  slug: string;
}

const KIND_LABEL: Record<'missing' | 'set-aside' | 'ferpa', string> = {
  ferpa: 'FERPA',
  'set-aside': 'SET-ASIDE',
  missing: 'MISSING',
};

/**
 * Pre-audit curation heads-up. Fetches `generateIngestionCheckIn`'s
 * verdict on the materials list and renders a small amber banner above
 * the audit chat IF (and only if) the AI returned a non-null message.
 *
 * Silence is the affirmation: no banner means "materials look good for
 * audit." Dismissal is client-local — re-running the call on each
 * page-open is intentional.
 */
export function IngestionCheckIn({ courseCode, slug }: Props) {
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/courses/${encodeURIComponent(courseCode)}/checkin?slug=${encodeURIComponent(slug)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const r = (await res.json()) as CheckInResult;
        if (!cancelled) setResult(r);
      } catch {
        // Silent: a failed check-in fetch should never surface UI noise.
      }
    })();
    return () => { cancelled = true; };
  }, [courseCode, slug]);

  if (dismissed) return null;
  if (!result || result.message === null) return null;

  const highlights = result.highlights.slice(0, 3);

  return (
    <div
      role="status"
      className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-amber-900">
          <span className="font-medium">Before you start:</span>{' '}
          <span className="text-amber-900/90">{result.message}</span>
        </p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded border border-amber-300 bg-white px-2 py-0.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
          aria-label="Dismiss ingestion check-in"
        >
          Dismiss
        </button>
      </div>
      {highlights.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-amber-900/90">
          {highlights.map((h, i) => (
            <li key={i} className="flex items-baseline gap-2">
              <span className="inline-block min-w-[64px] shrink-0 font-mono text-[10px] uppercase tracking-wider text-amber-800">
                {KIND_LABEL[h.kind]}
              </span>
              <span>{h.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
