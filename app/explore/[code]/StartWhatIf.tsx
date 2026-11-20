'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiErrorText } from '@/lib/ai/credit-client';
import { WHAT_IF_COPY } from '@/lib/what-if/copy';
import { InstructorSelect } from '@/app/capture/[code]/InstructorSelect';

/**
 * The start control. Set apart from the interview's revision choices: those answer
 * "what has changed", a what-if is about something that has not happened. A personal
 * access link names the author; the shared department login names nobody, so it asks.
 */
export function StartWhatIf({
  courseCode,
  slug,
  defaultName,
}: {
  courseCode: string;
  slug: string;
  /** The name on the viewer's personal link; null under the department login. */
  defaultName: string | null;
}) {
  const router = useRouter();
  const needsName = defaultName === null;
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameMissing, setNameMissing] = useState(false);

  async function start() {
    if (needsName && !name.trim()) { setNameMissing(true); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/explore/${encodeURIComponent(courseCode)}/what-ifs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(needsName ? { authorName: name.trim() } : {}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || typeof json.id !== 'string') {
        setError(apiErrorText(json, WHAT_IF_COPY.startFailed));
        return;
      }
      router.push(`/explore/${encodeURIComponent(courseCode)}/what-ifs/${json.id}/talk?slug=${encodeURIComponent(slug)}`);
    } catch {
      setError(WHAT_IF_COPY.startFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ex-dashed">
      <p className="ex-meta">{WHAT_IF_COPY.startLine}</p>
      {needsName && (
        <div className="max-w-xs">
          <label htmlFor="what-if-author" className="ex-label mb-1">
            {WHAT_IF_COPY.startNameLabel}
          </label>
          <InstructorSelect id="what-if-author" className="ex-input" value={name} onChange={v => { setName(v); setNameMissing(false); }} />
          {nameMissing && <p role="alert" className="ex-err mt-1">{WHAT_IF_COPY.startNameNeeded}</p>}
        </div>
      )}
      <button
        type="button"
        onClick={() => void start()}
        disabled={busy}
        className="ex-btn ex-btn-primary self-start"
      >
        {busy ? WHAT_IF_COPY.starting : WHAT_IF_COPY.startButton}
      </button>
      {error && <p role="alert" className="ex-err">{error}</p>}
    </div>
  );
}
