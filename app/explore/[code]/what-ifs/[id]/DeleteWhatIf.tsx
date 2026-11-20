'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiErrorText } from '@/lib/ai/credit-client';
import { WHAT_IF_COPY } from '@/lib/what-if/copy';

const btn = 'ex-btn ex-btn-sm';

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
        <div role="alertdialog" aria-label={WHAT_IF_COPY.remove} className="ex-alert">
          <div><p>{WHAT_IF_COPY.removeConfirm}</p>
          <div className="ex-row mt-2">
            <button type="button" className={btn} disabled={busy} onClick={() => void remove()}>{WHAT_IF_COPY.removeYes}</button>
            <button type="button" className={btn} disabled={busy} onClick={() => setConfirming(false)}>{WHAT_IF_COPY.removeNo}</button>
          </div></div>
        </div>
      )}
      {error && <p role="alert" className="ex-err mt-2">{error}</p>}
    </div>
  );
}
