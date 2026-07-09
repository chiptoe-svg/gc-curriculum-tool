function fmt(iso: string): string {
  // date-only, locale-stable enough for a status line
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function DraftStatusStrip({
  reviewerStatus,
  lastSnapshotAt,
  forkedFrom,
}: {
  reviewerStatus: string;
  lastSnapshotAt: string | null;
  forkedFrom: { caption: string | null; createdAt: string } | null;
}) {
  return (
    <div
      data-testid="draft-status-strip"
      className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground"
    >
      <span className="font-medium text-foreground">Working draft</span>
      <span aria-hidden>·</span>
      <span>{reviewerStatus}</span>
      <span aria-hidden>·</span>
      <span>last snapshot {lastSnapshotAt ? fmt(lastSnapshotAt) : 'never'}</span>
      {forkedFrom && (
        <>
          <span aria-hidden>·</span>
          <span>forked from &ldquo;{forkedFrom.caption ?? fmt(forkedFrom.createdAt)}&rdquo;</span>
        </>
      )}
    </div>
  );
}
