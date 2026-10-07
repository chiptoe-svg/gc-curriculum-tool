'use client';

import { useEffect, useRef, useState } from 'react';
import type { CaptureMaterial } from './MaterialsPanel';
import type { Tier } from '@/lib/capture/material-tier';
import { estimateSeconds, estimateTotal, formatDuration } from '@/lib/capture/ingest-estimate';
import { fetchCourseMaterials } from '@/lib/capture/fetch-course-materials';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TriageStepProps {
  courseCode: string;
  slug: string;
  /** The course's live materials from CaptureClient state. */
  materials: CaptureMaterial[];
  onIngested: () => void;
  /** Return to Step 1 (import / confirm materials) — tier edits already persisted. */
  onBack: () => void;
}

const TIER_ORDER: Tier[] = ['background', 'middle', 'high'];

// H1 (security re-review #3, 2026-10-07): how long to poll on a cooldown
// 429 before giving up and handing control back to the user.
const COOLDOWN_POLL_CAP_MS = 5 * 60 * 1000;

function tierUp(current: Tier): Tier {
  const idx = TIER_ORDER.indexOf(current);
  return TIER_ORDER[Math.min(idx + 1, TIER_ORDER.length - 1)] ?? current;
}

function tierDown(current: Tier): Tier {
  const idx = TIER_ORDER.indexOf(current);
  return TIER_ORDER[Math.max(idx - 1, 0)] ?? current;
}

// Strip "Canvas File: " or "Canvas: " prefix for display.
function displayName(fileName: string): string {
  if (fileName.startsWith('Canvas File: ')) return fileName.slice('Canvas File: '.length);
  if (fileName.startsWith('Canvas: ')) return fileName.slice('Canvas: '.length);
  return fileName;
}

// ---------------------------------------------------------------------------
// Per-row state — extends CaptureMaterial with local UI flags
// ---------------------------------------------------------------------------

interface RowState extends CaptureMaterial {
  /** Resolved tier: null materials default to 'high'. */
  tier: Tier;
  pendingDelete: boolean;
}

function sizeDescriptor(row: RowState): string {
  if (row.pageCount != null) return `${row.pageCount} pages`;
  if (row.indexingStatus && row.indexingStatus !== 'pending') return row.indexingStatus;
  return row.mimeType.split('/')[1] ?? row.mimeType;
}

// ---------------------------------------------------------------------------
// Per-row sub-component
// ---------------------------------------------------------------------------

interface TriageRowProps {
  row: RowState;
  courseCode: string;
  slug: string;
  onUpdate: (id: string, patch: Partial<RowState>) => void;
  onRemove: (id: string) => void;
}

