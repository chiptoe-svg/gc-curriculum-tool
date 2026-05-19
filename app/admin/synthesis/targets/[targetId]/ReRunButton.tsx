'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  targetId: string;
  slug: string;
  stale: boolean;
  submissionsAvailable: boolean;
  lastRunCostCents: number | null;
}

function formatCents(c: number): string {
  // Cost is stored in 1/100 of a cent. Show in dollars to 4 decimals when small.
  const dollars = c / 10_000;
  if (dollars < 0.01) return `< $0.01`;
  return `$${dollars.toFixed(2)}`;
}

export function ReRunButton({ targetId, slug, stale, submissionsAvailable, lastRunCostCents }: Props) {
  const [pending, start] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const router = useRouter();

  function run() {
    setErrorMsg(null);
    start(async () => {
      const res = await fetch(`/api/admin/synthesis/${targetId}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setErrorMsg(`(${res.status}) ${json.error ?? 'Run failed'}`);
        return;
      }
      router.refresh();
    });
  }

  const disabled = pending || !submissionsAvailable;
  const tone = stale ? 'bg-amber-600 hover:bg-amber-700' : 'bg-slate-800 hover:bg-slate-900';

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={disabled}
        className={`rounded ${tone} px-4 py-2 text-sm font-medium text-white disabled:opacity-50`}
      >
        {pending ? 'Running synthesis…' : stale ? 'Run synthesis (stale)' : 'Re-run synthesis'}
      </button>
      <div className="text-xs text-slate-500">
        {lastRunCostCents != null ? `last run cost: ${formatCents(lastRunCostCents)}` : ''}
      </div>
      {errorMsg && <div className="text-xs text-red-700">{errorMsg}</div>}
      {!submissionsAvailable && (
        <div className="text-xs text-slate-500">No submissions yet.</div>
      )}
    </div>
  );
}
