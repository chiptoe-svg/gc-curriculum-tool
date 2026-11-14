'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiErrorText } from '@/lib/ai/credit-client';
import { WHAT_IF_COPY } from '@/lib/what-if/copy';
import { DeleteWhatIf } from './DeleteWhatIf';

const btn = 'rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50';

/** What the author (or an admin) can do on the page: update, rename, delete, go back to the conversation. */
export function WhatIfActions({
  courseCode,
  whatIfId,
  slug,
  title,
  canUpdate,
}: {
  courseCode: string;
  whatIfId: string;
  slug: string;
  title: string;
  /** False when the approved version it started from is withdrawn or gone. */
  canUpdate: boolean;
}) {
  const router = useRouter();
  const api = `/api/explore/${encodeURIComponent(courseCode)}/what-ifs/${whatIfId}`;
  const [busy, setBusy] = useState<'update' | 'rename' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(title);

  async function update() {
    setBusy('update');
    setError(null);
    try {
      const res = await fetch(`${api}/page`, { method: 'POST' });
      if (!res.ok) {
        setError(apiErrorText(await res.json().catch(() => ({})), WHAT_IF_COPY.pageFailed));
        return;
      }
      router.refresh();
    } catch {
      setError(WHAT_IF_COPY.pageFailed);
    } finally {
      setBusy(null);
    }
  }

  async function rename() {
    setBusy('rename');
    setError(null);
    try {
      const res = await fetch(api, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: draft.trim() }),
      });
      if (!res.ok) {
        setError(apiErrorText(await res.json().catch(() => ({})), WHAT_IF_COPY.renameFailed));
        return;
      }
      setRenaming(false);
      router.refresh();
    } catch {
      setError(WHAT_IF_COPY.renameFailed);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/explore/${encodeURIComponent(courseCode)}/what-ifs/${whatIfId}/talk?slug=${encodeURIComponent(slug)}`}
          className={btn}
        >
          {WHAT_IF_COPY.conversationLink}
        </Link>
        {canUpdate && (
          <button type="button" className={btn} disabled={busy !== null} onClick={() => void update()}>
            {WHAT_IF_COPY.update}
          </button>
        )}
        {!renaming && (
          <button type="button" className={btn} disabled={busy !== null} onClick={() => { setDraft(title); setRenaming(true); }}>
            {WHAT_IF_COPY.rename}
          </button>
        )}
        <DeleteWhatIf courseCode={courseCode} whatIfId={whatIfId} slug={slug} disabled={busy !== null} />
      </div>

      {busy === 'update' && <p className="text-sm text-muted-foreground">{WHAT_IF_COPY.updating}</p>}

      {renaming && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={e => { e.preventDefault(); if (draft.trim()) void rename(); }}
        >
          <label htmlFor="what-if-title" className="text-sm">{WHAT_IF_COPY.renameLabel}</label>
          <input
            id="what-if-title"
            value={draft}
            maxLength={120}
            onChange={e => setDraft(e.target.value)}
            className="min-w-[16rem] flex-1 rounded border border-input bg-background px-2 py-1.5 text-sm"
          />
          <button type="submit" className={btn} disabled={busy !== null || !draft.trim()}>{WHAT_IF_COPY.renameSave}</button>
          <button type="button" className={btn} onClick={() => setRenaming(false)}>{WHAT_IF_COPY.renameCancel}</button>
        </form>
      )}

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
