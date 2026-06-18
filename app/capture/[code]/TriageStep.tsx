'use client';

import { useState } from 'react';
import type { CaptureMaterial } from './MaterialsPanel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TriageStepProps {
  courseCode: string;
  slug: string;
  /** The course's live materials from CaptureClient state. */
  materials: CaptureMaterial[];
  onIngested: () => void;
}

type Tier = 'high' | 'middle' | 'background';

const TIER_ORDER: Tier[] = ['background', 'middle', 'high'];

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
      onUpdate(row.id, { tier: newTier });
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
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {sizeDescriptor(row)}
        </span>

        {/* Move up — hidden in high tier */}
        {!isHigh && (
          <button
            type="button"
            aria-label="move up"
            onClick={() => void moveTier(tierUp(row.tier))}
            disabled={busy}
            className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-30"
            title="Move to higher tier"
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
            className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-30"
            title="Move to lower tier"
          >
            ▼
          </button>
        )}

        {/* Ignore / Include toggle */}
        <button
          type="button"
          onClick={() => void toggleIgnored()}
          disabled={busy}
          className="shrink-0 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
        >
          {row.ignored ? 'include' : 'ignore'}
        </button>

        {/* Delete — inline confirm pattern */}
        {row.pendingDelete ? (
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={busy}
            className="shrink-0 text-[11px] font-semibold text-destructive underline-offset-2 hover:underline disabled:opacity-30"
          >
            confirm
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={busy}
            className="shrink-0 text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-30"
          >
            delete
          </button>
        )}
      </div>

      {rowError && <p className="pl-6 text-[11px] text-destructive">{rowError}</p>}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Tier section card
// ---------------------------------------------------------------------------

const TIER_CONFIG: Record<Tier, { label: string; sublabel: string }> = {
  high: { label: 'HIGH VALUE', sublabel: 'full detail' },
  middle: { label: 'MIDDLE', sublabel: 'per-slide / per-section summaries' },
  background: { label: 'BACKGROUND', sublabel: 'one summary each' },
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
        <span className="font-mono-plex text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          {cfg.label}
        </span>
        <span className="ml-1 text-[11px] text-muted-foreground">— {cfg.sublabel}</span>
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

export function TriageStep({ courseCode, slug, materials, onIngested }: TriageStepProps) {
  // Initialise local row state from live materials.
  // null-tier materials default to 'high' (full pipeline = current behavior).
  const [rows, setRows] = useState<RowState[]>(
    materials.map((m) => ({
      ...m,
      tier: (m.tier ?? 'high') as Tier,
      pendingDelete: false,
    })),
  );
  const [ingesting, setIngesting] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);

  function handleUpdate(id: string, patch: Partial<RowState>): void {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function handleRemove(id: string): void {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  const highRows = rows.filter((r) => r.tier === 'high');
  const middleRows = rows.filter((r) => r.tier === 'middle');
  const backgroundRows = rows.filter((r) => r.tier === 'background');

  // Slides nudge: show when no material has tier==='middle'.
  const showSlidesNudge = middleRows.length === 0;

  async function handleIngest(): Promise<void> {
    setIngesting(true);
    setIngestError(null);
    try {
      const res = await fetch('/api/admin/v2-backfill', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ courseCode, slug }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setIngestError(body.error ?? `Failed (${res.status})`);
        return;
      }
      onIngested();
    } catch (e) {
      setIngestError(e instanceof Error ? e.message : 'Ingest failed');
    } finally {
      setIngesting(false);
    }
  }

  return (
    <div className="rounded-lg border bg-card p-6">
      {/* Mono-caps step header — matches CaptureMaterialsStep pattern */}
      <div className="mb-1 flex items-center gap-2 font-mono-plex text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        <span>Step 2 of 3 · Triage materials</span>
        <span aria-hidden className="text-foreground">●</span>
        <span aria-hidden>──</span>
        <span aria-hidden>○</span>
      </div>

      <h2 className="font-display text-xl font-semibold tracking-tight">
        What should we pull in, and how deeply?
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        High = every detail · Middle = per-slide/section summaries · Background = one summary
      </p>

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
            No lecture slides found — they&apos;re some of the best evidence of what you taught.{' '}
            <button
              type="button"
              /* TODO: wire to file-upload flow (Increment N); stubbed for now */
              title="Routes to file upload — not yet wired in this increment"
              className="font-medium underline underline-offset-2 hover:text-amber-700"
            >
              Add slides
            </button>
          </p>
        </div>
      )}

      {/* Ingest error */}
      {ingestError && (
        <p className="mt-3 text-sm text-destructive">{ingestError}</p>
      )}

      {/* Primary action */}
      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={() => void handleIngest()}
          disabled={ingesting}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {ingesting ? 'Ingesting…' : 'Ingest & continue →'}
        </button>
      </div>
    </div>
  );
}
