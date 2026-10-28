'use client';

import { useState } from 'react';
import type { InterviewChecklist as Checklist } from '@/lib/capture/interview-checklist';

const COVERED_SHOWN = 10;

/**
 * The interviewer's to-do list beside the chat (owner, 2026-10-28). "Still to
 * cover" is its latest list and can change every turn; "Covered" keeps every
 * item checked off so far, newest first, with this turn's additions marked.
 */
export function InterviewChecklist({
  checklist,
  justCovered,
  updating,
}: {
  checklist: Checklist;
  justCovered: string[];
  updating: boolean;
}) {
  const fresh = new Set(justCovered);
  // A long interview checks off dozens of items: show the newest few.
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? checklist.covered : checklist.covered.slice(0, COVERED_SHOWN);
  return (
    <aside data-testid="interview-checklist" aria-label="Interview checklist" className="space-y-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Interview checklist</h3>
        {updating && (
          <span className="flex items-center gap-1.5 text-muted-foreground" role="status">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" aria-hidden />
            Updating…
          </span>
        )}
      </div>
      <p className="leading-snug text-muted-foreground">
        What the interviewer still wants to ask about. The list can change as it learns more.
      </p>

      <section className={updating ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        <h4 className="mb-1 font-medium text-foreground">Still to cover</h4>
        {checklist.remaining.length === 0 ? (
          <p className="text-muted-foreground">Nothing listed yet.</p>
        ) : (
          <ul className="space-y-1">
            {checklist.remaining.map(item => (
              <li key={item} className="flex gap-1.5 leading-snug">
                <span className="mt-0.5 inline-block h-3 w-3 shrink-0 rounded-sm border border-muted-foreground/50" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {checklist.covered.length > 0 && (
        <section>
          <h4 className="mb-1 font-medium text-foreground">Covered ({checklist.covered.length})</h4>
          <ul className="space-y-1">
            {shown.map(item => (
              <li
                key={item}
                data-testid={`covered-${item}`}
                data-new={fresh.has(item) ? 'true' : undefined}
                className={'flex gap-1.5 leading-snug ' + (fresh.has(item) ? 'rounded bg-green-50 font-medium text-green-900' : 'text-muted-foreground')}
              >
                <span className="shrink-0 text-green-700" aria-hidden>✓</span>
                <span>{item}{fresh.has(item) && <span className="sr-only"> (just covered)</span>}</span>
              </li>
            ))}
          </ul>
          {checklist.covered.length > COVERED_SHOWN && (
            <button type="button" onClick={() => setShowAll(v => !v)} className="mt-1 text-muted-foreground underline hover:text-foreground">
              {showAll ? 'Show fewer' : `Show all ${checklist.covered.length}`}
            </button>
          )}
        </section>
      )}
    </aside>
  );
}
