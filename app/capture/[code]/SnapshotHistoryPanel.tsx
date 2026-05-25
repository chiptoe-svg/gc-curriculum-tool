'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CaptureVerificationSummary } from '@/lib/ai/capture/schema';

export interface SnapshotListItem {
  id: string;
  caption: string | null;
  captionNote: string | null;
  scaleVersion: string;
  model: string;
  retiredAt: string | null;
  createdAt: string;
  // Old profiles created before the verification_summary field was added
  // may have this as undefined; SnapshotHistoryPanel renders defensively.
  verificationSummary: CaptureVerificationSummary | null | undefined;
}

interface Props {
  courseCode: string;
  slug: string;
  onUseAsDraft?: (snapshotId: string) => Promise<void>;
  /** Bumped when a new snapshot is created elsewhere on the page so the list refreshes. */
  refreshKey?: number;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function SnapshotHistoryPanel({ courseCode, slug, onUseAsDraft, refreshKey = 0 }: Props) {
  const [snapshots, setSnapshots] = useState<SnapshotListItem[]>([]);
  const [includeRetired, setIncludeRetired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/capture/${encodeURIComponent(courseCode)}/snapshots?slug=${encodeURIComponent(slug)}${includeRetired ? '&includeRetired=true' : ''}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? `Failed to load snapshots (${res.status})`);
        return;
      }
      const json = await res.json() as { snapshots: SnapshotListItem[] };
      setSnapshots(json.snapshots);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load snapshots');
    } finally {
      setLoading(false);
    }
  }, [courseCode, slug, includeRetired]);

  useEffect(() => { void refresh(); }, [refresh, refreshKey]);

  async function handleUseAsDraft(snapshotId: string) {
    if (!onUseAsDraft) return;
    if (!confirm('Replace the current working draft with this snapshot’s profile? Unsaved edits to the current draft will be lost (snapshots are not affected).')) return;
    setBusy(snapshotId);
    try {
      await onUseAsDraft(snapshotId);
    } finally {
      setBusy(null);
    }
  }

  async function handleRetireToggle(snapshotId: string, currentlyRetired: boolean) {
    setBusy(snapshotId);
    try {
      await fetch(
        `/api/capture/${encodeURIComponent(courseCode)}/snapshots/${snapshotId}?slug=${encodeURIComponent(slug)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ retired: !currentlyRetired }),
        },
      );
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  if (loading && snapshots.length === 0) {
    return (
      <section className="rounded-md border bg-card px-4 py-3 text-xs text-muted-foreground">
        Loading snapshot history…
      </section>
    );
  }

  if (!loading && snapshots.length === 0) {
    return (
      <section className="rounded-md border bg-card px-4 py-3 text-xs text-muted-foreground">
        <p>No snapshots yet. Once you confirm a Course Outcome Profile, it&apos;ll be recorded here as an immutable, dated record.</p>
      </section>
    );
  }

  const activeCount = snapshots.filter(s => !s.retiredAt).length;
  const retiredCount = snapshots.length - activeCount;

  return (
    <section className="rounded-md border bg-card shadow-sm">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-2">
        <div>
          <h2 className="text-sm font-semibold">Snapshot history</h2>
          <p className="text-[11px] text-muted-foreground">
            {activeCount} active{retiredCount > 0 && ` · ${retiredCount} retired`} · immutable records of confirmed profiles
          </p>
        </div>
        {retiredCount > 0 && (
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <input
              type="checkbox"
              checked={includeRetired}
              onChange={e => setIncludeRetired(e.target.checked)}
              className="h-3 w-3"
            />
            show retired
          </label>
        )}
      </header>

      {error && <p className="border-b bg-red-50 px-4 py-2 text-xs text-destructive">{error}</p>}

      <ul className="divide-y">
        {snapshots.map(s => {
          const isExpanded = expanded === s.id;
          const isRetired = s.retiredAt !== null;
          return (
            <li key={s.id} className={'px-4 py-3 ' + (isRetired ? 'opacity-60' : '')}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">
                      {s.caption || <span className="text-muted-foreground">Snapshot</span>}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatDate(s.createdAt)}</span>
                    {isRetired && (
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">retired</span>
                    )}
                    <span className="text-[10px] text-muted-foreground">{s.model}</span>
                  </div>
                  {s.captionNote && (
                    <p className="mt-1 text-xs leading-snug text-muted-foreground italic">&ldquo;{s.captionNote}&rdquo;</p>
                  )}
                  {s.verificationSummary?.course_shape && (
                    <p className="mt-1 text-xs leading-snug text-muted-foreground">
                      {s.verificationSummary.course_shape}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setExpanded(isExpanded ? null : s.id)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {isExpanded ? 'hide' : 'view'}
                  </button>
                  {!isRetired && onUseAsDraft && (
                    <button
                      type="button"
                      onClick={() => handleUseAsDraft(s.id)}
                      disabled={busy === s.id}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      use as draft
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleRetireToggle(s.id, isRetired)}
                    disabled={busy === s.id}
                    className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                  >
                    {isRetired ? 'restore' : 'retire'}
                  </button>
                </div>
              </div>
              {isExpanded && s.verificationSummary && (
                <div className="mt-3 rounded border bg-muted/30 px-3 py-2 text-xs space-y-2">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      What the course is developing
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {s.verificationSummary.strongest_evidence.map((it, i) => (
                        <li key={i} className="border-l-2 border-muted pl-2">{it}</li>
                      ))}
                    </ul>
                  </div>
                  {s.verificationSummary.dimensional_patterns.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Mixed signals
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {s.verificationSummary.dimensional_patterns.map((it, i) => (
                          <li key={i} className="border-l-2 border-muted pl-2">{it}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {s.verificationSummary.catalog_vs_evidence.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Catalog vs evidence
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {s.verificationSummary.catalog_vs_evidence.map((it, i) => (
                          <li key={i} className="border-l-2 border-muted pl-2">{it}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="text-muted-foreground">{s.verificationSummary.foundationals_glance}</p>
                </div>
              )}
              {isExpanded && !s.verificationSummary && (
                <p className="mt-3 rounded border bg-muted/30 px-3 py-2 text-xs italic text-muted-foreground">
                  This snapshot was created before the verification summary feature shipped. Re-Generate the profile and snapshot again to populate it.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
