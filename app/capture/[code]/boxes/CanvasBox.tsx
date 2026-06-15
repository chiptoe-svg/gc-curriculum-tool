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
import { parseCanvasBlob, isCanvasListMaterial, parseAssignmentSummaries } from '@/lib/canvas/parseCanvasBlob';
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

// ── Inline help: where to find the Canvas course URL + API token ─────────────

/** Collapsible "where do I find these?" note, shown inside both Canvas import forms. */
function CanvasCredsHelp() {
  return (
    <details className="mt-1 text-sm text-muted-foreground">
      <summary className="cursor-pointer hover:text-foreground">Where do I find the URL and token?</summary>
      <div className="mt-1 space-y-1.5 border-l-2 border-muted pl-2 leading-snug">
        <p>
          <span className="font-medium">Course URL:</span> the address bar while you&apos;re inside the
          Canvas course, e.g. <code>clemson.instructure.com/courses/12345</code>.
        </p>
        <p>
          <span className="font-medium">API token:</span> in Canvas, open <span className="font-medium">Account
          &rarr; Settings</span>, scroll to <span className="font-medium">Approved Integrations</span>, and click
          {' '}<span className="font-medium">+ New Access Token</span>. Add a purpose, leave the expiry blank, click
          {' '}<span className="font-medium">Generate Token</span>, and paste it here. Treat it like a password (it
          gives read access to your Canvas courses); you can delete it afterward.
        </p>
      </div>
    </details>
  );
}

// ── Group header with inline import button (bundled mode) ─────────────────────

/**
 * A combined group-header + import-slot for bundled mode. Renders the group
 * label (e.g. "Lab · GC 3461 · not yet imported") and an inline Import button.
 * The Canvas URL + token fields expand inline below the header row when clicked.
 * This keeps the "lab"/"lecture" text in exactly ONE DOM element per group.
 *
 * CRITICAL: POSTs to canvas-import (not canvas-reextract), because each
 * bundled slot is a different Canvas course. canvas-import parses the Canvas
 * course ID from the provided URL and source-scopes the upsert via sourceCode.
 */
