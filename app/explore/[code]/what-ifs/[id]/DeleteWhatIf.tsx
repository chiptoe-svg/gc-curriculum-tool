'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiErrorText } from '@/lib/ai/credit-client';
import { WHAT_IF_COPY } from '@/lib/what-if/copy';

const btn = 'rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50';

/** Delete with the confirmation shown in the page (never a browser dialog). On success goes to the course's what-if list. */
export function DeleteWhatIf({
  courseCode,
  whatIfId,
  slug,
  disabled = false,
}: {
  courseCode: string;
  whatIfId: string;
  slug: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/explore/${encodeURIComponent(courseCode)}/what-ifs/${whatIfId}`, { method: 'DELETE' });
      if (!res.ok) {
        setError(apiErrorText(await res.json().catch(() => ({})), WHAT_IF_COPY.removeFailed));
        return;
      }
      router.push(`/explore/${encodeURIComponent(courseCode)}?slug=${encodeURIComponent(slug)}`);
    } catch {
      setError(WHAT_IF_COPY.removeFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {!confirming && (
        <button type="button" className={btn} disabled={disabled || busy} onClick={() => setConfirming(true)}>
          {WHAT_IF_COPY.remove}
        </button>
      )}
      {confirming && (
        <div role="alertdialog" aria-label={WHAT_IF_COPY.remove} className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          <p>{WHAT_IF_COPY.removeConfirm}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className={btn} disabled={busy} onClick={() => void remove()}>{WHAT_IF_COPY.removeYes}</button>
            <button type="button" className={btn} disabled={busy} onClick={() => setConfirming(false)}>{WHAT_IF_COPY.removeNo}</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
