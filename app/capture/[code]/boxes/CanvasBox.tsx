'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CaptureMaterial, CourseCatalogView } from '../MaterialsPanel';
import { IndexingStatusDot } from '../MaterialsPanel';
import {
  materialsByBox,
  materialProvenance,
  materialReadability,
  hasFixablyUnindexed,
  isSyllabusCanvasMaterial,
} from '@/lib/capture/material-display';
import { parseCanvasBlob, isCanvasListMaterial } from '@/lib/canvas/parseCanvasBlob';
import { fetchCourseMaterials } from '@/lib/capture/fetch-course-materials';

interface Props {
  course: CourseCatalogView;
  materials: CaptureMaterial[];
  slug: string;
  onMaterialsChange: (next: CaptureMaterial[]) => void;
}

function isCanvasFile(m: CaptureMaterial): boolean {
  return m.fileName.startsWith('Canvas File:');
}

/** Rank readiness so the collapsed summary can surface the worst (least ready). */
const STATUS_RANK: Record<string, number> = {
  ready: 0,
  indexing: 1,
  skipped: 2,
  pending: 3,
  failed: 4,
};

export function CanvasBox({ course, materials, slug, onMaterialsChange }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [token, setToken] = useState('');
  const [reextracting, setReextracting] = useState(false);
  const [reextractMsg, setReextractMsg] = useState<string | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);

  const canvas = useMemo(() => materialsByBox(materials).canvas, [materials]);

  // "Scan linked docs" chases Google/Drive/YouTube links inside the (mostly
  // Canvas) materials; the fetched content lands in the Other box. Any linked
  // material present means the scan has run → gray the button (still clickable).
  const linkedCount = materials.filter((m) => materialProvenance(m) === 'linked').length;
  const scanned = linkedCount > 0;

  // Honest depth: every parsed item across Canvas-list materials, plus each
  // Canvas File (a single document, no internal structure).
  const itemCount = useMemo(() => {
    let n = 0;
    for (const m of canvas) {
      if (isCanvasListMaterial(m.fileName)) n += parseCanvasBlob(m.extractedText ?? '').length;
      else n += 1; // Canvas File (or any non-list Canvas material) counts as one
    }
    return n;
  }, [canvas]);

  // Readiness = worst-of across the Canvas materials.
  const worst = useMemo(() => {
    let chosen: CaptureMaterial | null = null;
    for (const m of canvas) {
      if (m.ignored) continue;
      if (!chosen || (STATUS_RANK[m.indexingStatus] ?? 0) > (STATUS_RANK[chosen.indexingStatus] ?? 0)) {
        chosen = m;
      }
    }
    return chosen;
  }, [canvas]);

  const readinessLabel = worst ? materialReadability(worst).label : 'ready';
  const canIndex = hasFixablyUnindexed(canvas);
  const empty = canvas.length === 0;

  async function handleReextract() {
    if (!token.trim()) { setReextractMsg('Canvas API token is required.'); return; }
    setReextracting(true);
    setReextractMsg(null);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(course.code)}/canvas-reextract`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ slug, canvasToken: token.trim() }),
        },
      );
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        setReextractMsg(`Server returned ${res.status}.`);
        return;
      }
      const json = await res.json() as { updated?: number; skipped?: number; error?: string };
      if (!res.ok) { setReextractMsg(json.error ?? `Import failed (${res.status})`); return; }
      const upd = json.updated ?? 0;
      setReextractMsg(`re-extracted ${upd} file${upd === 1 ? '' : 's'}.`);
      setToken('');
      setTokenOpen(false);
      const fresh = await fetchCourseMaterials(course.code, slug);
      if (fresh) onMaterialsChange(fresh);
    } catch (e) {
      setReextractMsg(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setReextracting(false);
    }
  }

  async function scanLinkedDocs() {
    setScanning(true);
    setScanMsg(null);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(course.code)}/scan-linked-docs?slug=${encodeURIComponent(slug)}`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        setScanMsg(json.error ?? `Scan failed (${res.status})`);
        return;
      }
      const fresh = await fetchCourseMaterials(course.code, slug);
      if (fresh) onMaterialsChange(fresh);
    } catch {
      setScanMsg('Scan failed');
    } finally {
      setScanning(false);
    }
  }

  async function handleIndexNow() {
    setIndexing(true);
    setIndexError(null);
    try {
      const res = await fetch(`/api/admin/v2-backfill?slug=${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ courseCode: course.code, slug }),
      });
      if (!res.ok) { setIndexError('indexing failed — try the materials manager'); return; }
      const fresh = await fetchCourseMaterials(course.code, slug);
      if (fresh) onMaterialsChange(fresh);
      router.refresh();
    } catch {
      setIndexError('indexing failed');
    } finally {
      setIndexing(false);
    }
  }

  async function toggleItemIgnore(m: CaptureMaterial, title: string, nextIgnored: boolean) {
    const current = new Set(m.ignoredItems ?? []);
    if (nextIgnored) current.add(title); else current.delete(title);
    const ignoredItems = Array.from(current);
    // optimistic
    const previous = materials;
    onMaterialsChange(materials.map(x => (x.id === m.id ? { ...x, ignoredItems } : x)));
    setBusy(m.id);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(course.code)}/materials/${encodeURIComponent(m.id)}?slug=${encodeURIComponent(slug)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ignoredItems }),
        },
      );
      if (!res.ok) onMaterialsChange(previous);
    } catch {
      onMaterialsChange(previous);
    } finally {
      setBusy(null);
    }
  }

  async function toggleFileIgnore(m: CaptureMaterial, nextIgnored: boolean) {
    const previous = materials;
    onMaterialsChange(materials.map(x => (x.id === m.id ? { ...x, ignored: nextIgnored } : x)));
    setBusy(m.id);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(course.code)}/materials/${encodeURIComponent(m.id)}?slug=${encodeURIComponent(slug)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ignored: nextIgnored }),
        },
      );
      if (!res.ok) onMaterialsChange(previous);
    } catch {
      onMaterialsChange(previous);
    } finally {
      setBusy(null);
    }
  }

  const summary = empty
    ? 'not imported yet'
    : `${itemCount} item${itemCount === 1 ? '' : 's'} · ${readinessLabel}`;

  return (
    <div className="rounded-md border bg-card">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span aria-hidden className="text-muted-foreground">{open ? '▾' : '▸'}</span>
          <span aria-hidden>🎨</span>
          <span className="text-sm font-medium">Canvas</span>
          <span className="truncate text-[11px] text-muted-foreground">— {summary}</span>
        </button>
        <button
          type="button"
          onClick={() => setTokenOpen(o => !o)}
          className="shrink-0 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted"
        >
          {empty ? 'Import from Canvas' : 'Reimport'}
        </button>
        <button
          type="button"
          onClick={scanLinkedDocs}
          disabled={scanning}
          title={scanned
            ? 'Already scanned — click to re-scan for newly added links'
            : 'Find Google Docs / Drive PDFs / YouTube linked inside your Canvas content and pull them in (they appear under Other materials)'}
          className={
            'shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium disabled:opacity-50 ' +
            (scanned
              ? 'border-transparent bg-muted text-muted-foreground/70 hover:bg-muted'
              : 'border-input bg-background hover:bg-muted')
          }
        >
          {scanning ? 'Scanning…' : scanned ? `✓ Linked docs scanned (${linkedCount})` : 'Scan linked docs'}
        </button>
        {canIndex && (
          <button
            type="button"
            onClick={handleIndexNow}
            disabled={indexing}
            className="shrink-0 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            {indexing ? 'Indexing…' : 'Index now'}
          </button>
        )}
      </div>

      {indexError && <p className="px-3 pb-2 text-[11px] text-amber-700 dark:text-amber-400">{indexError}</p>}
      {scanMsg && <p className="px-3 pb-2 text-[11px] text-amber-700 dark:text-amber-400">{scanMsg}</p>}

      {tokenOpen && (
        <div className="border-t bg-muted/20 px-3 py-2.5">
          <label className="block text-[11px] font-medium text-muted-foreground" htmlFor="canvas-token">
            Canvas API token
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              id="canvas-token"
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="paste your Canvas API token"
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs"
            />
            <button
              type="button"
              onClick={handleReextract}
              disabled={reextracting}
              className="shrink-0 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              {reextracting ? 'Importing…' : (empty ? 'Import' : 'Reimport')}
            </button>
          </div>
          {reextractMsg && <p className="mt-1 text-[11px] text-muted-foreground">{reextractMsg}</p>}
        </div>
      )}

      {open && (
        <div className="border-t">
          {empty && <p className="px-3 py-3 text-[11px] text-muted-foreground">Nothing imported from Canvas yet.</p>}
          {canvas.map(m => {
            const isList = isCanvasListMaterial(m.fileName);
            const isSyllabus = isSyllabusCanvasMaterial(m);
            const ignoredSet = new Set(m.ignoredItems ?? []);
            const items = isList ? parseCanvasBlob(m.extractedText ?? '') : [];
            return (
              <div key={m.id} className="border-b px-3 py-2 last:border-b-0">
                <div className="flex items-center gap-2">
                  <IndexingStatusDot status={m.indexingStatus} indexedAt={m.indexedAt} />
                  <span className="truncate text-xs font-medium">{m.fileName}</span>
                  {isSyllabus && <span className="text-[10px] text-muted-foreground">(syllabus)</span>}
                  <span className="text-[10px] text-muted-foreground">{materialReadability(m).label}</span>
                  {isCanvasFile(m) && (
                    <label className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={m.ignored}
                        disabled={busy === m.id}
                        onChange={e => toggleFileIgnore(m, e.target.checked)}
                      />
                      ignore
                    </label>
                  )}
                </div>
                {isList && items.length > 0 && (
                  <ul className="mt-1.5 space-y-1 pl-5">
                    {items.map(it => (
                      <li key={it.ordinalIndex} className="flex items-center gap-2 text-[11px]">
                        <input
                          type="checkbox"
                          aria-label={`ignore ${it.title}`}
                          checked={ignoredSet.has(it.title)}
                          disabled={busy === m.id}
                          onChange={e => toggleItemIgnore(m, it.title, e.target.checked)}
                        />
                        <span className={ignoredSet.has(it.title) ? 'text-muted-foreground line-through' : ''}>
                          {it.title}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
