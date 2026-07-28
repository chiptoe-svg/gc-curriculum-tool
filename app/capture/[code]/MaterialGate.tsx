'use client';
import { useState } from 'react';
import type { FlaggedMaterial, FlagKind } from '@/lib/capture/flag-materials';

const GROUP_LABEL: Record<FlagKind, string> = {
  'extraction-failed': "Couldn't read these files",
  'ferpa-held': 'Held for FERPA review (excluded from scoring)',
  'inaccessible-link': 'Referenced but not accessible',
};
const ORDER: FlagKind[] = ['extraction-failed', 'ferpa-held', 'inaccessible-link'];

/**
 * Pre-interview material-failure gate (issue #4 follow-up). Rendered only when
 * flagMaterials() returns flags. Faculty optionally note each flagged material,
 * optionally override FERPA-held ones (Include anyway), then Continue (one button)
 * or go Back to materials. Presentational — persistence + advancing is the caller's.
 */
export function MaterialGate({
  flags,
  onContinue,
  onBack,
  error,
}: {
  flags: FlaggedMaterial[];
  onContinue: (notes: Record<string, string>, include: string[]) => void;
  onBack: () => void;
  error?: string | null;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [include, setInclude] = useState<Set<string>>(new Set());
  const groups = ORDER.filter((k) => flags.some((f) => f.kind === k));

  return (
    <div className="mx-auto max-w-2xl space-y-4 rounded-md border bg-card p-6" role="region" aria-label="Material review">
      <div>
        <h2 className="text-lg font-medium">Before you start — a few materials need a look</h2>
        <p className="text-sm text-muted-foreground">
          These won’t contribute to the audit as-is. Proceed anyway, or add a note (optional) explaining each.
        </p>
      </div>
      {groups.map((kind) => (
        <div key={kind} className="space-y-2">
          <p className="text-sm font-medium">{GROUP_LABEL[kind]}</p>
          {flags.filter((f) => f.kind === kind).map((f) => (
            <div key={f.id} className="rounded border bg-muted/10 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{f.fileName}</span>
                {kind === 'ferpa-held' && (
                  <button
                    type="button"
                    className="shrink-0 rounded border px-2 py-1 text-xs hover:bg-muted"
                    aria-pressed={include.has(f.id)}
                    onClick={() => setInclude((prev) => {
                      const next = new Set(prev);
                      if (next.has(f.id)) next.delete(f.id); else next.add(f.id);
                      return next;
                    })}
                  >
                    {include.has(f.id) ? 'Will include ✓' : 'Include anyway'}
                  </button>
                )}
              </div>
              <textarea
                className="mt-2 w-full rounded border px-2 py-1 text-sm"
                rows={2}
                placeholder="Optional note (why this is ok, or what you’ll do about it)"
                defaultValue={f.facultyNote ?? ''}
                onChange={(e) => setNotes((prev) => ({ ...prev, [f.id]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      ))}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center justify-between">
        <button type="button" className="text-sm underline" onClick={onBack}>
          Back to materials
        </button>
        <button
          type="button"
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          onClick={() => {
            const edited = Object.fromEntries(
              Object.entries(notes).filter(([, v]) => v.trim().length > 0),
            );
            onContinue(edited, [...include]);
          }}
        >
          Continue to interview
        </button>
      </div>
    </div>
  );
}
