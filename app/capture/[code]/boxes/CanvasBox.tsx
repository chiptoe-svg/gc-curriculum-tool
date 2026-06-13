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

// ── Group header with inline import button (bundled mode) ─────────────────────

/**
 * A combined group-header + import-slot for bundled mode. Renders the group
 * label (e.g. "Lab · GC 3461 · not yet imported") and an inline Import button.
 * The token field expands inline below the header row when the button is clicked.
 * This keeps the "lab"/"lecture" text in exactly ONE DOM element per group.
 */
function BundledGroupHeader({
  roleLabel,
  code,
  importedAt,
  sourceCode,
  courseCode,
  slug,
  onImported,
}: {
  roleLabel: string;
  code: string;
  importedAt: string | null;
  sourceCode: string | null;  // null = primary
  courseCode: string;
  slug: string;
  onImported: (sourceCode: string | null) => Promise<void>;
}) {
  const [tokenOpen, setTokenOpen] = useState(false);
  const [token, setToken] = useState('');
  const [reextracting, setReextracting] = useState(false);
  const [reextractMsg, setReextractMsg] = useState<string | null>(null);

  const datePart = importedAt
    ? `imported ${new Date(importedAt).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' })}`
    : 'not yet imported';

  const label = `${roleLabel} · ${code} · ${datePart}`;

  async function handleImport() {
    if (!token.trim()) { setReextractMsg('Canvas API token is required.'); return; }
    setReextracting(true);
    setReextractMsg(null);
    try {
      const body: Record<string, unknown> = { slug, canvasToken: token.trim() };
      if (sourceCode !== null) body.sourceCode = sourceCode;
      const res = await fetch(
        `/api/courses/${encodeURIComponent(courseCode)}/canvas-reextract`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
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
      await onImported(sourceCode);
    } catch (e) {
      setReextractMsg(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setReextracting(false);
    }
  }

  return (
    <div className="border-b bg-muted/5">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <button
          type="button"
          onClick={() => setTokenOpen(o => !o)}
          className="shrink-0 rounded-md border border-input bg-background px-2 py-0.5 text-[11px] font-medium hover:bg-muted"
        >
          {importedAt ? 'Reimport' : 'Import'}
        </button>
      </div>
      {tokenOpen && (
        <div className="border-t bg-muted/20 px-3 py-2">
          <label className="block text-[11px] font-medium text-muted-foreground" htmlFor={`canvas-token-${sourceCode ?? 'primary'}`}>
            Canvas API token
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              id={`canvas-token-${sourceCode ?? 'primary'}`}
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="paste your Canvas API token"
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs"
            />
            <button
              type="button"
              onClick={handleImport}
              disabled={reextracting}
              className="shrink-0 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              {reextracting ? 'Importing…' : (importedAt ? 'Reimport' : 'Import')}
            </button>
          </div>
          {reextractMsg && <p className="mt-1 text-[11px] text-muted-foreground">{reextractMsg}</p>}
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
  const [reextracting, setReextracting] = useState(false);
  const [reextractMsg, setReextractMsg] = useState<string | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [autoScanAfterImport, setAutoScanAfterImport] = useState(true);

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
      if (autoScanAfterImport) {
        setReextractMsg(`re-extracted ${upd} file${upd === 1 ? '' : 's'} — scanning linked docs…`);
        await scanLinkedDocs();
      }
    } catch (e) {
      setReextractMsg(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setReextracting(false);
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

  /** Callback after a per-slot import completes: refresh + optionally scan. */
  async function handleSlotImported(_sourceCode: string | null) {
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
        {syllabusWhyNote && (
          <p className="mt-0.5 pl-5 text-[10px] italic text-muted-foreground">{syllabusWhyNote}</p>
        )}
        {/* Why-ignored reason + FERPA Include anyway for non-syllabus rows */}
        {showGenericWhyIgnored && (
          <div className="mt-0.5 flex items-start justify-between gap-2 rounded border border-amber-200 bg-amber-50/50 px-2 py-1">
            <p className="text-[11px] leading-snug italic text-amber-800">
              {m.setAsideReason
                ?? (m.autoSetAside
                      ? 'set aside automatically'
                      : 'manually toggled off by the faculty reviewer')}
              {m.autoSetAside && !m.ignored && (
                <span className="ml-1 not-italic text-amber-700">(overridden — included in audit)</span>
              )}
            </p>
            {m.autoSetAside && m.ignored && (
              <button
                type="button"
                onClick={() => void includeAnyway(m)}
                disabled={busy === m.id}
                className="shrink-0 text-[11px] font-medium text-amber-900 underline hover:text-amber-700 disabled:opacity-50"
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
      disabled={scanning || reextracting}
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
          <span className="truncate text-[11px] text-muted-foreground">— {summary}</span>
        </button>

        {/* Single-mode: global import + scan buttons in the header */}
        {!isBundled && (
          <>
            <button
              type="button"
              onClick={() => setTokenOpen(o => !o)}
              className="shrink-0 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted"
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
            className="shrink-0 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            {indexing ? 'Indexing…' : 'Index now'}
          </button>
        )}
      </div>

      {indexError && <p className="px-3 pb-2 text-[11px] text-amber-700 dark:text-amber-400">{indexError}</p>}
      {scanMsg && <p className="px-3 pb-2 text-[11px] text-amber-700 dark:text-amber-400">{scanMsg}</p>}

      {/* Single-mode: global token field */}
      {!isBundled && tokenOpen && (
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
          <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={autoScanAfterImport}
              onChange={e => setAutoScanAfterImport(e.target.checked)}
              className="h-3 w-3"
            />
            Scan linked Google/YouTube files automatically after import
          </label>
          {reextractMsg && <p className="mt-1 text-[11px] text-muted-foreground">{reextractMsg}</p>}
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
                roleLabel="Lecture"
                code={course.code}
                importedAt={course.canvasImportedAt}
                sourceCode={null}
                courseCode={course.code}
                slug={slug}
                onImported={handleSlotImported}
              />
              {(groupedCanvas.get(null) ?? []).length === 0 && (
                <p className="px-3 py-2 text-[11px] text-muted-foreground">Nothing imported from Canvas yet.</p>
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
                      sourceCode={p.pairedCode}
                      courseCode={course.code}
                      slug={slug}
                      onImported={handleSlotImported}
                    />
                    {groupItems.length === 0 && (
                      <p className="px-3 py-2 text-[11px] text-muted-foreground">Nothing imported from Canvas yet.</p>
                    )}
                    {groupItems.map(m => renderMaterialRow(m))}
                  </div>
                );
              })}

              {/* Bundled mode footer: Reimport-all + Scan linked docs — once */}
              <div className="flex items-center gap-2 border-t px-3 py-2">
                {scanButton}
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
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
              {empty && <p className="px-3 py-3 text-[11px] text-muted-foreground">Nothing imported from Canvas yet.</p>}
              {canvas.map(m => renderMaterialRow(m))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
