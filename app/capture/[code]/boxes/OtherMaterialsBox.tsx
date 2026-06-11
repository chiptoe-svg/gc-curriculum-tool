'use client';

import { useMemo, useRef, useState } from 'react';
import { IndexingStatusDot, type CaptureMaterial, type CourseCatalogView } from '../MaterialsPanel';
import { fetchCourseMaterials } from '@/lib/capture/fetch-course-materials';
import {
  materialsByBox, materialProvenance, PROVENANCE_LABEL,
  materialReadability, hasFixablyUnindexed,
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

export function OtherMaterialsBox({ course, materials, slug, onMaterialsChange }: Props) {
  const others = useMemo(() => materialsByBox(materials).other, [materials]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function refresh(): Promise<void> {
    const fresh = await fetchCourseMaterials(course.code, slug);
    if (fresh) onMaterialsChange(fresh);
  }

  async function handleFiles(files: FileList | null): Promise<void> {
    setError(null);
    if (!files || files.length === 0) return;
    const file = files[0]!;
    if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
      setError('Only PDF or DOCX files are accepted.');
      return;
    }
    setUploading(file.name);
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
        setError((json as { error?: string }).error ?? `Upload failed (${res.status})`);
        return;
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function scanLinkedDocs(): Promise<void> {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(course.code)}/scan-linked-docs?slug=${encodeURIComponent(slug)}`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        setError(json.error ?? `Scan failed (${res.status})`);
        return;
      }
      await refresh();
    } catch {
      setError('Scan failed');
    } finally {
      setScanning(false);
    }
  }

  async function toggleIgnored(id: string, ignored: boolean): Promise<void> {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(course.code)}/materials/${encodeURIComponent(id)}?slug=${encodeURIComponent(slug)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ignored }),
        },
      );
      if (!res.ok) {
        setError(`Failed (${res.status})`);
        return;
      }
      onMaterialsChange(materials.map((m) => (m.id === id ? { ...m, ignored } : m)));
    } finally {
      setBusy(null);
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
            {uploading ? 'Uploading…' : 'Add file'}
          </button>
          <button
            type="button"
            onClick={scanLinkedDocs}
            disabled={scanning}
            className="rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            {scanning ? 'Scanning…' : 'Scan linked docs'}
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx"
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </header>

      {error && <p className="px-3 pb-2 text-[11px] text-amber-700 dark:text-amber-400">{error}</p>}

      {open && (
        <div className="border-t">
          {others.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              No uploads or linked docs yet. Add a file or scan existing materials for linked Google/Drive/YouTube content.
            </p>
          ) : (
            <ul className="divide-y">
              {others.map((m) => {
                const prov = materialProvenance(m);
                const read = materialReadability(m);
                const dimmed = m.ignored || m.autoSetAside;
                const fixable = hasFixablyUnindexed([m]);
                const showLink = prov === 'linked' && m.blobUrl;
                return (
                  <li key={m.id} className={'flex items-center gap-3 px-3 py-2.5 ' + (dimmed ? 'opacity-50' : '')}>
                    <span aria-hidden className="w-4 text-center">📄</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{m.fileName}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {PROVENANCE_LABEL[prov]}
                    </span>
                    <span
                      className={'flex items-center gap-1 text-[11px] ' + (read.readable ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-400')}
                      title={read.reason ?? ''}
                    >
                      <IndexingStatusDot status={m.indexingStatus} indexedAt={m.indexedAt} />
                      {read.label}
                    </span>
                    {fixable && (
                      <button
                        type="button"
                        onClick={indexNow}
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
                    <button
                      type="button"
                      onClick={() => void toggleIgnored(m.id, !m.ignored)}
                      disabled={busy === m.id}
                      className="shrink-0 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
                    >
                      {m.ignored ? 're-include' : 'ignore'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
