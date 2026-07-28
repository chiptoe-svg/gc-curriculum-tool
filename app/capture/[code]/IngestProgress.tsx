export interface IngestStatus {
  total: number;
  done: number;
  failed: number;
  etaSeconds: number;
}

/**
 * Material-level ingest progress bar + self-correcting ETA (issue #4).
 * Renders nothing once every material is settled (done + failed >= total) or
 * when there are no materials — so it only appears while ingest is in flight.
 */
export function IngestProgress({ status }: { status: IngestStatus }) {
  const { total, done, failed, etaSeconds } = status;
  if (total === 0 || done + failed >= total) return null;
  const pct = Math.round((done / total) * 100);
  const eta = etaSeconds >= 90 ? `~${Math.round(etaSeconds / 60)} min` : `${Math.max(etaSeconds, 1)} s`;
  return (
    <div className="rounded-md border bg-muted/20 px-4 py-3 text-sm" role="status" aria-live="polite">
      <p>
        Indexing materials — <strong>{done} of {total}</strong> done
        {failed ? `, ${failed} failed` : ''} · est. {eta} left
      </p>
      <div className="mt-2 h-2 w-full rounded bg-stone-200">
        <div className="h-2 rounded bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
