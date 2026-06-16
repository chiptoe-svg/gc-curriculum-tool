'use client';

import { useMemo, useRef, useState } from 'react';
import { IndexingStatusDot, type CaptureMaterial, type CourseCatalogView } from '../MaterialsPanel';
import { fetchCourseMaterials } from '@/lib/capture/fetch-course-materials';
import {
  materialsByBox, materialProvenance, PROVENANCE_LABEL,
  materialReadability, hasFixablyUnindexed,
  estimateMaterialTokens, formatMaterialTokens, formatMaterialBytes,
} from '@/lib/capture/material-display';

interface Props {
  course: CourseCatalogView;
  materials: CaptureMaterial[];
  slug: string;
  onMaterialsChange: (next: CaptureMaterial[]) => void;
}

const ALLOWED_UPLOAD_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/** Collapsed summary of the Other box: counts by provenance kind. */
function summarize(others: CaptureMaterial[]): string {
  const uploads = others.filter((m) => materialProvenance(m) === 'uploaded').length;
  const linked = others.filter((m) => materialProvenance(m) === 'linked').length;
  if (uploads === 0 && linked === 0) return 'none yet';
  const parts: string[] = [];
  if (uploads) parts.push(`${uploads} upload${uploads === 1 ? '' : 's'}`);
  if (linked) parts.push(`${linked} linked`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Per-row sub-component — mirrors the manager's MaterialRow semantics.
// ---------------------------------------------------------------------------

interface RowProps {
  m: CaptureMaterial;
  courseCode: string;
  slug: string;
  /** Whether *any* row in the box is currently busy (used for Index-now). */
  indexing: boolean;
  onIndexNow: () => void;
  onMaterialsChange: (next: CaptureMaterial[]) => void;
  allMaterials: CaptureMaterial[];
}

function OtherRow({ m, courseCode, slug, indexing, onIndexNow, onMaterialsChange, allMaterials }: RowProps) {
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [includeAnywayBusy, setIncludeAnywayBusy] = useState(false);
  const [includeAnywayError, setIncludeAnywayError] = useState<string | null>(null);

  const prov = materialProvenance(m);
  const read = materialReadability(m);
  const dimmed = m.ignored || m.autoSetAside;
  const fixable = hasFixablyUnindexed([m]);
  const showLink = prov === 'linked' && m.blobUrl;

  const wordCount = m.extractedText
    ? m.extractedText.split(/\s+/).filter(Boolean).length
    : 0;
  const tokenEst = m.extractedText ? estimateMaterialTokens(m.extractedText) : 0;
  const digestTokenEst = m.digest ? estimateMaterialTokens(m.digest) : 0;
  const usingDigest = m.useDigest && m.digest !== null;

  async function toggleIgnored(ignored: boolean): Promise<void> {
    setBusy(true);
    setRowError(null);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(courseCode)}/materials/${encodeURIComponent(m.id)}?slug=${encodeURIComponent(slug)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ignored }),
        },
      );
      if (!res.ok) { setRowError(`Failed (${res.status})`); return; }
      onMaterialsChange(allMaterials.map((x) => (x.id === m.id ? { ...x, ignored } : x)));
    } finally {
      setBusy(false);
    }
  }

  async function toggleUseDigest(useDigest: boolean): Promise<void> {
    setBusy(true);
    setRowError(null);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(courseCode)}/materials/${encodeURIComponent(m.id)}?slug=${encodeURIComponent(slug)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ useDigest }),
        },
      );
      if (!res.ok) { setRowError(`Failed (${res.status})`); return; }
      onMaterialsChange(allMaterials.map((x) => (x.id === m.id ? { ...x, useDigest } : x)));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(): Promise<void> {
    setBusy(true);
    setRowError(null);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(courseCode)}/materials/${encodeURIComponent(m.id)}?slug=${encodeURIComponent(slug)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) { setRowError(`Failed (${res.status})`); return; }
      onMaterialsChange(allMaterials.filter((x) => x.id !== m.id));
    } finally {
      setBusy(false);
    }
  }

  // FERPA include-anyway: mirrors MaterialsPanel's includeAutoSetAside handler.
  // Optimistic local update first; revert + surface error on failure.
  async function handleIncludeAnyway(): Promise<void> {
    setIncludeAnywayBusy(true);
    setIncludeAnywayError(null);
    const previous = allMaterials;
    onMaterialsChange(allMaterials.map((x) => (x.id === m.id ? { ...x, ignored: false } : x)));
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(courseCode)}/materials/${encodeURIComponent(m.id)}?slug=${encodeURIComponent(slug)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ignored: false }),
        },
      );
      if (!res.ok) {
        onMaterialsChange(previous);
        const body = await res.json().catch(() => ({})) as { error?: string };
        setIncludeAnywayError(body.error ?? `Failed (${res.status})`);
      }
    } catch (e) {
      onMaterialsChange(previous);
      setIncludeAnywayError(e instanceof Error ? e.message : 'Failed to include');
    } finally {
      setIncludeAnywayBusy(false);
    }
  }

  return (
    <li className={'flex flex-col gap-1 px-3 py-2.5 ' + (dimmed ? 'opacity-50' : '')}>
      <div className="flex items-center gap-2">
        <span aria-hidden className="w-4 shrink-0 text-center text-sm">📄</span>
        <span className="min-w-0 flex-1 truncate text-sm">{m.fileName}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {PROVENANCE_LABEL[prov]}
        </span>
        <span
          className={'flex shrink-0 items-center gap-1 text-[11px] ' + (read.readable ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-400')}
          title={read.reason ?? ''}
        >
          <IndexingStatusDot status={m.indexingStatus} indexedAt={m.indexedAt} />
          {read.label}
        </span>
        {fixable && (
          <button
            type="button"
            onClick={onIndexNow}
            disabled={indexing}
            className="shrink-0 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:bg-amber-900/20 dark:text-amber-200"
          >
            {indexing ? 'Indexing…' : 'Index now'}
          </button>
        )}
        {showLink && (
          <a
            href={m.blobUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            source ↗
          </a>
        )}
        {/* Per-row controls — mirror the manager */}
        {m.digest !== null && (
          <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <input
              type="checkbox"
              checked={m.useDigest}
              disabled={busy}
              onChange={(e) => void toggleUseDigest(e.target.checked)}
              className="h-3 w-3"
            />
            AI summary
          </label>
        )}
        <button
          type="button"
          onClick={() => void toggleIgnored(!m.ignored)}
          disabled={busy}
          className="shrink-0 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
        >
          {m.ignored ? 're-include' : 'ignore'}
        </button>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          disabled={!m.extractedText}
          className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          {expanded ? 'hide' : 'preview'}
        </button>
        <button
          type="button"
          onClick={() => void handleDelete()}
          disabled={busy}
          className="shrink-0 text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-30"
        >
          delete
        </button>
      </div>

      {/* Meta line: words · ~tok · size · [audit sends ~N tok when using digest] */}
      {(wordCount > 0 || tokenEst > 0) && (
        <p className="pl-6 text-[11px] text-muted-foreground">
          {wordCount > 0 && <span>{wordCount.toLocaleString()} words · </span>}
          {tokenEst > 0 && <span>~{formatMaterialTokens(tokenEst)} · </span>}
          {usingDigest && digestTokenEst > 0 && (
            <span className="text-teal-700" title="Tokens the AI summary contributes to the interview prompt.">
              interview sends ~{formatMaterialTokens(digestTokenEst)} ·{' '}
            </span>
          )}
          <span>{formatMaterialBytes(m.sizeBytes)}</span>
        </p>
      )}

      {rowError && <p className="pl-6 text-[11px] text-destructive">{rowError}</p>}

      {/* Why-ignored reason + FERPA include-anyway — parity with MaterialsPanel's
          MaterialRow. Shows for any ignored or auto-set-aside row, not just Canvas
          syllabus (generalizing beyond the original Canvas-only display). */}
      {(m.ignored || m.autoSetAside) && (
        <div className="mt-0.5 flex items-start justify-between gap-2 rounded border border-amber-200 bg-amber-50/50 px-2 py-1">
          <p className="text-[11px] leading-snug italic text-amber-800">
            {m.setAsideReason
              ?? (m.autoSetAside
                    ? 'set aside automatically'
                    : 'manually toggled off by the faculty reviewer')}
            {m.autoSetAside && !m.ignored && (
              <span className="ml-1 not-italic text-amber-700">(overridden — included in interview)</span>
            )}
          </p>
          {m.autoSetAside && m.ignored && (
            <button
              type="button"
              onClick={() => void handleIncludeAnyway()}
              disabled={includeAnywayBusy}
              className="shrink-0 text-[11px] font-medium text-amber-900 underline hover:text-amber-700 disabled:opacity-50"
            >
              {includeAnywayBusy ? 'Including…' : 'Include anyway'}
            </button>
          )}
        </div>
      )}
      {includeAnywayError && (
        <p className="pl-2 text-[11px] text-destructive">{includeAnywayError}</p>
      )}

      {expanded && m.extractedText && (
        <pre className="max-h-72 overflow-auto rounded border bg-muted/40 p-2 text-[11px] leading-snug whitespace-pre-wrap">
          {m.extractedText.slice(0, 8000)}
          {m.extractedText.length > 8000 && '\n\n…(truncated)'}
        </pre>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Box component
// ---------------------------------------------------------------------------

export function OtherMaterialsBox({ course, materials, slug, onMaterialsChange }: Props) {
  const others = useMemo(() => materialsByBox(materials).other, [materials]);
  const [open, setOpen] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadBgMessage, setUploadBgMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function refresh(): Promise<void> {
    const fresh = await fetchCourseMaterials(course.code, slug);
    if (fresh) onMaterialsChange(fresh);
  }

  async function handleFiles(files: FileList | null): Promise<void> {
    setError(null);
    if (!files || files.length === 0) return;
    const all = Array.from(files);
    const accepted = all.filter((f) => ALLOWED_UPLOAD_TYPES.has(f.type));
    const skipped = all.filter((f) => !ALLOWED_UPLOAD_TYPES.has(f.type)).map((f) => f.name);
    if (accepted.length === 0) {
      setError('Only PDF or DOCX files are accepted.');
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    setUploadBgMessage(null);
    const failures: string[] = [];
    let queuedCount = 0;
    try {
      // Upload sequentially — each POST stores + enqueues and returns fast
      // (background ingest), so a batch is cheap and we avoid a request burst.
      for (let i = 0; i < accepted.length; i++) {
        const file = accepted[i]!;
        setUploading(accepted.length > 1 ? `${file.name} (${i + 1}/${accepted.length})` : file.name);
        try {
          const form = new FormData();
          form.set('slug', slug);
          form.set('file', file);
          const res = await fetch(`/api/courses/${encodeURIComponent(course.code)}/materials`, {
            method: 'POST',
            body: form,
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) {
            failures.push(`${file.name}: ${(json as { error?: string }).error ?? `failed (${res.status})`}`);
            continue;
          }
          if ((json as { indexingStatus?: string }).indexingStatus === 'queued') queuedCount++;
        } catch (e) {
          failures.push(`${file.name}: ${e instanceof Error ? e.message : 'upload failed'}`);
        }
      }
      if (queuedCount > 0) {
        setUploadBgMessage(`${queuedCount} file${queuedCount === 1 ? '' : 's'} uploaded — indexing in the background. You can keep working; status updates here when ready.`);
      }
      if (failures.length > 0 || skipped.length > 0) {
        const parts: string[] = [];
        if (failures.length) parts.push(`${failures.length} failed — ${failures.join('; ')}`);
        if (skipped.length) parts.push(`Skipped (only PDF/DOCX): ${skipped.join(', ')}`);
        setError(parts.join(' · '));
      }
      await refresh();
    } finally {
      setUploading(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function indexNow(): Promise<void> {
    setIndexing(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/v2-backfill?slug=${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ courseCode: course.code, slug }),
      });
      if (!res.ok) {
        setError('indexing failed');
        return;
      }
      await refresh();
    } catch {
      setError('indexing failed');
    } finally {
      setIndexing(false);
    }
  }

  return (
    <section className="rounded-md border bg-card">
      <header className="flex items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span aria-hidden className="w-4 text-muted-foreground">{open ? '▾' : '▸'}</span>
          <span aria-hidden>📎</span>
          <span className="text-sm font-medium">Other materials</span>
          <span className="truncate text-[11px] text-muted-foreground">— {summarize(others)}</span>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading !== null}
            className="rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : 'Add files'}
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx"
          multiple
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </header>

      {error && <p className="px-3 pb-2 text-[11px] text-amber-700 dark:text-amber-400">{error}</p>}
      {uploadBgMessage && (
        <p className="px-3 pb-2 text-[11px] text-amber-700 dark:text-amber-400">{uploadBgMessage}</p>
      )}

      {open && (
        <div className="border-t">
          {others.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              No uploads or linked docs yet. Add a file or scan existing materials for linked Google/Drive/YouTube content.
            </p>
          ) : (
            <ul className="divide-y">
              {others.map((m) => (
                <OtherRow
                  key={m.id}
                  m={m}
                  courseCode={course.code}
                  slug={slug}
                  indexing={indexing}
                  onIndexNow={() => void indexNow()}
                  onMaterialsChange={onMaterialsChange}
                  allMaterials={materials}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
