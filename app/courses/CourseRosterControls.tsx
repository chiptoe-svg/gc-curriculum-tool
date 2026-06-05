'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  slug: string;
}

type BulkResult = { created: string[]; skipped: string[] };
type OneResult = { ok: boolean };
type ApiError = { error: string };

export function CourseRosterControls({ slug }: Props) {
  const router = useRouter();

  // ── Bulk preload state ────────────────────────────────────────────────────
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkResult, setBulkResult] = useState<BulkResult | ApiError | null>(null);
  const [bulkPending, startBulk] = useTransition();

  // ── Add-a-course state ────────────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [addCode, setAddCode] = useState('');
  const [addTitle, setAddTitle] = useState('');
  const [addLevel, setAddLevel] = useState('');
  const [addTrack, setAddTrack] = useState('');
  const [addResult, setAddResult] = useState<OneResult | ApiError | null>(null);
  const [addPending, startAdd] = useTransition();

  // ── Bulk submit ──────────────────────────────────────────────────────────
  function submitBulk() {
    setBulkResult(null);
    startBulk(async () => {
      const res = await fetch(`/api/admin/courses/roster?slug=${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'bulk', text: bulkText }),
      });
      const json = await res.json();
      setBulkResult(json);
      if (res.ok) router.refresh();
    });
  }

  // ── One-course submit ────────────────────────────────────────────────────
  function submitOne() {
    setAddResult(null);
    startAdd(async () => {
      const body: Record<string, unknown> = { mode: 'one', code: addCode, title: addTitle };
      const level = parseInt(addLevel, 10);
      if (!isNaN(level)) body.level = level;
      if (addTrack.trim()) body.track = addTrack.trim();

      const res = await fetch(`/api/admin/courses/roster?slug=${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      setAddResult(json);
      if (res.ok) {
        setAddCode('');
        setAddTitle('');
        setAddLevel('');
        setAddTrack('');
        router.refresh();
      }
    });
  }

  const hasBulkError = bulkResult && 'error' in bulkResult;
  const hasBulkSuccess = bulkResult && 'created' in bulkResult;
  const hasAddError = addResult && 'error' in addResult;
  const hasAddSuccess = addResult && 'ok' in addResult && addResult.ok;

  return (
    <div className="mb-8 flex flex-wrap items-start gap-3">
      {/* ── Preload courses ───────────────────────────────────────────────── */}
      {!bulkOpen ? (
        <button
          onClick={() => setBulkOpen(true)}
          className="rounded-md border border-border bg-background px-3 py-1.5 font-body-sans text-[11px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          Preload courses
        </button>
      ) : (
        <div className="w-full rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-body-sans text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-medium">
              Preload courses
            </span>
            <button
              onClick={() => { setBulkOpen(false); setBulkText(''); setBulkResult(null); }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          </div>
          <p className="mb-2 font-body-sans text-[11px] text-muted-foreground">
            One course per line — <code className="font-mono-plex">CODE</code> or{' '}
            <code className="font-mono-plex">CODE — Title</code>. Em-dash, hyphen, comma, or tab all work.
          </p>
          <textarea
            value={bulkText}
            onChange={(e) => { setBulkText(e.target.value); setBulkResult(null); }}
            rows={6}
            placeholder={'GC 1000 — Intro to Graphic Communications\nGC 2100\nGC 3460 — Digital Media'}
            className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono-plex text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
          />

          {hasBulkSuccess && (
            <p className="mt-2 font-body-sans text-[11px] text-emerald-700 dark:text-emerald-400">
              Created {(bulkResult as BulkResult).created.length} ·{' '}
              skipped {(bulkResult as BulkResult).skipped.length} (already existed)
            </p>
          )}
          {hasBulkError && (
            <p className="mt-2 font-body-sans text-[11px] text-destructive">
              {(bulkResult as ApiError).error}
            </p>
          )}

          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              onClick={() => { setBulkText(''); setBulkResult(null); }}
              className="font-body-sans text-[11px] text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
            <button
              onClick={submitBulk}
              disabled={!bulkText.trim() || bulkPending}
              className="rounded-md bg-foreground px-3 py-1.5 font-body-sans text-[11px] uppercase tracking-[0.14em] text-background transition-opacity disabled:opacity-40"
            >
              {bulkPending ? 'Saving…' : 'Save roster'}
            </button>
          </div>
        </div>
      )}

      {/* ── Add a course ────────────────────────────────────────────────────── */}
      {!addOpen ? (
        <button
          onClick={() => setAddOpen(true)}
          className="rounded-md border border-border bg-background px-3 py-1.5 font-body-sans text-[11px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          + Add a course
        </button>
      ) : (
        <div className="w-full rounded-lg border border-border bg-card p-4 shadow-sm sm:w-auto sm:min-w-[22rem]">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-body-sans text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-medium">
              Add a course
            </span>
            <button
              onClick={() => { setAddOpen(false); setAddCode(''); setAddTitle(''); setAddLevel(''); setAddTrack(''); setAddResult(null); }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          </div>

          <div className="space-y-2">
            <input
              type="text"
              value={addCode}
              onChange={(e) => { setAddCode(e.target.value); setAddResult(null); }}
              placeholder="Course code (e.g. GC 3460)"
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 font-mono-plex text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <input
              type="text"
              value={addTitle}
              onChange={(e) => { setAddTitle(e.target.value); setAddResult(null); }}
              placeholder="Title (required)"
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 font-body-sans text-[12px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex gap-2">
              <input
                type="text"
                value={addLevel}
                onChange={(e) => { setAddLevel(e.target.value); setAddResult(null); }}
                placeholder="Level (1–4)"
                className="w-24 rounded-md border border-border bg-background px-3 py-1.5 font-mono-plex text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <input
                type="text"
                value={addTrack}
                onChange={(e) => { setAddTrack(e.target.value); setAddResult(null); }}
                placeholder="Track (optional)"
                className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 font-body-sans text-[12px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          {hasAddSuccess && (
            <p className="mt-2 font-body-sans text-[11px] text-emerald-700 dark:text-emerald-400">
              Course added.
            </p>
          )}
          {hasAddError && (
            <p className="mt-2 font-body-sans text-[11px] text-destructive">
              {(addResult as ApiError).error}
            </p>
          )}

          <div className="mt-3 flex items-center justify-end">
            <button
              onClick={submitOne}
              disabled={!addCode.trim() || !addTitle.trim() || addPending}
              className="rounded-md bg-foreground px-3 py-1.5 font-body-sans text-[11px] uppercase tracking-[0.14em] text-background transition-opacity disabled:opacity-40"
            >
              {addPending ? 'Adding…' : 'Add course'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
