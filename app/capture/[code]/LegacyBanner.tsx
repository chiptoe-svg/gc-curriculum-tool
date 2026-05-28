'use client';

/**
 * Shown above the Review panel / Verification summary when a CaptureProfile
 * comes from a pre-v2 audit (no source-flag provenance). Faculty clicks "Re-audit"
 * to start a fresh v2 session; no auto-migration happens.
 */
export function LegacyBanner({ onReaudit }: { onReaudit?: () => void }) {
  return (
    <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">Legacy draft — no per-finding provenance.</p>
          <p className="mt-0.5 text-xs leading-snug">
            This profile was captured before per-finding source flags and clickable citations existed.
            The ratings remain valid; they just don&apos;t carry an evidence trail.
            Start a fresh audit when you have time and the new version will replace this one.
          </p>
        </div>
        {onReaudit && (
          <button
            type="button"
            onClick={onReaudit}
            className="shrink-0 rounded border border-amber-400 bg-amber-100 px-2 py-1 text-xs font-medium hover:bg-amber-200"
          >
            Start fresh audit
          </button>
        )}
      </div>
    </div>
  );
}
