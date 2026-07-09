import type { InputsDrift } from '@/lib/capture/inputs-drift';

export function InputsDriftBanner({ drift }: { drift: InputsDrift | null }) {
  if (!drift) return null;
  // legacy snapshot: no frozen materials to compare
  if (!drift.available) {
    return (
      <div
        data-testid="inputs-drift-banner"
        className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800"
      >
        Inputs record unavailable for this snapshot — it was taken before materials were recorded, so changes can&apos;t be listed.
      </div>
    );
  }
  if (!drift.hasDrift) return null;
  return (
    <div
      data-testid="inputs-drift-banner"
      className="mb-4 rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900"
    >
      <p className="font-semibold">Materials have changed since the snapshot this draft was forked from.</p>
      <details className="mt-1">
        <summary className="cursor-pointer text-amber-800">What changed</summary>
        <div className="mt-1 space-y-1">
          {drift.added.length > 0 && (
            <p>
              <span className="font-medium">Added:</span> {drift.added.map(m => m.fileName).join(', ')}
            </p>
          )}
          {drift.removed.length > 0 && (
            <p>
              <span className="font-medium">Removed:</span> {drift.removed.map(m => m.fileName).join(', ')}
            </p>
          )}
          {drift.changed.length > 0 && (
            <p>
              <span className="font-medium">Changed:</span>{' '}
              {drift.changed.map(c => `${c.fileName} (${c.was} → ${c.now})`).join(', ')}
            </p>
          )}
          {drift.canvasChanged && (
            <p>
              <span className="font-medium">Canvas:</span> re-imported since the snapshot.
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
