'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface LastRunMeta {
  id: string;
  createdAt: string;
  materialCount: number;
  costUsdCents: number;
}

export interface CourseAnalyzeZoneProps {
  slug: string;
  courseCode: string;
  okCount: number;
  lastRun: LastRunMeta | null;
  manuallyEdited: boolean;
  onAnalyzed: () => void;
}

export function CourseAnalyzeZone({
  slug,
  courseCode,
  okCount,
  lastRun,
  manuallyEdited,
  onAnalyzed,
}: CourseAnalyzeZoneProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyze() {
    setLoading(true);
    setError(null);
    try {
      const encoded = encodeURIComponent(courseCode);
      const res = await fetch(`/api/courses/${encoded}/analyze-materials?slug=${slug}`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok) {
        setError((json as { error?: string }).error ?? 'Analysis failed');
        return;
      }
      router.refresh();
      onAnalyzed();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unexpected error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-lg border bg-card p-5 space-y-3">
      <h2 className="text-base font-semibold">Analyze</h2>

      {manuallyEdited && (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          Your edits will be replaced by the new analysis. Previous versions are preserved in history.
        </p>
      )}

      {lastRun && (
        <div className="text-sm text-muted-foreground space-y-0.5">
          <p>
            Last run:{' '}
            <time dateTime={lastRun.createdAt}>
              {new Date(lastRun.createdAt).toLocaleString()}
            </time>
          </p>
          <p>{lastRun.materialCount} files &middot; {lastRun.costUsdCents}¢</p>
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <button
        type="button"
        disabled={okCount === 0 || loading}
        onClick={handleAnalyze}
        className="inline-flex items-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Analyzing…' : 'Analyze materials'}
      </button>

      {okCount === 0 && (
        <p className="text-xs text-muted-foreground">
          Upload files and wait for extraction before analyzing.
        </p>
      )}
    </section>
  );
}
