'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface RunMeta {
  id: string;
  courseCode: string;
  materialCount: number;
  model: string;
  costUsdCents: number;
  createdAt: string; // ISO string
}

interface Props {
  runs: RunMeta[];
  slug: string;
  courseCode: string;
  currentRunId: string | null;
}

export function ProfileRunHistory({ runs, slug, courseCode, currentRunId }: Props) {
  const router = useRouter();
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (runs.length === 0) return null;

  async function handleRestore(runId: string) {
    setRestoringId(runId);
    setError(null);
    try {
      const encoded = encodeURIComponent(courseCode);
      const res = await fetch(
        `/api/courses/${encoded}/profile/restore/${runId}?slug=${slug}`,
        { method: 'POST' }
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        setError(`Restore failed: ${json.error ?? res.status}`);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Restore failed');
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <section className="rounded-lg border bg-card p-5 space-y-3">
      <h2 className="text-base font-semibold">Run history</h2>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="space-y-2">
        {runs.map((run) => {
          const isCurrent = run.id === currentRunId;
          const isRestoring = restoringId === run.id;
          return (
            <div
              key={run.id}
              className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2">
                  <time
                    dateTime={run.createdAt}
                    className="font-medium tabular-nums"
                  >
                    {new Date(run.createdAt).toLocaleString()}
                  </time>
                  {isCurrent && (
                    <span className="inline-flex items-center rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                      Current
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {run.materialCount} files &middot; ${(run.costUsdCents / 10000).toFixed(2)} &middot; {run.model}
                </p>
              </div>
              {!isCurrent && (
                <button
                  type="button"
                  disabled={isRestoring || restoringId !== null}
                  onClick={() => handleRestore(run.id)}
                  className="shrink-0 inline-flex items-center rounded-md border border-input bg-background px-3 py-1 text-xs font-medium shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isRestoring ? 'Restoring…' : 'Restore'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
