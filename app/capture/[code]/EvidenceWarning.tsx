'use client';

import type { ReactNode } from 'react';
import type { EvidenceCheck } from '@/lib/capture/materials-health';

/**
 * Thin-evidence warning (owner, 2026-10-27): shown before the interview and at
 * approval when the capture has almost nothing to work from. It warns; it never
 * blocks — the parent supplies the "continue anyway" control as `children`.
 */
export function EvidenceWarning({ check, children }: { check: EvidenceCheck; children?: ReactNode }) {
  const n = check.unreadFiles.length;
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm" role="alert">
      <p className="font-medium text-amber-900">This capture has very little to work from.</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-900">
        {n > 0 && (
          <li>
            {n === 1 ? '1 file has' : `${n} files have`} not been read yet: {check.unreadFiles.join(', ')}. Go back
            to materials and run Ingest so the interview can use {n === 1 ? 'it' : 'them'}.
          </li>
        )}
        {check.onlySyllabus && (
          <li>
            Nothing has been read besides the syllabus
            {check.noCanvas ? ', and nothing has been imported from Canvas' : ''}. Assignments, rubrics and project
            briefs are what the profile is built from; without them the interview has to guess.
          </li>
        )}
      </ul>
      <p className="mt-2 text-amber-900">You can continue anyway, but the profile will be thin.</p>
      {children && <div className="mt-3 flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
