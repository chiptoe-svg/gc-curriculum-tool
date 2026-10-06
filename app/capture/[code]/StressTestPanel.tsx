'use client';

import type { StressTestResultType } from '@/lib/ai/stress-test/schema';
import type { StressTestTelemetry } from './useStressTest';
import { plainDepth } from '@/lib/capture/plain-depth';

interface Props {
  result: StressTestResultType;
  telemetry: StressTestTelemetry | null;
}

const OVERALL: Record<string, { label: string; tone: string }> = {
  sound: { label: 'The profile holds up', tone: 'bg-emerald-50 text-emerald-900 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-800' },
  mixed: { label: 'Mostly holds up, with some doubts', tone: 'bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800' },
  questionable: { label: 'Several scores look doubtful', tone: 'bg-red-50 text-red-900 border-red-300 dark:bg-red-900/30 dark:text-red-200 dark:border-red-800' },
};

/**
 * Profile-level findings from the automatic stress test (a second AI reviewer
 * that reads the generated profile). Display only — the request lives in
 * useStressTest (owned by CaptureClient); per-card findings become the
 * "Worth a look" flags. Advisory: never modifies the draft. Text passes
 * through plainDepth so score codes the reviewer writes read as words.
 */
export function StressTestPanel({ result, telemetry }: Props) {
  const overall = OVERALL[result.overall_assessment] ?? OVERALL.mixed!;
  return (
    <section className="rounded-md border bg-card px-4 py-3 shadow-sm space-y-3">
      <h3 className="text-sm font-semibold text-foreground">What the second reviewer noticed</h3>
      <div className={`rounded border px-3 py-2 text-sm ${overall.tone}`}>
        <p className="font-semibold">{overall.label}</p>
        <p className="mt-1 leading-relaxed">{plainDepth(result.summary)}</p>
      </div>

      <ConcernList label="Catalog versus evidence" items={result.profile_level.catalog_vs_evidence_concerns} />
      <ConcernList label="Consistency" items={result.profile_level.consistency_concerns} />
      <ConcernList label="Coverage" items={result.profile_level.coverage_concerns} />

      {telemetry && (
        <p className="text-xs text-muted-foreground">
          {telemetry.model} · ${(telemetry.costUsdCents / 10000).toFixed(4)} · {(telemetry.durationMs / 1000).toFixed(1)}s
        </p>
      )}
    </section>
  );
}

function ConcernList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-sm font-semibold text-foreground">{label}</p>
      <ul className="mt-1 space-y-1">
        {items.map((it, i) => (
          <li key={i} className="border-l-2 border-muted pl-3 text-sm leading-relaxed text-foreground">
            {plainDepth(it)}
          </li>
        ))}
      </ul>
    </div>
  );
}