function TriageRow({ row, courseCode, slug, onUpdate, onRemove }: TriageRowProps) {
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const isHigh = row.tier === 'high';
  const isBackground = row.tier === 'background';

  async function moveTier(newTier: Tier): Promise<void> {
    setBusy(true);
    setRowError(null);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(courseCode)}/materials/${encodeURIComponent(row.id)}?slug=${encodeURIComponent(slug)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tier: newTier }),
        },
      );
      if (!res.ok) { setRowError(`Failed (${res.status})`); return; }
      // The server sets an already-read file back to unread when its level
      // changes, so the step reads it again at the new depth.
      const json = (await res.json().catch(() => ({}))) as { indexingStatus?: RowState['indexingStatus'] | null };
      onUpdate(row.id, json.indexingStatus ? { tier: newTier, indexingStatus: json.indexingStatus } : { tier: newTier });
    } finally {
      setBusy(false);
    }
  }

  async function toggleIgnored(): Promise<void> {
    setBusy(true);
    setRowError(null);
    const next = !row.ignored;
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(courseCode)}/materials/${encodeURIComponent(row.id)}?slug=${encodeURIComponent(slug)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ignored: next }),
        },
      );
      if (!res.ok) { setRowError(`Failed (${res.status})`); return; }
      onUpdate(row.id, { ignored: next });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!row.pendingDelete) {
      // First click: enter confirm state
      onUpdate(row.id, { pendingDelete: true });
      return;
    }
    // Second click: actually delete
    setBusy(true);
    setRowError(null);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(courseCode)}/materials/${encodeURIComponent(row.id)}?slug=${encodeURIComponent(slug)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        // Reset confirm state so the row isn't stuck — the error shows below.
        onUpdate(row.id, { pendingDelete: false });
        setRowError(`Failed (${res.status})`);
        return;
      }
      onRemove(row.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={'flex flex-col gap-1 px-3 py-2.5 ' + (row.ignored ? 'opacity-50' : '')}>
      <div className="flex items-center gap-2">
        <span
          className={'min-w-0 flex-1 truncate text-sm ' + (row.ignored ? 'line-through text-muted-foreground' : '')}
        >
          {displayName(row.fileName)}
        </span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {sizeDescriptor(row)}
        </span>
        <span className="rounded bg-muted/60 px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
          {formatDuration(estimateSeconds(row))}
        </span>

        {/* Move up — hidden in high tier */}
        {!isHigh && (
          <button
            type="button"
            aria-label="move up"
            onClick={() => void moveTier(tierUp(row.tier))}
            disabled={busy}
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
            title="Read this more closely"
          >
            ▲
          </button>
        )}

        {/* Move down — hidden in background tier */}
        {!isBackground && (
          <button
            type="button"
            aria-label="move down"
            onClick={() => void moveTier(tierDown(row.tier))}
            disabled={busy}
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
            title="Read this more lightly"
          >
            ▼
          </button>
        )}

        {/* Ignore / Include toggle */}
        <button
          type="button"
          onClick={() => void toggleIgnored()}
          disabled={busy}
          className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
        >
          {row.ignored ? 'include' : 'ignore'}
        </button>

        {/* Delete — inline confirm pattern */}
        {row.pendingDelete ? (
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={busy}
            className="shrink-0 text-xs font-semibold text-destructive underline-offset-2 hover:underline disabled:opacity-30"
          >
            confirm
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={busy}
            className="shrink-0 text-xs text-muted-foreground hover:text-destructive disabled:opacity-30"
          >
            delete
          </button>
        )}
      </div>

      {rowError && <p className="pl-6 text-xs text-destructive">{rowError}</p>}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Tier section card
// ---------------------------------------------------------------------------

// Plain words (owner, 2026-10-07): each level is named by what the tool does
// with the file, and says what it is for.
const TIER_CONFIG: Record<Tier, { label: string; sublabel: string }> = {
  high: {
    label: 'High: read in full',
    sublabel: 'Every detail is kept and can be quoted as evidence. Use for the syllabus and anything graded.',
  },
  middle: {
    label: 'Middle: summarized slide by slide',
    sublabel: 'Each slide or section becomes a short note of what it teaches. Use for lecture slides and class pages.',
  },
  background: {
    label: 'Background: one summary',
    sublabel: "The tool knows what the file covers but won't quote it. Use for readings and references.",
  },
};

interface TierSectionProps {
  tier: Tier;
  rows: RowState[];
  courseCode: string;
  slug: string;
  onUpdate: (id: string, patch: Partial<RowState>) => void;
  onRemove: (id: string) => void;
}

function TierSection({ tier, rows, courseCode, slug, onUpdate, onRemove }: TierSectionProps) {
  const cfg = TIER_CONFIG[tier];
  return (
    <section className="rounded-md border bg-card">
      <header className="px-3 py-2 border-b bg-muted/30">
        <h3 className="text-sm font-semibold text-foreground">{cfg.label}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{cfg.sublabel}</p>
      </header>
      {rows.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground italic">No materials in this tier.</p>
      ) : (
        <ul className="divide-y">
          {rows.map((row) => (
            <TriageRow
              key={row.id}
              row={row}
              courseCode={courseCode}
              slug={slug}
              onUpdate={onUpdate}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TriageStep({ courseCode, slug, materials, onIngested, onBack }: TriageStepProps) {
  // Initialise local row state from live materials.
  // null-tier materials default to 'high' (full pipeline = current behavior).
  const [rows, setRows] = useState<RowState[]>(
    materials.map((m) => ({
      ...m,
      tier: (m.tier ?? 'high') as Tier,
      pendingDelete: false,
    })),
  );
  const [phase, setPhase] = useState<'idle' | 'ingesting' | 'done'>('idle');
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ total: number; terminal: number; ready: number; failed: number; skipped: number }>(
    { total: 0, terminal: 0, ready: 0, failed: 0, skipped: 0 },
  );
  const [useLocal, setUseLocal] = useState(false);

  // Tiers are classified in the background after upload (see the materials POST
  // route's after()), so a file added moments before reaching this step may still
  // have a null tier in the props snapshot (rendered as 'high'). Refetch on mount
  // and poll briefly until every tier has settled, adopting the server's tiers —
  // but stop the moment the faculty member moves/removes anything, so we never
  // clobber a deliberate adjustment.
  const userTouched = useRef(false);
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const sync = async () => {
      if (cancelled || userTouched.current) return;
      const fresh = await fetchCourseMaterials(courseCode, slug);
      if (cancelled || userTouched.current || !fresh) return;
      setRows(fresh.map((m) => ({ ...m, tier: (m.tier ?? 'high') as Tier, pendingDelete: false })));
      tries += 1;
      if (fresh.some((m) => m.tier == null) && tries < 6) {
        setTimeout(() => { void sync(); }, 1500);
      }
    };
    void sync();
    return () => { cancelled = true; };
  }, [courseCode, slug]);

  function handleUpdate(id: string, patch: Partial<RowState>): void {
    userTouched.current = true;
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function handleRemove(id: string): void {
    userTouched.current = true;
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  const highRows = rows.filter((r) => r.tier === 'high');
  const middleRows = rows.filter((r) => r.tier === 'middle');
  const backgroundRows = rows.filter((r) => r.tier === 'background');

  // Slides nudge: show when no material has tier==='middle'.
  const showSlidesNudge = middleRows.length === 0;

  // Only files not yet read count toward the estimate (owner, 2026-10-07: an
  // already-read course showed "~1–3 min" and then "Done reading (0 ready)").
  const unreadRows = rows.filter((r) => !r.ignored && r.indexingStatus !== 'ready');
  const allRead = unreadRows.length === 0;
  const total = estimateTotal(unreadRows);

  async function handleIngest(): Promise<void> {
    // Nothing left to read: go straight on — no second click.
    if (allRead) { onIngested(); return; }
    setPhase('ingesting');
    setIngestError(null);
    try {
      const res = await fetch(
        `/api/capture/${encodeURIComponent(courseCode)}/ingest?slug=${encodeURIComponent(slug)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: useLocal ? 'local' : 'hybrid' }),
        },
      );
      if (res.status === 429) {
        const body = await res.json().catch(() => ({})) as { error?: string; reason?: string };
        if (body.reason === 'cooldown') {
          // G4/H1 (security re-review, 2026-10-07): the per-course ingest
          // cooldown is active — almost always a co-instructor's
          // concurrent "Read files & continue" already started reading
          // these same materials. That's not a failure: poll for
          // completion. Only rows actually 'queued'/'indexing' right now
          // are worth waiting on — a merely 'pending' row was never
          // queued by anyone (e.g. it has neither text nor a local blob
          // to read) and would otherwise poll forever (H1).
          const activeIds = unreadRows
            .filter(r => r.indexingStatus === 'queued' || r.indexingStatus === 'indexing')
            .map(r => r.id);
          if (activeIds.length === 0) {
            // Nothing is actually in flight to wait for.
            onIngested();
            return;
          }
          void pollUntilDone(activeIds, { maxWaitMs: COOLDOWN_POLL_CAP_MS });
          return;
        }
        // Any other 429 (e.g. the shared per-IP rate limit) is a real
        // "come back later," not "someone else is reading" — show a
        // generic message and re-enable the button rather than polling
        // indefinitely for work nobody queued (H1).
        setIngestError('Too many requests — wait a minute and try again');
        setPhase('idle');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setIngestError(body.error ?? `Failed (${res.status})`);
        setPhase('idle');
        return;
      }
      const data = await res.json().catch(() => ({})) as { results?: Array<{ id: string; status: string }> };
      const queuedIds = (data.results ?? []).filter(r => r.status === 'queued').map(r => r.id);
      if (queuedIds.length === 0) {
        // Nothing needed reading after all — go on to the interview.
        onIngested();
        return;
      }
      void pollUntilDone(queuedIds);
    } catch (e) {
      setIngestError(e instanceof Error ? e.message : 'Ingest failed');
      setPhase('idle');
    }
  }

  async function pollUntilDone(ids: string[], opts: { maxWaitMs?: number } = {}): Promise<void> {
    const deadline = opts.maxWaitMs !== undefined ? Date.now() + opts.maxWaitMs : null;
    const tick = async (): Promise<void> => {
      const fresh = await fetchCourseMaterials(courseCode, slug);
      const byId = new Map((fresh ?? []).map(m => [m.id, m.indexingStatus]));
      let ready = 0, failed = 0, skipped = 0, terminal = 0;
      for (const id of ids) {
        const s = byId.get(id);
        if (s === 'ready') { ready++; terminal++; }
        else if (s === 'failed') { failed++; terminal++; }
        else if (s === 'skipped') { skipped++; terminal++; }
      }
      setProgress({ total: ids.length, terminal, ready, failed, skipped });
      if (terminal >= ids.length) {
        // Clean run: carry on by itself. Stop only when a file needs attention.
        if (failed === 0 && skipped === 0) { onIngested(); return; }
        setPhase('done');
        return;
      }
      // H1 (security re-review #3, 2026-10-07): a capped poll (the
      // cooldown path) must not spin forever if the other caller's job
      // never finishes (stuck worker, crashed process, etc.) — give up
      // after the cap and hand control back to the user instead of
      // showing "Reading…" indefinitely with no way out.
      if (deadline !== null && Date.now() >= deadline) {
        setIngestError('Still reading — check back in a few minutes or reload');
        setPhase('idle');
        return;
      }
      setTimeout(() => { void tick(); }, 3000);
    };
    await tick();
  }

  return (
    <div className="rounded-lg border bg-card p-6">
      {/* Mono-caps step header — matches CaptureMaterialsStep pattern. Back button
          returns to Step 1 (import); tier edits are PATCHed as they're made, so
          nothing is lost on the round trip. */}
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-mono-plex text-xs uppercase tracking-[0.18em] text-muted-foreground">
          <span>Step 2 of 3 · Choose how closely to read each file</span>
          <span aria-hidden className="text-foreground">●</span>
          <span aria-hidden>──</span>
          <span aria-hidden>○</span>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
        >
          ← Back to materials
        </button>
      </div>

      <h2 className="font-display text-xl font-semibold tracking-tight">
        What should we pull in, and how deeply?
      </h2>
      <div
        role="note"
        aria-label="About this step"
        className="mt-3 space-y-2 rounded-md border-l-4 border-amber-500 bg-background px-4 py-3 text-base leading-relaxed"
      >
        <p>
          <strong>What happens next:</strong> the tool reads each file below so the interview can ask
          about your course, and the profile can point to real evidence.
        </p>
        <p>
          <strong>Your job:</strong> check that each file sits at the right level. We&apos;ve made a first
          guess. Use ▲ ▼ to move a file, <em>ignore</em> to leave it out, and <em>delete</em> to remove it.
        </p>
        <p>
          <strong>Why it matters:</strong> scores above the basics need evidence that students actually
          did the work. Anything graded (the syllabus, assignments, rubrics, quizzes, exams) should be{' '}
          <strong>High</strong>, or it can&apos;t count as evidence. Deeper reading takes longer, so leave
          readings and reference files at Background.
        </p>
      </div>

      {/* Tier sections */}
      <div className="mt-4 space-y-3">
        <TierSection
          tier="high"
          rows={highRows}
          courseCode={courseCode}
          slug={slug}
          onUpdate={handleUpdate}
          onRemove={handleRemove}
        />
        <TierSection
          tier="middle"
          rows={middleRows}
          courseCode={courseCode}
          slug={slug}
          onUpdate={handleUpdate}
          onRemove={handleRemove}
        />
        <TierSection
          tier="background"
          rows={backgroundRows}
          courseCode={courseCode}
          slug={slug}
          onUpdate={handleUpdate}
          onRemove={handleRemove}
        />
      </div>

      {/* Slides nudge — only when no middle-tier rows */}
      {showSlidesNudge && (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50/50 px-3 py-2">
          <span aria-hidden>💡</span>
          <p className="text-sm text-amber-800">
            For the strongest, most complete capture, add your lecture slides — they&apos;re the richest
            evidence of what you actually taught in class. Go{' '}
            <button
              type="button"
              onClick={onBack}
              className="font-medium underline underline-offset-2 hover:text-amber-700"
            >
              ← Back to materials
            </button>{' '}
            to upload them.
          </p>
        </div>
      )}

      {/* Ingest error */}
      {ingestError && (
        <p className="mt-3 text-sm text-destructive">{ingestError}</p>
      )}

      {/* Total estimate + primary action */}
      <div className="mt-6 flex flex-col items-end gap-1.5">
        {!allRead && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={useLocal}
              onChange={(e) => setUseLocal(e.target.checked)}
              disabled={phase !== 'idle'}
            />
            <span>Use local/free models — no API cost, nothing leaves campus</span>
          </label>
        )}
        {useLocal && !allRead && (
          <p className="text-xs text-amber-700/80">May run longer for scanned/image PDFs.</p>
        )}
        {phase === 'idle' && (
          <p className="max-w-md text-right text-sm text-muted-foreground">
            {allRead ? (
              <>All files are already read.</>
            ) : (
              <>
                When you click <strong>Read files &amp; continue</strong>, this takes about{' '}
                <span className="font-medium">{total.label}</span> (a rough estimate, 2 files at a time).
                When it finishes, you&apos;ll go on to the interview automatically.
              </>
            )}
          </p>
        )}
        {phase === 'idle' && (
          <button
            type="button"
            onClick={() => void handleIngest()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            {allRead ? 'Continue to interview →' : <>Read files &amp; continue →</>}
          </button>
        )}
        {phase === 'ingesting' && (
          <div className="w-full max-w-xs text-right">
            <p className="text-sm text-muted-foreground">
              Reading file {progress.terminal} of {progress.total}…
            </p>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${progress.total ? Math.round((progress.terminal / progress.total) * 100) : 0}%` }}
              />
            </div>
          </div>
        )}
        {phase === 'done' && (
          <div className="flex flex-col items-end gap-1.5">
            <p className="max-w-md text-right text-sm text-amber-800">
              Done reading: {progress.ready} read
              {progress.failed ? `, ${progress.failed} file${progress.failed === 1 ? '' : 's'} couldn't be read` : ''}
              {progress.skipped ? `, ${progress.skipped} skipped` : ''}. You can go back to fix
              {progress.failed + progress.skipped === 1 ? ' it' : ' them'}, or continue without.
            </p>
            <button
              type="button"
              onClick={() => onIngested()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Continue to interview →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
