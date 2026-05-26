'use client';

import { useRef, useState } from 'react';
import { CanvasImportZone } from '@/components/CanvasImportZone';

export interface CaptureMaterial {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number | null;
  extractionStatus: string;
  extractionMethod: string | null;
  extractedText: string | null;
  ignored: boolean;
}

export interface CourseCatalogView {
  code: string;
  title: string;
  description: string;
  prerequisites: string;
  learningObjectives: string[];
  majorProjects: string[];
  skillsRequired: string[];
}

interface Props {
  course: CourseCatalogView;
  initialMaterials: CaptureMaterial[];
  slug: string;
  onMaterialsChange?: (next: CaptureMaterial[]) => void;
  onCourseChange?: (next: CourseCatalogView) => void;
}

const ALLOWED_UPLOAD_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

function isCanvasMaterial(m: CaptureMaterial): boolean {
  return m.fileName.startsWith('Canvas:');
}

function isGoogleDocMaterial(m: CaptureMaterial): boolean {
  return m.fileName.startsWith('Google Doc:');
}

function isGoogleSlidesMaterial(m: CaptureMaterial): boolean {
  return m.fileName.startsWith('Google Slides:');
}

function isGoogleSheetMaterial(m: CaptureMaterial): boolean {
  return m.fileName.startsWith('Google Sheet:');
}

function isCanvasFileMaterial(m: CaptureMaterial): boolean {
  return m.fileName.startsWith('Canvas File:');
}

function isDrivePdfMaterial(m: CaptureMaterial): boolean {
  return m.fileName.startsWith('Drive PDF:');
}

function isYouTubeMaterial(m: CaptureMaterial): boolean {
  return m.fileName.startsWith('YouTube:');
}

function classifyCanvas(m: CaptureMaterial): string {
  if (!isCanvasMaterial(m)) return '';
  const name = m.fileName.replace(/^Canvas:\s*/, '').trim().toLowerCase();
  if (name.startsWith('syllabus')) return 'syllabus';
  if (name.startsWith('assignment')) return 'assignments';
  if (name.startsWith('module')) return 'modules';
  if (name.startsWith('page')) return 'pages';
  if (name.startsWith('discussion')) return 'discussions';
  if (name.startsWith('quiz')) return 'quizzes';
  return name;
}