function BundledGroupHeader({
  roleLabel,
  code,
  importedAt,
  importedJustNow,
  sourceCode,
  courseCode,
  slug,
  onImported,
  onImportStart,
  onImportEnd,
}: {
  roleLabel: string;
  code: string;
  importedAt: string | null;
  importedJustNow?: boolean;
  sourceCode: string | null;  // null = primary
  courseCode: string;
  slug: string;
  onImported: (sourceCode: string | null) => Promise<void>;
  onImportStart?: () => void;
  onImportEnd?: () => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [token, setToken] = useState('');
  const [canvasUrl, setCanvasUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [imsccFile, setImsccFile] = useState<File | null>(null);
  const [uploadingImscc, setUploadingImscc] = useState(false);

  const slotKey = sourceCode ?? 'primary';

  const datePart = importedJustNow
    ? 'imported just now'
    : importedAt
      ? `imported ${new Date(importedAt).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' })}`
      : 'not yet imported';

  const label = `${roleLabel} · ${code} · ${datePart}`;

  async function handleImport() {
    if (!canvasUrl.trim()) { setImportMsg('Canvas course URL is required.'); return; }
    if (!token.trim()) { setImportMsg('Canvas API token is required.'); return; }
    setImporting(true);
    setImportMsg(null);
    onImportStart?.();
    try {
      const body: Record<string, unknown> = {
        slug,
        canvasUrl: canvasUrl.trim(),
        canvasToken: token.trim(),
        sourceCode: sourceCode ?? null,
      };
      const res = await fetch(
        `/api/courses/${encodeURIComponent(courseCode)}/canvas-import`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      );
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        setImportMsg(`Server returned ${res.status}.`);
        return;
      }
      const json = await res.json() as { imported?: number; inserted?: number; updated?: number; error?: string };
      if (!res.ok) { setImportMsg(json.error ?? `Import failed (${res.status})`); return; }
      const imp = json.imported ?? 0;
      setImportMsg(`imported ${imp} material${imp === 1 ? '' : 's'}.`);
      setToken('');
      setCanvasUrl('');
      setFormOpen(false);
      await onImported(sourceCode);
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
      onImportEnd?.();
    }
  }

  async function handleImsccUpload() {
    if (!imsccFile) return;
    setUploadingImscc(true);
    setImportMsg(null);
    onImportStart?.();
    try {
      const form = new FormData();
      form.append('file', imsccFile);
      form.append('slug', slug);
      form.append('sourceCode', sourceCode ?? '');
      const res = await fetch(
        `/api/courses/${encodeURIComponent(courseCode)}/imscc-import`,
        { method: 'POST', body: form },
      );
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        setImportMsg(`Server returned ${res.status}.`);
        return;
      }
      const json = await res.json() as { imported?: number; inserted?: number; updated?: number; error?: string };
      if (!res.ok) { setImportMsg(json.error ?? `Upload failed (${res.status})`); return; }
      const imp = json.imported ?? 0;
      setImportMsg(`imported ${imp} material${imp === 1 ? '' : 's'} from the cartridge.`);
      setImsccFile(null);
      await onImported(sourceCode);
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploadingImscc(false);
      onImportEnd?.();
    }
  }

  return (
    <div className="border-b bg-muted/5">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="flex-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <button
          type="button"
          onClick={() => setFormOpen(o => !o)}
          className="shrink-0 rounded-md border border-input bg-background px-2 py-0.5 text-sm font-medium hover:bg-muted"
        >
          {importedAt || importedJustNow ? 'Reimport' : 'Import'}
        </button>
      </div>
      {formOpen && (
        <div className="border-t bg-muted/20 px-3 py-2 space-y-2">
          <div>
            <label className="block text-sm font-medium text-muted-foreground" htmlFor={`canvas-url-${slotKey}`}>
              Canvas course URL
            </label>
            <input
              id={`canvas-url-${slotKey}`}
              type="url"
              value={canvasUrl}
              onChange={e => setCanvasUrl(e.target.value)}
              placeholder="https://clemson.instructure.com/courses/12345"
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground" htmlFor={`canvas-token-${slotKey}`}>
              Canvas API token
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                id={`canvas-token-${slotKey}`}
                type="password"
                value={token}
                onChange={e => setToken(e.target.value)}
                placeholder="paste your Canvas API token"
                className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm"
              />
              <button
                type="button"
                onClick={handleImport}
                disabled={importing}
                className="shrink-0 rounded-md border border-input bg-background px-2.5 py-1 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                {importing ? 'Importing…' : (importedAt || importedJustNow ? 'Reimport' : 'Import')}
              </button>
            </div>
          </div>
          <CanvasCredsHelp />
          <div className="mt-2 border-t pt-2">
            <p className="mb-1 text-sm font-medium text-muted-foreground">Or upload a .imscc cartridge</p>
            <input
              id={`imscc-file-${slotKey}`}
              type="file"
              accept=".imscc,application/zip"
              onChange={e => setImsccFile(e.target.files?.[0] ?? null)}
              className="sr-only"
            />
            <div className="flex items-center gap-2">
              <label
                htmlFor={`imscc-file-${slotKey}`}
                className="shrink-0 cursor-pointer rounded-md border border-input bg-background px-2.5 py-1 text-sm font-medium hover:bg-muted"
              >
                Choose .imscc file
              </label>
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                {imsccFile ? imsccFile.name : 'No file chosen'}
              </span>
              <button
                type="button"
                onClick={handleImsccUpload}
                disabled={uploadingImscc || !imsccFile}
                className="shrink-0 rounded-md border border-input bg-primary/10 px-2.5 py-1 text-sm font-semibold hover:bg-primary/20 disabled:opacity-50"
              >
                {uploadingImscc ? 'Uploading…' : 'Upload .imscc'}
              </button>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Export from Canvas: Settings &rarr; Export Course Content.
            </p>
          </div>
          {importMsg && <p className="text-sm text-muted-foreground">{importMsg}</p>}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function CanvasBox({ course, materials, slug, onMaterialsChange }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [token, setToken] = useState('');
  // Single-mode reimport may optionally switch to a different Canvas course URL
  // (e.g. a new semester's section). Blank = refresh the currently-linked course.
  const [reimportUrl, setReimportUrl] = useState('');
  const [reextracting, setReextracting] = useState(false);
  const [reextractMsg, setReextractMsg] = useState<string | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [autoScanAfterImport, setAutoScanAfterImport] = useState(true);
  const [imsccFileSingle, setImsccFileSingle] = useState<File | null>(null);
  const [uploadingImscc, setUploadingImscc] = useState(false);
  // Optimistic "just now" provenance per slot: keyed by sourceCode ?? 'primary'
  const [slotImportedJustNow, setSlotImportedJustNow] = useState<Record<string, true>>({});
  // Whether any slot import is currently in flight (to disable scan button)
  const [slotImporting, setSlotImporting] = useState(false);

  const paired = course.pairedCodes ?? [];
  const isBundled = paired.length > 0;

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

  // Total points across Canvas: Assignments (for the header summary).
  const totalPoints = useMemo(() => {
    const assignmentsMat = canvas.find(m => m.fileName === 'Canvas: Assignments');
    if (!assignmentsMat?.extractedText) return null;
    const rows = parseAssignmentSummaries(assignmentsMat.extractedText);
    const pts = rows.reduce((sum, r) => (r.points !== null ? sum + r.points : sum), 0);
    return rows.some(r => r.points !== null) ? pts : null;
  }, [canvas]);

  // Per-material rubric map: materialId → Set of assignment names that have rubrics.
  const rubricsByMaterialId = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const m of canvas) {
      if (m.fileName === 'Canvas: Assignments' && m.extractedText) {
        const rows = parseAssignmentSummaries(m.extractedText);
        map.set(m.id, new Set(rows.filter(r => r.hasRubric).map(r => r.name)));
      }
    }
    return map;
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
      // A URL switches to a (possibly new) Canvas course via canvas-import, which
      // parses the course ID and upserts materials by name. Blank re-extracts the
      // currently-linked course in place (canvas-reextract).
      const url = reimportUrl.trim();
      const res = await fetch(
        `/api/courses/${encodeURIComponent(course.code)}/${url ? 'canvas-import' : 'canvas-reextract'}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            url
              ? { slug, canvasUrl: url, canvasToken: token.trim(), sourceCode: null }
              : { slug, canvasToken: token.trim() },
          ),
        },
      );
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        setReextractMsg(`Server returned ${res.status}.`);
        return;
      }
      const json = await res.json() as { updated?: number; imported?: number; skipped?: number; error?: string };
      if (!res.ok) { setReextractMsg(json.error ?? `Import failed (${res.status})`); return; }
      const n = url ? (json.imported ?? 0) : (json.updated ?? 0);
      const verb = url ? 'imported' : 're-extracted';
      setReextractMsg(`${verb} ${n} file${n === 1 ? '' : 's'}.`);
      setToken('');
      setReimportUrl('');
      setTokenOpen(false);
      const fresh = await fetchCourseMaterials(course.code, slug);
      if (fresh) onMaterialsChange(fresh);
      if (autoScanAfterImport) {
        setReextractMsg(`${verb} ${n} file${n === 1 ? '' : 's'}; scanning linked docs…`);
        await scanLinkedDocs();
      }
    } catch (e) {
      setReextractMsg(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setReextracting(false);
    }
  }

  async function handleImsccUploadSingle() {
    if (!imsccFileSingle) return;
    setUploadingImscc(true);
    setReextractMsg(null);
    try {
      const form = new FormData();
      form.append('file', imsccFileSingle);
      form.append('slug', slug);
      const res = await fetch(
        `/api/courses/${encodeURIComponent(course.code)}/imscc-import`,
        { method: 'POST', body: form },
      );
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        setReextractMsg(`Server returned ${res.status}.`);
        return;
      }
      const json = await res.json() as { imported?: number; inserted?: number; updated?: number; error?: string };
      if (!res.ok) { setReextractMsg(json.error ?? `Upload failed (${res.status})`); return; }
      const imp = json.imported ?? 0;
      setReextractMsg(`imported ${imp} material${imp === 1 ? '' : 's'} from the cartridge.`);
      setImsccFileSingle(null);
      setTokenOpen(false);
      const fresh = await fetchCourseMaterials(course.code, slug);
      if (fresh) onMaterialsChange(fresh);
      if (autoScanAfterImport) {
        setReextractMsg(`imported ${imp} material${imp === 1 ? '' : 's'} from the cartridge; scanning linked docs…`);
        await scanLinkedDocs();
      }
    } catch (e) {
      setReextractMsg(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploadingImscc(false);
    }
  }

  async function scanLinkedDocs() {
    if (scanning) return; // re-entrance guard: auto-scan-after-import + a manual click must not race the busy flag
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

  // FERPA include-anyway for Canvas materials — mirrors MaterialsPanel's includeAutoSetAside.
  // Optimistic local update; revert on failure. Only shown for autoSetAside rows.
  async function includeAnyway(m: CaptureMaterial) {
    const previous = materials;
    onMaterialsChange(materials.map(x => (x.id === m.id ? { ...x, ignored: false } : x)));
    setBusy(m.id);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(course.code)}/materials/${encodeURIComponent(m.id)}?slug=${encodeURIComponent(slug)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ignored: false }),
        },
      );
      if (!res.ok) onMaterialsChange(previous);
    } catch {
      onMaterialsChange(previous);
    } finally {
      setBusy(null);
    }
  }

  const importedDateLabel = course.canvasImportedAt
    ? new Date(course.canvasImportedAt).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' })
    : null;
  const importedPrefix = importedDateLabel
    ? (course.canvasCourseName ? `${course.canvasCourseName} · ` : '') + `imported ${importedDateLabel} · `
    : '';
  const summary = empty
    ? 'not imported yet'
    : `${importedPrefix}${itemCount} item${itemCount === 1 ? '' : 's'}${totalPoints !== null ? ` · ${totalPoints} total pts` : ''} · ${readinessLabel}`;

  // ── Bundled-mode helpers ────────────────────────────────────────────────────

  /** Callback after a per-slot import completes: set optimistic stamp, refresh + optionally scan. */
  async function handleSlotImported(sourceCode: string | null) {
    const key = sourceCode ?? 'primary';
    setSlotImportedJustNow(prev => ({ ...prev, [key]: true }));
    const fresh = await fetchCourseMaterials(course.code, slug);
    if (fresh) onMaterialsChange(fresh);
    if (autoScanAfterImport) {
      await scanLinkedDocs();
    }
  }

  /** Group canvas materials by sourceCode (null = primary). */
  const groupedCanvas = useMemo(() => {
    if (!isBundled) return null;
    const groups = new Map<string | null, CaptureMaterial[]>();
    groups.set(null, []);
    for (const p of paired) groups.set(p.pairedCode, []);
    for (const m of canvas) {
      const key = m.sourceCode ?? null;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }
    return groups;
  }, [isBundled, canvas, paired]);

  // Known slot keys (null + each paired code)
  const knownSlotKeys = useMemo<Set<string | null>>(() => {
    const s = new Set<string | null>([null]);
    for (const p of paired) s.add(p.pairedCode);
    return s;
  }, [paired]);

  // Orphan groups: canvas material sourceCode values that don't match any known slot
  const orphanGroups = useMemo<Map<string, CaptureMaterial[]>>(() => {
    if (!isBundled || !groupedCanvas) return new Map();
    const orphans = new Map<string, CaptureMaterial[]>();
    for (const [key, items] of groupedCanvas.entries()) {
      if (key !== null && !knownSlotKeys.has(key)) {
        orphans.set(key, items);
      }
    }
    return orphans;
  }, [isBundled, groupedCanvas, knownSlotKeys]);

  // ── Shared material-row renderer ────────────────────────────────────────────

  function renderMaterialRow(m: CaptureMaterial) {
    const isList = isCanvasListMaterial(m.fileName);
    const isSyllabus = isSyllabusCanvasMaterial(m);
    const ignoredSet = new Set(m.ignoredItems ?? []);
    const items = isList ? parseCanvasBlob(m.extractedText ?? '') : [];
    const rubricNames = rubricsByMaterialId.get(m.id);
    // Canvas-syllabus why-not-used note (Item 2 — syllabus-specific wording)
    const syllabusWhyNote = isSyllabus && (m.ignored || m.autoSetAside)
      ? (m.setAsideReason?.trim() ||
          "not used — the Google Sheet catalog already provides this course's objectives and projects (see the Syllabus & course info box above)")
      : null;
    // Generic why-ignored for non-syllabus auto-set-aside rows (FERPA, etc.)
    const showGenericWhyIgnored = !isSyllabus && (m.ignored || m.autoSetAside);
    return (
      <div key={m.id} className="border-b px-3 py-2 last:border-b-0">
        <div className="flex items-center gap-2">
          <IndexingStatusDot status={m.indexingStatus} indexedAt={m.indexedAt} />
          <span className="truncate text-sm font-medium">{m.fileName}</span>
          {isSyllabus && <span className="text-xs text-muted-foreground">(syllabus)</span>}
          <span className="text-xs text-muted-foreground">{materialReadability(m).label}</span>
          {isCanvasFile(m) && (
            <label className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
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
        {syllabusWhyNote && (
          <p className="mt-0.5 pl-5 text-xs italic text-muted-foreground">{syllabusWhyNote}</p>
        )}
        {/* Why-ignored reason + FERPA Include anyway for non-syllabus rows */}
        {showGenericWhyIgnored && (
          <div className="mt-0.5 flex items-start justify-between gap-2 rounded border border-amber-200 bg-amber-50/50 px-2 py-1">
            <p className="text-sm leading-snug italic text-amber-800">
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
                onClick={() => void includeAnyway(m)}
                disabled={busy === m.id}
                className="shrink-0 text-sm font-medium text-amber-900 underline hover:text-amber-700 disabled:opacity-50"
              >
                {busy === m.id ? 'Including…' : 'Include anyway'}
              </button>
            )}
          </div>
        )}
        {isList && items.length > 0 && (
          <ul className="mt-1.5 space-y-1 pl-5">
            {items.map(it => {
              // rubricNames keys are the parsed assignment name (pts stripped).
              // it.title is the raw h2 text which may include "(N pts)".
              // Check both exact match and pts-stripped match.
              const titleStripped = it.title.replace(/\s*\(\d+(?:\.\d+)?\s*pts\)\s*$/, '').trim();
              const hasRubric = rubricNames
                ? (rubricNames.has(it.title) || rubricNames.has(titleStripped))
                : false;
              return (
                <li key={it.ordinalIndex} className="flex items-center gap-2 text-sm">
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
                  {hasRubric && (
                    <span
                      className="rounded bg-muted px-1 py-0.5 text-[9px] font-medium text-muted-foreground"
                      title="This assignment has a rubric — rubric criteria feed the depth evidence"
                    >
                      rubric ✓
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  // ── Scan linked docs button (shared between single-mode header and bundled footer) ─

  const scanButton = (
    <button
      type="button"
      onClick={scanLinkedDocs}
      disabled={scanning || reextracting || slotImporting}
      title={scanned
        ? 'Already scanned — click to re-scan for newly added links'
        : 'Find Google Docs / Drive PDFs / YouTube linked inside your Canvas content and pull them in (they appear under Other materials)'}
      className={
        'shrink-0 rounded-md border px-2.5 py-1 text-sm font-medium disabled:opacity-50 ' +
        (scanned
          ? 'border-transparent bg-muted text-muted-foreground/70 hover:bg-muted'
          : 'border-input bg-background hover:bg-muted')
      }
    >
      {scanning ? 'Scanning…' : scanned ? `✓ Linked docs scanned (${linkedCount})` : 'Scan linked docs'}
    </button>
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="rounded-md border bg-card">
      {/* ── Header (always visible) ── */}
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
          <span className="truncate text-sm text-muted-foreground">— {summary}</span>
        </button>

        {/* Single-mode: global import + scan buttons in the header */}
        {!isBundled && (
          <>
            <button
              type="button"
              onClick={() => setTokenOpen(o => !o)}
              className="shrink-0 rounded-md border border-input bg-background px-2.5 py-1 text-sm font-medium hover:bg-muted"
            >
              {empty ? 'Import from Canvas' : 'Reimport'}
            </button>
            {scanButton}
          </>
        )}

        {canIndex && (
          <button
            type="button"
            onClick={handleIndexNow}
            disabled={indexing}
            className="shrink-0 rounded-md border border-input bg-background px-2.5 py-1 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {indexing ? 'Indexing…' : 'Index now'}
          </button>
        )}
      </div>

      {indexError && <p className="px-3 pb-2 text-sm text-amber-700 dark:text-amber-400">{indexError}</p>}
      {scanMsg && <p className="px-3 pb-2 text-sm text-amber-700 dark:text-amber-400">{scanMsg}</p>}

      {/* Single-mode: global token field */}
      {!isBundled && tokenOpen && (
        <div className="border-t bg-muted/20 px-3 py-2.5">
          <label className="block text-sm font-medium text-muted-foreground" htmlFor="canvas-url">
            Canvas course URL {empty ? '' : '(optional)'}
          </label>
          <input
            id="canvas-url"
            type="url"
            value={reimportUrl}
            onChange={e => setReimportUrl(e.target.value)}
            placeholder="https://clemson.instructure.com/courses/12345"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
          />
          {!empty && (
            <p className="mt-1 text-xs leading-snug text-muted-foreground">
              {course.canvasCourseName ? `Currently linked: ${course.canvasCourseName}. ` : ''}
              Leave blank to refresh the current Canvas course, or paste a new URL to switch to a different one (e.g. a new semester&apos;s section).
            </p>
          )}
          <label className="mt-2.5 block text-sm font-medium text-muted-foreground" htmlFor="canvas-token">
            Canvas API token
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              id="canvas-token"
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="paste your Canvas API token"
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm"
            />
            <button
              type="button"
              onClick={handleReextract}
              disabled={reextracting}
              className="shrink-0 rounded-md border border-input bg-background px-2.5 py-1 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              {reextracting ? 'Importing…' : (empty ? 'Import' : 'Reimport')}
            </button>
          </div>
          <CanvasCredsHelp />
          <div className="mt-2 border-t pt-2">
            <p className="mb-1 text-sm font-medium text-muted-foreground">Or upload a .imscc cartridge</p>
            <input
              id="imscc-file-single"
              type="file"
              accept=".imscc,application/zip"
              onChange={e => setImsccFileSingle(e.target.files?.[0] ?? null)}
              className="sr-only"
            />
            <div className="flex items-center gap-2">
              <label
                htmlFor="imscc-file-single"
                className="shrink-0 cursor-pointer rounded-md border border-input bg-background px-2.5 py-1 text-sm font-medium hover:bg-muted"
              >
                Choose .imscc file
              </label>
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                {imsccFileSingle ? imsccFileSingle.name : 'No file chosen'}
              </span>
              <button
                type="button"
                onClick={handleImsccUploadSingle}
                disabled={uploadingImscc || !imsccFileSingle}
                className="shrink-0 rounded-md border border-input bg-primary/10 px-2.5 py-1 text-sm font-semibold hover:bg-primary/20 disabled:opacity-50"
              >
                {uploadingImscc ? 'Uploading…' : 'Upload .imscc'}
              </button>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Export from Canvas: Settings &rarr; Export Course Content.
            </p>
          </div>
          <label className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={autoScanAfterImport}
              onChange={e => setAutoScanAfterImport(e.target.checked)}
              className="h-3 w-3"
            />
            Scan linked Google/YouTube files automatically after import
          </label>
          {reextractMsg && <p className="mt-1 text-sm text-muted-foreground">{reextractMsg}</p>}
        </div>
      )}

      {/* ── Expanded body ── */}
      {open && (
        <div className="border-t">
          {/* ── BUNDLED MODE ── */}
          {isBundled && groupedCanvas && (
            <>
              {/* Primary group: combined header (with import slot) + item list */}
              <BundledGroupHeader
                roleLabel={course.code}
                code={course.code}
                importedAt={course.canvasImportedAt}
                importedJustNow={slotImportedJustNow['primary'] === true}
                sourceCode={null}
                courseCode={course.code}
                slug={slug}
                onImported={handleSlotImported}
                onImportStart={() => setSlotImporting(true)}
                onImportEnd={() => setSlotImporting(false)}
              />
              {(groupedCanvas.get(null) ?? []).length === 0 && (
                <p className="px-3 py-2 text-sm text-muted-foreground">Nothing imported from Canvas yet.</p>
              )}
              {(groupedCanvas.get(null) ?? []).map(m => renderMaterialRow(m))}

              {/* Paired groups: one combined header+slot per paired code */}
              {paired.map(p => {
                const roleLabel = p.role.charAt(0).toUpperCase() + p.role.slice(1);
                const groupItems = groupedCanvas.get(p.pairedCode) ?? [];
                return (
                  <div key={p.pairedCode}>
                    <BundledGroupHeader
                      roleLabel={roleLabel}
                      code={p.pairedCode}
                      importedAt={p.canvasImportedAt}
                      importedJustNow={slotImportedJustNow[p.pairedCode] === true}
                      sourceCode={p.pairedCode}
                      courseCode={course.code}
                      slug={slug}
                      onImported={handleSlotImported}
                      onImportStart={() => setSlotImporting(true)}
                      onImportEnd={() => setSlotImporting(false)}
                    />
                    {groupItems.length === 0 && (
                      <p className="px-3 py-2 text-sm text-muted-foreground">Nothing imported from Canvas yet.</p>
                    )}
                    {groupItems.map(m => renderMaterialRow(m))}
                  </div>
                );
              })}

              {/* Orphan groups: materials whose sourceCode no longer matches any paired slot */}
              {orphanGroups.size > 0 && Array.from(orphanGroups.entries()).map(([orphanCode, items]) => (
                <div key={orphanCode}>
                  <div className="border-b border-t bg-muted/5 px-3 py-1.5">
                    <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Unmatched source ({orphanCode})
                    </span>
                    <p className="text-xs text-muted-foreground/70 italic">from a Canvas page no longer paired to this course</p>
                  </div>
                  {items.map(m => renderMaterialRow(m))}
                </div>
              ))}

              {/* Bundled mode footer: Reimport-all + Scan linked docs — once */}
              <div className="flex items-center gap-2 border-t px-3 py-2">
                {scanButton}
                <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={autoScanAfterImport}
                    onChange={e => setAutoScanAfterImport(e.target.checked)}
                    className="h-3 w-3"
                  />
                  Auto-scan after import
                </label>
              </div>
            </>
          )}

          {/* ── SINGLE MODE (unchanged) ── */}
          {!isBundled && (
            <>
              {empty && <p className="px-3 py-3 text-sm text-muted-foreground">Nothing imported from Canvas yet.</p>}
              {canvas.map(m => renderMaterialRow(m))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
