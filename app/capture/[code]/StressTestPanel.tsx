'use client';

import { useState } from 'react';
import type { StressTestResultType } from '@/lib/ai/stress-test/schema';

interface Props {
  courseCode: string;
  slug: string;
  /**
   * Called when a stress-test run completes successfully with the new
   * result. Lets the parent (ProfileReviewPanel) thread per-competency
   * annotations down to each row.
   */
  onResult: (result: StressTestResultType | null) => void;
}

/**
 * Stand-alone panel that owns the stress-test button + the profile-level
 * concerns display. Per-competency annotations are rendered by
 * ProfileReviewPanel via the onResult callback (the parent holds the
 * result and threads per-row annotations to <StressTestBadge>).
 *
 * The result is ephemeral — held only in the parent's state, cleared
 * when the user edits the profile (parent clears via onResult(null)).
 */
export function StressTestPanel({ courseCode, slug, onResult }: Props) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StressTestResultType | null>(null);
  const [telemetry, setTelemetry] = useState<{ costUsdCents: number; durationMs: number; model: string } | null>(null);

  async function handleRun() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/capture/${encodeURIComponent(courseCode)}/stress-test?slug=${encodeURIComponent(slug)}`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      );
      const json = await res.json() as { result?: StressTestResultType; telemetry?: { costUsdCents: number; durationMs: number; model: string }; error?: string; detail?: string };
      if (!res.ok || !json.result) {
        setError(json.error ? `${json.error}${json.detail ? ' — ' + json.detail : ''}` : `Stress-test failed (${res.status})`);
        setResult(null);
        onResult(null);
        return;
      }
      setResult(json.result);
      onResult(json.result);
      if (json.telemetry) setTelemetry(json.telemetry);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setResult(null);
      onResult(null);
    } finally {
      setRunning(false);
    }
  }

  const toneByOverall: Record<string, string> = {
    sound: 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-800',
    mixed: 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800',
    questionable: 'bg-red-100 text-red-900 border-red-300 dark:bg-red-900/30 dark:text-red-200 dark:border-red-800',
  };

  return (
    <section className="rounded-md border bg-card px-4 py-3 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Stress-test this profile</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Runs an adversarial reviewer agent over this profile. Heavy-tier
            model; results are advisory and never modify the draft. One click
            ≈ $0.05–0.20.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleRun()}
          disabled={running}
          className="shrink-0 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          {running ? 'Reviewing…' : result ? 'Re-run' : 'Stress-test'}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-200">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-3 space-y-3">
          <div className={`rounded border px-3 py-2 text-xs ${toneByOverall[result.overall_assessment] ?? ''}`}>
            <p className="font-mono-plex text-[10px] uppercase tracking-[0.18em]">
              Overall: {result.overall_assessment}
            </p>
            <p className="mt-1 leading-relaxed">{result.summary}</p>
          </div>

          <ProfileConcernList
            label="Catalog-vs-evidence concerns"
            items={result.profile_level.catalog_vs_evidence_concerns}
          />
          <ProfileConcernList
            label="Consistency concerns"
            items={result.profile_level.consistency_concerns}
          />
          <ProfileConcernList
            label="Coverage concerns"
            items={result.profile_level.coverage_concerns}
          />

          {telemetry && (
            <p className="text-[10px] text-muted-foreground">
              {telemetry.model} · ${(telemetry.costUsdCents / 10000).toFixed(4)} · {(telemetry.durationMs / 1000).toFixed(1)}s
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function ProfileConcernList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) {
    return (
      <div>
        <p className="font-mono-plex text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-xs italic text-muted-foreground">(none surfaced)</p>
      </div>
    );
  }
  return (
    <div>
      <p className="font-mono-plex text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <ul className="mt-0.5 space-y-1">
        {items.map((it, i) => (
          <li key={i} className="text-xs leading-relaxed text-foreground">
            — {it}
          </li>
        ))}
      </ul>
    </div>
  );
}
