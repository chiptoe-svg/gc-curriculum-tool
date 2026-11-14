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
    <div className="space-y-2 rounded-md border border-dashed bg-muted/20 px-4 py-3">
      <p className="text-sm text-muted-foreground">{WHAT_IF_COPY.startLine}</p>
      {needsName && (
        <div className="max-w-xs space-y-1">
          <label htmlFor="what-if-author" className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {WHAT_IF_COPY.startNameLabel}
          </label>
          <InstructorSelect id="what-if-author" value={name} onChange={v => { setName(v); setNameMissing(false); }} />
          {nameMissing && <p role="alert" className="text-xs text-destructive">{WHAT_IF_COPY.startNameNeeded}</p>}
        </div>
      )}
      <button
        type="button"
        onClick={() => void start()}
        disabled={busy}
        className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
      >
        {busy ? WHAT_IF_COPY.starting : WHAT_IF_COPY.startButton}
      </button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