function summarizeCanvas(m: CaptureMaterial): string {
  const text = m.extractedText ?? '';
  const kind = classifyCanvas(m);
  if (kind === 'assignments') {
    const lines = text.split('\n');
    let count = 0;
    let totalPts = 0;
    for (const line of lines) {
      const match = line.match(/^##\s+(.+?)\s+\((\d+(?:\.\d+)?)\s+pts?\)/i);
      if (match && match[2]) {
        count += 1;
        totalPts += parseFloat(match[2]);
      }
    }
    if (count > 0) return `${count} assignments · ${totalPts} total pts`;
  }
  if (kind === 'modules') {
    const moduleHeadings = (text.match(/^##\s+/gm) ?? []).length;
    if (moduleHeadings > 0) return `${moduleHeadings} modules`;
  }
  if (kind === 'pages') {
    const pageHeadings = (text.match(/^##\s+/gm) ?? []).length;
    const words = text.split(/\s+/).filter(Boolean).length;
    if (pageHeadings > 0) {
      return `${pageHeadings} page${pageHeadings === 1 ? '' : 's'} · ${words.toLocaleString()} words`;
    }
  }
  if (kind === 'discussions') {
    const count = (text.match(/^##\s+/gm) ?? []).length;
    if (count > 0) return `${count} discussion${count === 1 ? '' : 's'}`;
  }
  if (kind === 'quizzes') {
    const count = (text.match(/^##\s+/gm) ?? []).length;
    const questions = (text.match(/^Q\d+\s+\[/gm) ?? []).length;
    if (count > 0) return `${count} quiz${count === 1 ? '' : 'zes'} · ${questions} questions`;
  }
  if (kind === 'syllabus') {
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words > 0) return `${words.toLocaleString()} words`;
  }
  return '';
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Rough estimate matching OpenAI's ~4 chars/token rule of thumb for English.
// Good enough for spotting whales in the materials list; do not use for
// strict budgeting.
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens} tok`;
  return `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k tok`;
}

function StatusChip({ status }: { status: string }) {
  if (status === 'ok') {
    return <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-800">extracted</span>;
  }
  if (status === 'low_text') {
    return <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">low text</span>;
  }
  if (status === 'failed') {
    return <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800">failed</span>;
  }
  return <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">pending</span>;
}

function CatalogSummary({ course }: { course: CourseCatalogView }) {
  function listOrNone(items: string[]) {
    if (items.length === 0) return <p className="text-xs italic text-muted-foreground">(none)</p>;
    return (
      <ol className="list-decimal space-y-0.5 pl-4 text-xs leading-snug">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ol>
    );
  }
  return (
    <div className="space-y-3 rounded-md border bg-card px-4 py-3">
      <header>
        <h3 className="text-sm font-semibold">Catalog (from the course sheet)</h3>
        <p className="text-xs text-muted-foreground">
          Read-only here. Edit objectives/projects/skills in the Course Builder if you want them changed.
        </p>
      </header>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Description</p>
        <p className="mt-1 text-xs leading-snug">{course.description || <span className="italic text-muted-foreground">(none)</span>}</p>
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Prerequisites</p>
        <p className="mt-1 text-xs leading-snug">{course.prerequisites || <span className="italic text-muted-foreground">(none listed)</span>}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Learning objectives ({course.learningObjectives.length})
          </p>
          <div className="mt-1">{listOrNone(course.learningObjectives)}</div>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Major projects ({course.majorProjects.length})
          </p>
          <div className="mt-1">{listOrNone(course.majorProjects)}</div>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Required incoming skills ({course.skillsRequired.length})
          </p>
          <div className="mt-1">{listOrNone(course.skillsRequired)}</div>
        </div>
      </div>
    </div>
  );
}

function MaterialRow({
  material,
  onToggleIgnored,
  onDelete,
  busy,
}: {
  material: CaptureMaterial;
  onToggleIgnored: (next: boolean) => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const canvas = isCanvasMaterial(material);
  const gdoc = isGoogleDocMaterial(material);
  const gslides = isGoogleSlidesMaterial(material);
  const gsheet = isGoogleSheetMaterial(material);
  const canvasFile = isCanvasFileMaterial(material);
  const drivePdf = isDrivePdfMaterial(material);
  const youtube = isYouTubeMaterial(material);
  const summary = canvas ? summarizeCanvas(material) : '';
  const wordCount = material.extractedText ? material.extractedText.split(/\s+/).filter(Boolean).length : 0;
  const tokenEstimate = material.extractedText ? estimateTokens(material.extractedText) : 0;
  // Highlight materials that take a meaningful slice of the 272k input budget
  // so faculty can spot which ones to ignore when the audit chokes.
  const tokenTone =
    tokenEstimate >= 50_000 ? 'text-red-700 font-semibold'
      : tokenEstimate >= 20_000 ? 'text-amber-700'
      : '';

  return (
    <li className={'flex flex-col gap-1 px-3 py-2 ' + (material.ignored ? 'opacity-60' : '')}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium truncate">{material.fileName}</span>
            {canvas ? (
              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-800">Canvas</span>
            ) : canvasFile ? (
              <span className="rounded bg-cyan-100 px-1.5 py-0.5 text-[10px] font-medium text-cyan-800">Canvas File</span>
            ) : gdoc ? (
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">Google Doc</span>
            ) : gslides ? (
              <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] font-medium text-yellow-800">Google Slides</span>
            ) : gsheet ? (
              <span className="rounded bg-lime-100 px-1.5 py-0.5 text-[10px] font-medium text-lime-800">Google Sheet</span>
            ) : drivePdf ? (
              <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800">Drive PDF</span>
            ) : youtube ? (
              <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800">YouTube</span>
            ) : (
              <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-800">uploaded</span>
            )}
            <StatusChip status={material.extractionStatus} />
            {material.ignored && (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 border border-amber-200">
                ignored
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {summary && <span>{summary} · </span>}
            {material.pageCount !== null && <span>{material.pageCount} pages · </span>}
            {wordCount > 0 && <span>{wordCount.toLocaleString()} words · </span>}
            {tokenEstimate > 0 && (
              <span className={tokenTone} title="Approximate tokens this material contributes to the audit prompt (~4 chars/token). The audit input cap is 272k tokens total.">
                ~{formatTokens(tokenEstimate)} ·{' '}
              </span>
            )}
            <span>{humanSize(material.sizeBytes)}</span>
            {material.extractionMethod && <span> · via {material.extractionMethod}</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <label className="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <input
              type="checkbox"
              checked={material.ignored}
              onChange={e => onToggleIgnored(e.target.checked)}
              disabled={busy}
              className="h-3 w-3"
            />
            ignore
          </label>
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            disabled={!material.extractedText}
            className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            {expanded ? 'hide' : 'preview'}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-30"
          >
            delete
          </button>
        </div>
      </div>
      {expanded && material.extractedText && (
        <pre className="max-h-72 overflow-auto rounded border bg-muted/40 p-2 text-[11px] leading-snug whitespace-pre-wrap">
          {material.extractedText.slice(0, 8000)}
          {material.extractedText.length > 8000 && '\n\n…(truncated)'}
        </pre>
      )}
    </li>
  );
}

export function MaterialsPanel({ course, initialMaterials, slug, onMaterialsChange, onCourseChange }: Props) {
  const [materials, setMaterials] = useState<CaptureMaterial[]>(initialMaterials);
  const [busy, setBusy] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [canvasImportOpen, setCanvasImportOpen] = useState(false);
  const [materialsCollapsed, setMaterialsCollapsed] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  // Re-extract Canvas files: shows an inline token prompt when opened,
  // posts to /canvas-reextract, refreshes materials on success. Token
  // never persists — re-prompted each time.
  const [reextractOpen, setReextractOpen] = useState(false);
  const [reextractToken, setReextractToken] = useState('');
  const [reextracting, setReextracting] = useState(false);
  const [reextractMessage, setReextractMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleReextractCanvasFiles() {
    if (!reextractToken.trim()) {
      setReextractMessage({ kind: 'error', text: 'Canvas API token is required.' });
      return;
    }
    setReextracting(true);
    setReextractMessage(null);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(course.code)}/canvas-reextract`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ slug, canvasToken: reextractToken.trim() }),
        },
      );
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        const text = await res.text();
        setReextractMessage({
          kind: 'error',
          text: `Server returned ${res.status} with non-JSON response. ${text.length < 200 ? text : 'Check server logs.'}`,
        });
        return;
      }
      const json = await res.json() as {
        updated?: number;
        skipped?: number;
        results?: Array<{ fileName: string; status: string; reason?: string }>;
        error?: string;
      };
      if (!res.ok) {
        setReextractMessage({ kind: 'error', text: json.error ?? `Re-extract failed (${res.status})` });
        return;
      }
      const upd = json.updated ?? 0;
      const skp = json.skipped ?? 0;
      const parts = [`re-extracted ${upd} file${upd === 1 ? '' : 's'}`];
      if (skp > 0) parts.push(`${skp} skipped`);
      setReextractMessage({ kind: 'ok', text: parts.join(', ') + '.' });
      setReextractToken('');
      setReextractOpen(false);
      await refetchMaterialsFromContext();
    } catch (e) {
      setReextractMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Re-extract failed' });
    } finally {
      setReextracting(false);
    }
  }

  async function handleScanLinkedDocs() {
    setScanning(true);
    setScanMessage(null);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(course.code)}/scan-linked-docs?slug=${encodeURIComponent(slug)}`,
        { method: 'POST' },
      );
      const json = await res.json();
      if (!res.ok) {
        setScanMessage({ kind: 'error', text: (json as { error?: string }).error ?? `Scan failed (${res.status})` });
        return;
      }
      const { referenced, skipped, fetched, inaccessible, byKind, youtube_referenced, youtube_fetched, youtube_inaccessible, youtube_skipped, drive_referenced, drive_fetched, drive_inaccessible, drive_skipped } = json as {
        referenced: Array<{ kind: string; fileId: string }>;
        skipped: number; fetched: number; inaccessible: number;
        byKind?: { documents: number; presentations: number; spreadsheets?: number; youtube_videos: number; drive_pdfs?: number };
        youtube_referenced?: string[]; youtube_fetched?: number; youtube_inaccessible?: number; youtube_skipped?: number;
        drive_referenced?: string[]; drive_fetched?: number; drive_inaccessible?: number; drive_skipped?: number;
      };
      const totalReferenced = referenced.length + (youtube_referenced?.length ?? 0) + (drive_referenced?.length ?? 0);
      if (totalReferenced === 0) {
        setScanMessage({ kind: 'ok', text: 'No Google Workspace, Drive, or YouTube links found in current materials.' });
      } else {
        const parts: string[] = [];
        const totalFetched = fetched + (youtube_fetched ?? 0) + (drive_fetched ?? 0);
        if (totalFetched > 0) {
          const breakdown = [
            (byKind?.documents ?? 0) > 0 ? `${byKind?.documents} doc${byKind?.documents === 1 ? '' : 's'}` : null,
            (byKind?.presentations ?? 0) > 0 ? `${byKind?.presentations} deck${byKind?.presentations === 1 ? '' : 's'}` : null,
            (byKind?.spreadsheets ?? 0) > 0 ? `${byKind?.spreadsheets} sheet${byKind?.spreadsheets === 1 ? '' : 's'}` : null,
            (drive_fetched ?? 0) > 0 ? `${drive_fetched} Drive PDF${drive_fetched === 1 ? '' : 's'}` : null,
            (youtube_fetched ?? 0) > 0 ? `${youtube_fetched} YouTube transcript${youtube_fetched === 1 ? '' : 's'}` : null,
          ].filter(Boolean).join(', ');
          parts.push(`fetched ${totalFetched}${breakdown ? ` (${breakdown})` : ''}`);
        }
        const totalInaccessible = inaccessible + (youtube_inaccessible ?? 0) + (drive_inaccessible ?? 0);
        if (totalInaccessible > 0) parts.push(`${totalInaccessible} not accessible`);
        const totalSkipped = skipped + (youtube_skipped ?? 0) + (drive_skipped ?? 0);
        if (totalSkipped > 0) parts.push(`${totalSkipped} already stored`);
        setScanMessage({ kind: 'ok', text: `Found ${totalReferenced} linked item${totalReferenced === 1 ? '' : 's'}: ${parts.join(', ')}.` });
      }
      // Pick up the newly inserted material rows.
      await refetchMaterialsFromContext();
    } catch (e) {
      setScanMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Scan failed' });
    } finally {
      setScanning(false);
    }
  }

  async function refetchMaterialsFromContext(): Promise<void> {
    try {
      const res = await fetch(
        `/api/capture/${encodeURIComponent(course.code)}/context?slug=${encodeURIComponent(slug)}`,
      );
      if (!res.ok) return;
      const json = await res.json() as {
        materials: Array<{
          id: string;
          fileName: string;
          mimeType: string;
          sizeBytes: number;
          pageCount: number | null;
          extractionStatus: string;
          extractionMethod: string | null;
          extractedText: string | null;
          ignored: boolean;
        }>;
      };
      pushMaterials(json.materials);
    } catch {
      // best-effort refresh; user can always reload the page
    }
  }

  function handleCanvasImported() {
    // The CanvasImportZone calls onImported once per imported item with a
    // partial UploadedMaterial shape. Rather than reconcile partial shapes,
    // refetch the full materials list once after Canvas reports done.
    void refetchMaterialsFromContext();
  }

  async function handleSyncFromSheet() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(course.code)}/sync-from-sheet?slug=${encodeURIComponent(slug)}`,
        { method: 'POST' },
      );
      const json = await res.json();
      if (!res.ok) {
        setSyncMessage({ kind: 'error', text: (json as { error?: string }).error ?? `Sync failed (${res.status})` });
        return;
      }
      const updated = (json as { course: CourseCatalogView }).course;
      const merged: CourseCatalogView = {
        code: updated.code,
        title: updated.title,
        description: updated.description ?? '',
        prerequisites: updated.prerequisites ?? '',
        learningObjectives: updated.learningObjectives ?? [],
        majorProjects: updated.majorProjects ?? [],
        skillsRequired: updated.skillsRequired ?? [],
      };
      onCourseChange?.(merged);
      setSyncMessage({ kind: 'ok', text: 'Catalog synced from Google Sheet.' });
    } catch (e) {
      setSyncMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Sync failed' });
    } finally {
      setSyncing(false);
    }
  }

  function pushMaterials(next: CaptureMaterial[]) {
    setMaterials(next);
    onMaterialsChange?.(next);
  }

  async function toggleIgnored(id: string, ignored: boolean) {
    setBusy(id);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(course.code)}/materials/${encodeURIComponent(id)}?slug=${encodeURIComponent(slug)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ignored }),
        },
      );
      if (res.ok) {
        pushMaterials(materials.map(m => (m.id === id ? { ...m, ignored } : m)));
      }
    } finally {
      setBusy(null);
    }
  }

  async function deleteMaterial(id: string) {
    setBusy(id);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(course.code)}/materials/${encodeURIComponent(id)}?slug=${encodeURIComponent(slug)}`,
        { method: 'DELETE' },
      );
      if (res.ok) {
        pushMaterials(materials.filter(m => m.id !== id));
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleFiles(files: FileList | null) {
    setUploadError(null);
    if (!files || files.length === 0) return;
    const file = files[0]!;
    if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
      setUploadError('Only PDF or DOCX files are accepted.');
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
      const json = await res.json();
      if (!res.ok) {
        setUploadError((json as { error?: string }).error ?? `Upload failed (${res.status})`);
        return;
      }
      const data = json as {
        id: string;
        fileName: string;
        mimeType: string;
        sizeBytes: number;
        pageCount: number | null;
        extractionStatus: string;
        extractionMethod: string | null;
      };
      const newMaterial: CaptureMaterial = {
        id: data.id,
        fileName: data.fileName,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
        pageCount: data.pageCount,
        extractionStatus: data.extractionStatus,
        extractionMethod: data.extractionMethod,
        extractedText: null,  // server returns full row, but the upload response trims it — capture page will reload from /context if needed
        ignored: false,
      };
      pushMaterials([...materials, newMaterial]);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const ignoredCount = materials.filter(m => m.ignored).length;
  const activeCount = materials.length - ignoredCount;

  return (
    <section className="rounded-md border bg-card shadow-sm">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-2">
        <div>
          <h2 className="text-sm font-semibold">Materials &amp; catalog context</h2>
          <p className="text-[11px] text-muted-foreground">
            {activeCount} active material{activeCount === 1 ? '' : 's'}
            {ignoredCount > 0 && ` · ${ignoredCount} ignored`} ·{' '}
            {course.learningObjectives.length} objectives · {course.majorProjects.length} projects ·{' '}
            {course.skillsRequired.length} required skills
          </p>
          {syncMessage && (
            <p className={'mt-1 text-[11px] ' + (syncMessage.kind === 'ok' ? 'text-green-700' : 'text-destructive')}>
              {syncMessage.text}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSyncFromSheet}
            disabled={syncing}
            title="Pull the latest values from this course's Google Sheet tab"
            className="rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : 'Sync from sheet'}
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(c => !c)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {collapsed ? 'Show' : 'Hide'}
          </button>
        </div>
      </header>

      {!collapsed && (
        <div className="space-y-4 p-4">
          <CatalogSummary course={course} />

          <div className="rounded-md border bg-card">
            <header className="flex items-center justify-between gap-3 border-b px-3 py-2">
              <button
                type="button"
                onClick={() => setMaterialsCollapsed(c => !c)}
                aria-expanded={!materialsCollapsed}
                aria-controls="materials-list"
                title={materialsCollapsed ? 'Show materials list' : 'Hide materials list'}
                className="flex items-center gap-2 text-left -ml-1 px-1 rounded hover:bg-muted"
              >
                <span
                  aria-hidden="true"
                  className={'inline-block text-muted-foreground transition-transform ' + (materialsCollapsed ? '-rotate-90' : '')}
                  style={{ fontSize: '10px', lineHeight: 1 }}
                >▼</span>
                <span>
                  <h3 className="text-sm font-semibold">Materials ({materials.length})</h3>
                  {!materialsCollapsed && (
                    <p className="text-[11px] text-muted-foreground">
                      Ignored items stay in the database but don&apos;t feed the audit.
                    </p>
                  )}
                </span>
              </button>
              <div className="flex items-center gap-2">
                {materials.some(isCanvasFileMaterial) && (
                  <button
                    type="button"
                    onClick={() => setReextractOpen(o => !o)}
                    disabled={reextracting}
                    title="Re-extract every Canvas file attachment in this course through the current extraction pipeline. Useful after upgrading the extractor (e.g., switching to Docling) so existing rows pick up the better output."
                    className="rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    {reextracting ? 'Re-extracting…' : (reextractOpen ? 'Cancel re-extract' : 'Re-extract Canvas files')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleScanLinkedDocs}
                  disabled={scanning}
                  title="Find Google Docs, Slides, Sheets, Drive PDFs, and YouTube URLs in existing materials and pull in their content. Requires 'Anyone with the link can view' sharing on Google files; YouTube videos need captions."
                  className="rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  {scanning ? 'Scanning…' : 'Scan linked files'}
                </button>
                <button
                  type="button"
                  onClick={() => setCanvasImportOpen(o => !o)}
                  title="Pull syllabus, assignments, and module list from a Canvas course"
                  className="rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {canvasImportOpen ? 'Hide Canvas import' : 'Import from Canvas'}
                </button>
              </div>
            </header>
            {!materialsCollapsed && (
              <>
                {scanMessage && (
                  <p className={'border-b px-3 py-1.5 text-[11px] ' + (scanMessage.kind === 'ok' ? 'text-green-700 bg-green-50' : 'text-destructive bg-red-50')}>
                    {scanMessage.text}
                  </p>
                )}
                {reextractMessage && (
                  <p className={'border-b px-3 py-1.5 text-[11px] ' + (reextractMessage.kind === 'ok' ? 'text-green-700 bg-green-50' : 'text-destructive bg-red-50')}>
                    {reextractMessage.text}
                  </p>
                )}
                {reextractOpen && (
                  <div className="border-b bg-muted/30 px-3 py-2 space-y-2">
                    <label className="block text-[11px] text-muted-foreground" htmlFor="reextract-token">
                      Canvas API token (used once, not stored). Same token as for &quot;Import from Canvas&quot;.
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id="reextract-token"
                        type="password"
                        value={reextractToken}
                        onChange={e => setReextractToken(e.target.value)}
                        placeholder="Your Canvas access token"
                        className="flex-1 rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <button
                        type="button"
                        onClick={handleReextractCanvasFiles}
                        disabled={reextracting || !reextractToken.trim()}
                        className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {reextracting ? 'Re-extracting…' : 'Start'}
                      </button>
                    </div>
                  </div>
                )}
                {materials.length === 0 ? (
                  <p className="px-3 py-6 text-center text-xs italic text-muted-foreground">
                    No materials yet. Upload a PDF or DOCX below.
                  </p>
                ) : (
                  <ul id="materials-list" className="divide-y">
                    {materials.map(m => (
                      <MaterialRow
                        key={m.id}
                        material={m}
                        onToggleIgnored={next => toggleIgnored(m.id, next)}
                        onDelete={() => deleteMaterial(m.id)}
                        busy={busy === m.id}
                      />
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          <CanvasImportZone
            courseCode={course.code}
            slug={slug}
            onImported={handleCanvasImported}
            open={canvasImportOpen}
            onOpenChange={setCanvasImportOpen}
          />

          <div className="rounded-md border border-dashed bg-muted/20 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Add a material</p>
                <p className="text-xs text-muted-foreground">PDF or DOCX, up to 15 MB.</p>
              </div>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={uploading !== null}
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                {uploading ? `Uploading ${uploading}…` : 'Choose file'}
              </button>
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={e => handleFiles(e.target.files)}
                className="hidden"
              />
            </div>
            {uploadError && <p className="mt-2 text-xs text-destructive">{uploadError}</p>}
            <p className="mt-2 text-[11px] text-muted-foreground">
              To pull from Canvas (syllabus, assignments, modules), use the Course Builder Materials tab.
              Imports land here automatically.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
