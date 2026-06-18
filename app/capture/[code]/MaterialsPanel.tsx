'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CanvasImportZone } from '@/components/CanvasImportZone';
import { parseCanvasBlob, isCanvasListMaterial } from '@/lib/canvas/parseCanvasBlob';
import { fetchCourseMaterials } from '@/lib/capture/fetch-course-materials';
import { CatalogOverview } from './CatalogOverview';

export type IndexingStatus = 'pending' | 'queued' | 'indexing' | 'ready' | 'failed' | 'skipped';
export type FerpaRisk = 'low' | 'medium' | 'high';
export type AuditMode = 'full' | 'simple';

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
  digest: string | null;
  digestGeneratedAt: string | null;
  useDigest: boolean;
  indexingStatus: IndexingStatus;
  indexedAt: string | null;
  ferpaRisk: FerpaRisk;
  autoSetAside: boolean;
  setAsideReason: string | null;
  /**
   * Remote URL for materials whose content lives off-server: YouTube,
   * Google Doc/Slides/Sheet, Drive PDF, Canvas File. UI surfaces it as
   * a small ↗ link next to the filename so faculty can verify which
   * underlying resource a row maps to. For local uploads this is the
   * internal blob path; the link is hidden for those.
   */
  blobUrl: string;
  /**
   * Per-item ignore list for Canvas-list materials. Empty/undefined for
   * other materials. Item titles are the full `## Title` text after the
   * marker (importer adds inline tags like `[unpublished]`; those are
   * part of the title here).
   */
  ignoredItems?: readonly string[];
  /**
   * Which paired course code this material was imported from. Null for
   * materials belonging to the primary course. Set when the Canvas import
   * route ingests materials from a bundled lecture/lab pair.
   */
  sourceCode: string | null;
  /**
   * Triage tier assigned during the two-phase ingestion flow. null means
   * not yet classified (treated as 'high' in TriageStep — full pipeline,
   * current behavior; faculty can downgrade). Persisted in DB; set by the
   * Canvas import route and the triage PATCH endpoint.
   */
  tier: 'high' | 'middle' | 'background' | null;
}

export interface CourseCatalogView {
  code: string;
  title: string;
  description: string;
  prerequisites: string;
  learningObjectives: string[];
  majorProjects: string[];
  skillsRequired: string[];
  auditMode: AuditMode;
  /** Canvas course name — set by the canvas-import route; null until first import. */
  canvasCourseName: string | null;
  /** ISO timestamp of the most recent Canvas import; null until first import. */
  canvasImportedAt: string | null;
  /** Paired (lecture/lab) codes bundled under this course; [] when not bundled. */
  pairedCodes: Array<{ pairedCode: string; role: 'lecture' | 'lab' | 'other'; canvasImportedAt: string | null }>;
}

interface Props {
  course: CourseCatalogView;
  initialMaterials: CaptureMaterial[];
  slug: string;
  onMaterialsChange?: (next: CaptureMaterial[]) => void;
  onCourseChange?: (next: CourseCatalogView) => void;
  /** When true, the panel mounts expanded instead of collapsed. Defaults to collapsed elsewhere. */
  initiallyExpanded?: boolean;
  /**
   * When true, hide the per-material row list and show a one-line note pointing
   * faculty to the source boxes above. The header, bulk-op buttons, and token
   * chip remain visible. Default false (chat stage keeps the full panel).
   *
   * Step 1 (CaptureMaterialsStep) sets this to true — per-material controls
   * (ignore, preview, AI summary, delete, FERPA include-anyway) live in the
   * three source boxes there, so duplicating them in the manager creates a
   * confusing parity surface.
   */
  hideRows?: boolean;
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

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export function IndexingStatusDot({ status, indexedAt }: { status: IndexingStatus; indexedAt: string | null }) {
  const color =
    status === 'ready' ? '#10B981'
      : status === 'indexing' ? '#F59E0B'
      : status === 'queued' ? '#F59E0B'
      : status === 'failed' ? '#EF4444'
      : '#9CA3AF';
  const tooltip = (() => {
    const base =
      status === 'ready' ? 'ready'
        : status === 'indexing' ? 'indexing'
        : status === 'queued' ? 'queued — indexing in background'
        : status === 'failed' ? 'failed'
        : status === 'skipped' ? 'skipped'
        : 'pending';
    if (status === 'ready' && indexedAt) {
      return `${base} · indexed ${formatRelativeTime(indexedAt)}`;
    }
    return base;
  })();
  return (
    <span
      aria-label={`indexing status: ${status}`}
      title={tooltip}
      className={'inline-block shrink-0 rounded-full ' + (status === 'indexing' || status === 'queued' ? 'animate-pulse' : '')}
      style={{ width: '10px', height: '10px', backgroundColor: color }}
    />
  );
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
  return (
    <CatalogOverview
      description={course.description}
      prerequisites={course.prerequisites}
      learningObjectives={course.learningObjectives}
      majorProjects={course.majorProjects}
      skillsRequired={course.skillsRequired}
    />
  );
}

function MaterialRow({
  material,
  onToggleIgnored,
  onDelete,
  onToggleUseDigest,
  onIncludeAnyway,
  onDowngradeFerpa,
  onSetIgnoredItems,
  busy,
}: {
  material: CaptureMaterial;
  onToggleIgnored: (next: boolean) => void;
  onDelete: () => void;
  onToggleUseDigest: (next: boolean) => void;
  onIncludeAnyway: () => Promise<void>;
  onDowngradeFerpa: () => Promise<void>;
  onSetIgnoredItems: (next: string[]) => Promise<void>;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [itemsExpanded, setItemsExpanded] = useState(false);
  const [ferpaWidgetOpen, setFerpaWidgetOpen] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [ferpaError, setFerpaError] = useState<string | null>(null);
  const [overrideBusy, setOverrideBusy] = useState(false);
  const [ferpaBusy, setFerpaBusy] = useState(false);
  const isCanvasList = isCanvasListMaterial(material.fileName);
  const items = useMemo(
    () => (isCanvasList && material.extractedText ? parseCanvasBlob(material.extractedText) : []),
    [isCanvasList, material.extractedText],
  );
  const ignoredItemTitles = useMemo(
    () => new Set(material.ignoredItems ?? []),
    [material.ignoredItems],
  );
  const ignoredItemCount = ignoredItemTitles.size;
  const itemRowsBusy = busy;

  async function toggleItemIgnored(itemTitle: string, ignored: boolean) {
    const current = Array.from(ignoredItemTitles);
    const next = ignored
      ? Array.from(new Set([...current, itemTitle]))
      : current.filter(t => t !== itemTitle);
    await onSetIgnoredItems(next);
  }
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
  const digestTokenEstimate = material.digest ? estimateTokens(material.digest) : 0;
  const usingDigest = material.useDigest && material.digest !== null;
  // Highlight materials that take a meaningful slice of the 272k input budget
  // so faculty can spot which ones to ignore when the audit chokes.
  const tokenTone =
    tokenEstimate >= 50_000 ? 'text-red-700 font-semibold'
      : tokenEstimate >= 20_000 ? 'text-amber-700'
      : '';

  const skippedIndex = material.indexingStatus === 'skipped';
  // The row is visually dimmed when faculty (or policy) excluded it from
  // the audit. Skipped-by-indexing materials get the same strike-through
  // treatment as auto-set-aside rows so faculty can spot them at a glance.
  const rowDimmed = material.ignored || skippedIndex;
  const filenameStrike = skippedIndex || (material.ignored && material.autoSetAside);

  async function handleIncludeAnyway() {
    setOverrideError(null);
    setOverrideBusy(true);
    try {
      await onIncludeAnyway();
    } catch (e) {
      setOverrideError(e instanceof Error ? e.message : 'Failed to include');
    } finally {
      setOverrideBusy(false);
    }
  }

  async function handleDowngradeFerpa() {
    setFerpaError(null);
    setFerpaBusy(true);
    try {
      await onDowngradeFerpa();
      setFerpaWidgetOpen(false);
    } catch (e) {
      setFerpaError(e instanceof Error ? e.message : 'Failed to downgrade');
    } finally {
      setFerpaBusy(false);
    }
  }

  return (
    <li className={'flex flex-col gap-1 px-3 py-2 ' + (rowDimmed ? 'opacity-60' : '')}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <IndexingStatusDot status={material.indexingStatus} indexedAt={material.indexedAt} />
            <span className={'text-sm font-medium truncate ' + (filenameStrike ? 'line-through' : '')}>{material.fileName}</span>
            {(youtube || gdoc || gslides || gsheet || canvasFile || drivePdf) && /^https?:\/\//.test(material.blobUrl) && (
              <a
                href={material.blobUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground"
                title={material.blobUrl}
              >
                ↗
              </a>
            )}
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
            {material.digest && (
              <span
                className={
                  'rounded px-1.5 py-0.5 text-[10px] font-medium ' +
                  (usingDigest
                    ? 'bg-teal-100 text-teal-800'
                    : 'bg-slate-100 text-slate-600')
                }
                title={
                  usingDigest
                    ? 'The interview prompt uses this material\'s structured AI summary instead of its full extracted text.'
                    : 'An AI summary exists but is currently disabled — the interview uses the full extracted text.'
                }
              >
                {usingDigest ? `AI summary (~${formatTokens(digestTokenEstimate)})` : 'AI summary off'}
              </span>
            )}
            {material.ignored && (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 border border-amber-200">
                ignored
              </span>
            )}
            {material.ferpaRisk !== 'low' && (
              <button
                type="button"
                onClick={() => setFerpaWidgetOpen(o => !o)}
                title="FERPA risk band — click to review or downgrade if it's a false positive."
                className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 hover:bg-amber-100"
              >
                {material.ferpaRisk === 'high'
                  ? 'Student names + IDs detected'
                  : 'Student names detected — FERPA review'}
              </button>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {summary && <span>{summary} · </span>}
            {material.pageCount !== null && <span>{material.pageCount} pages · </span>}
            {wordCount > 0 && <span>{wordCount.toLocaleString()} words · </span>}
            {tokenEstimate > 0 && (
              <span className={tokenTone} title="Approximate tokens this material contributes to the interview prompt (~4 chars/token). The interview input cap is 272k tokens total.">
                ~{formatTokens(tokenEstimate)} ·{' '}
              </span>
            )}
            {usingDigest && digestTokenEstimate > 0 && (
              <span className="text-teal-700" title="Tokens the AI summary contributes to the interview prompt (replaces the full token count shown above).">
                interview sends ~{formatTokens(digestTokenEstimate)} ·{' '}
              </span>
            )}
            <span>{humanSize(material.sizeBytes)}</span>
            {material.extractionMethod && <span> · via {material.extractionMethod}</span>}
          </p>
          {(material.ignored || material.autoSetAside) && (
            <div className="mt-1 flex items-start justify-between gap-2 rounded border border-amber-200 bg-amber-50/50 px-2 py-1">
              <p className="text-[11px] leading-snug text-amber-800">
                <span className="font-medium">Why ignored:</span>{' '}
                {material.setAsideReason
                  ?? (material.fileName.startsWith('Canvas: Syllabus')
                        ? "the Sheets catalog already lists this course's learning objectives and projects, so the Canvas syllabus would duplicate them"
                        : material.autoSetAside
                          ? 'flagged by the materials policy'
                          : 'manually toggled off by the faculty reviewer')}
                {material.autoSetAside && !material.ignored && (
                  <span className="ml-1 italic text-amber-700">(overridden — included in interview)</span>
                )}
              </p>
              {material.autoSetAside && material.ignored && (
                <button
                  type="button"
                  onClick={handleIncludeAnyway}
                  disabled={busy || overrideBusy}
                  className="shrink-0 text-[11px] font-medium text-amber-900 underline hover:text-amber-700 disabled:opacity-50"
                >
                  {overrideBusy ? 'Including…' : 'Include anyway'}
                </button>
              )}
            </div>
          )}
          {overrideError && (
            <p className="mt-1 text-[11px] text-destructive">{overrideError}</p>
          )}
          {ferpaWidgetOpen && (
            <div className="mt-1 flex flex-wrap items-center gap-2 rounded border border-amber-200 bg-amber-50/50 px-2 py-1.5 text-[11px]">
              <button
                type="button"
                onClick={handleDowngradeFerpa}
                disabled={ferpaBusy}
                className="rounded border border-amber-300 bg-white px-1.5 py-0.5 font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              >
                {ferpaBusy ? 'Saving…' : 'Mark as low (false positive)'}
              </button>
              <button
                type="button"
                onClick={() => setFerpaWidgetOpen(false)}
                disabled={ferpaBusy}
                className="rounded border border-amber-300 bg-white px-1.5 py-0.5 font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              >
                Keep the flag
              </button>
              <button
                type="button"
                onClick={() => setFerpaWidgetOpen(false)}
                disabled={ferpaBusy}
                className="text-amber-700 underline hover:text-amber-900 disabled:opacity-50"
              >
                Cancel
              </button>
              {ferpaError && <span className="text-destructive">{ferpaError}</span>}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {material.digest && (
            <label className="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
              <input
                type="checkbox"
                checked={material.useDigest}
                onChange={e => onToggleUseDigest(e.target.checked)}
                disabled={busy}
                className="h-3 w-3"
              />
              AI summary
            </label>
          )}
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
      {isCanvasList && items.length > 0 && !material.ignored && (
        <div className="mt-1 ml-5 text-[11px] text-muted-foreground">
          <button
            type="button"
            onClick={() => setItemsExpanded(e => !e)}
            className="flex items-center gap-1 hover:text-foreground"
          >
            <span>{itemsExpanded ? '▾' : '▸'}</span>
            <span>
              {items.length} item{items.length === 1 ? '' : 's'}
              {ignoredItemCount > 0 && ` · ${ignoredItemCount} ignored`}
              {!itemsExpanded && ignoredItemCount === 0 && ' — click to manage'}
            </span>
          </button>
          {itemsExpanded && (
            <ul className="mt-1 max-h-60 overflow-auto rounded border bg-muted/30 px-2 py-1.5 space-y-0.5">
              {items.map(it => {
                const ignored = ignoredItemTitles.has(it.title);
                return (
                  <li key={`${it.ordinalIndex}-${it.title}`} className="flex items-start gap-2 py-0.5">
                    <input
                      type="checkbox"
                      checked={!ignored}
                      onChange={e => toggleItemIgnored(it.title, !e.target.checked)}
                      disabled={itemRowsBusy}
                      className="mt-0.5 h-3 w-3 flex-shrink-0"
                      title={ignored ? 'Included — uncheck to ignore' : 'Ignored — check to re-include'}
                    />
                    <span className={ignored ? 'line-through opacity-50' : ''}>{it.title}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

export function MaterialsPanel({ course, initialMaterials, slug, onMaterialsChange, onCourseChange, initiallyExpanded, hideRows }: Props) {
  const [materials, setMaterials] = useState<CaptureMaterial[]>(initialMaterials);
  const [busy, setBusy] = useState<string | null>(null);
  // Collapsed by default — the header summary (counts + token size + a
  // plain-language "large" chip) stays visible, so faculty see status at a
  // glance without the full materials list adding to page density. They open
  // it with "Show" when they actually need to manage materials.
  const [collapsed, setCollapsed] = useState(!initiallyExpanded);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadBgMessage, setUploadBgMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [canvasImportOpen, setCanvasImportOpen] = useState(false);
  const [materialsCollapsed, setMaterialsCollapsed] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [compressing, setCompressing] = useState(false);
  const [compressMessage, setCompressMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [auditModeOpen, setAuditModeOpen] = useState(false);
  const [auditModeBusy, setAuditModeBusy] = useState(false);
  const [auditModeError, setAuditModeError] = useState<string | null>(null);
  // Re-extract Canvas files: shows an inline token prompt when opened,
  // posts to /canvas-reextract, refreshes materials on success. Token
  // never persists — re-prompted each time.
  const [reextractOpen, setReextractOpen] = useState(false);
  const [reextractToken, setReextractToken] = useState('');
  const [reextracting, setReextracting] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [wipeError, setWipeError] = useState<string | null>(null);
  const [reextractMessage, setReextractMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Poll for status updates while any row is still in-flight (queued or indexing).
  // The background worker drains queued → indexing → ready/failed/skipped; we keep
  // refreshing until all rows reach a terminal state.
  useEffect(() => {
    const inFlight = materials.some(
      (m) => m.indexingStatus === 'queued' || m.indexingStatus === 'indexing',
    );
    if (!inFlight) return;
    const id = setInterval(() => { void refetchMaterialsFromContext(); }, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materials]);

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
    const fresh = await fetchCourseMaterials(course.code, slug);
    if (fresh) pushMaterials(fresh);
    // best-effort refresh; user can always reload the page on null
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
        auditMode: updated.auditMode ?? course.auditMode,
        canvasCourseName: course.canvasCourseName,
        canvasImportedAt: course.canvasImportedAt,
        pairedCodes: course.pairedCodes,
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

  async function toggleUseDigest(id: string, useDigest: boolean) {
    setBusy(id);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(course.code)}/materials/${encodeURIComponent(id)}?slug=${encodeURIComponent(slug)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ useDigest }),
        },
      );
      if (res.ok) {
        pushMaterials(materials.map(m => (m.id === id ? { ...m, useDigest } : m)));
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleCompressMaterials() {
    setCompressing(true);
    setCompressMessage(null);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(course.code)}/materials/compress?slug=${encodeURIComponent(slug)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      const json = await res.json() as {
        summarized?: number; skipped?: number; failed?: number; error?: string;
      };
      if (!res.ok) {
        setCompressMessage({ kind: 'error', text: json.error ?? `Compress failed (${res.status})` });
        return;
      }
      const parts = [`summarized ${json.summarized ?? 0}`];
      if ((json.skipped ?? 0) > 0) parts.push(`${json.skipped} skipped`);
      if ((json.failed ?? 0) > 0) parts.push(`${json.failed} failed`);
      setCompressMessage({ kind: (json.failed ?? 0) > 0 ? 'error' : 'ok', text: parts.join(', ') + '.' });
      await refetchMaterialsFromContext();
    } catch (e) {
      setCompressMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Compress failed' });
    } finally {
      setCompressing(false);
    }
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

  // Optimistic — local state first, revert on failure. Used by per-item
  // disclosure on Canvas-list materials. The audit-context builder filters
  // these titles out before sending text to the AI.
  async function setIgnoredItems(id: string, ignoredItems: string[]): Promise<void> {
    const previous = materials;
    pushMaterials(materials.map(m => (m.id === id ? { ...m, ignoredItems } : m)));
    setBusy(id);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(course.code)}/materials/${encodeURIComponent(id)}?slug=${encodeURIComponent(slug)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ignoredItems }),
        },
      );
      if (!res.ok) {
        pushMaterials(previous);
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Failed (${res.status})`);
      }
    } finally {
      setBusy(null);
    }
  }

  // Faculty override: include an auto-set-aside material in the audit by
  // flipping `ignored` off while leaving `autoSetAside` true (audit trail).
  // Optimistic — local state first, revert + rethrow on failure so the row
  // can surface the inline error.
  async function includeAutoSetAside(id: string): Promise<void> {
    const previous = materials;
    const next = materials.map(m => (m.id === id ? { ...m, ignored: false } : m));
    pushMaterials(next);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(course.code)}/materials/${encodeURIComponent(id)}?slug=${encodeURIComponent(slug)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ignored: false }),
        },
      );
      if (!res.ok) {
        pushMaterials(previous);
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Failed (${res.status})`);
      }
    } catch (e) {
      pushMaterials(previous);
      throw e;
    }
  }

  // Faculty downgrade of a FERPA flag — typically a false positive.
  // Optimistic, with revert on failure.
  async function downgradeFerpa(id: string): Promise<void> {
    const previous = materials;
    const next = materials.map(m => (m.id === id ? { ...m, ferpaRisk: 'low' as const } : m));
    pushMaterials(next);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(course.code)}/materials/${encodeURIComponent(id)}?slug=${encodeURIComponent(slug)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ferpaRisk: 'low' }),
        },
      );
      if (!res.ok) {
        pushMaterials(previous);
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Failed (${res.status})`);
      }
    } catch (e) {
      pushMaterials(previous);
      throw e;
    }
  }

  async function setAuditMode(next: AuditMode): Promise<void> {
    if (next === course.auditMode) {
      setAuditModeOpen(false);
      return;
    }
    setAuditModeBusy(true);
    setAuditModeError(null);
    const previousCourse = course;
    // Optimistic local update via the parent's onCourseChange.
    onCourseChange?.({ ...course, auditMode: next });
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(course.code)}?slug=${encodeURIComponent(slug)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ auditMode: next }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        onCourseChange?.(previousCourse);
        setAuditModeError(body.error ?? `Failed (${res.status})`);
        return;
      }
      setAuditModeOpen(false);
    } catch (e) {
      onCourseChange?.(previousCourse);
      setAuditModeError(e instanceof Error ? e.message : 'Failed to update audit mode');
    } finally {
      setAuditModeBusy(false);
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

  // Bulk wipe: deletes every material for the course (rows + Weaviate chunks
  // + import provenance) via the collection DELETE route. Gated behind a
  // two-step confirmation since it's irreversible.
  async function handleWipeAll() {
    setWiping(true);
    setWipeError(null);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(course.code)}/materials?slug=${encodeURIComponent(slug)}`,
        { method: 'DELETE' },
      );
      if (res.ok) {
        pushMaterials([]);
        setConfirmWipe(false);
      } else {
        const json = await res.json().catch(() => ({})) as { error?: string };
        setWipeError(json.error ?? `Wipe failed (${res.status})`);
      }
    } catch (e) {
      setWipeError(e instanceof Error ? e.message : 'Wipe failed');
    } finally {
      setWiping(false);
    }
  }

  async function handleFiles(files: FileList | null) {
    setUploadError(null);
    if (!files || files.length === 0) return;
    const all = Array.from(files);
    const accepted = all.filter(f => ALLOWED_UPLOAD_TYPES.has(f.type));
    const skipped = all.filter(f => !ALLOWED_UPLOAD_TYPES.has(f.type)).map(f => f.name);
    if (accepted.length === 0) {
      setUploadError('Only PDF or DOCX files are accepted.');
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    const added: CaptureMaterial[] = [];
    const failures: string[] = [];
    let queuedCount = 0;
    try {
      // Upload sequentially — each POST stores + enqueues and returns fast
      // (background ingest), so a batch is cheap and avoids a request burst.
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
          // The POST response is trimmed to {id, fileName, blobUrl, indexingStatus}
          // (extraction now runs in the background worker), so build the optimistic
          // row from the local File; the polling effect refreshes it to terminal.
          const data = json as { id: string; fileName: string; blobUrl?: string; indexingStatus?: IndexingStatus };
          added.push({
            id: data.id,
            fileName: data.fileName ?? file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            pageCount: null,
            extractionStatus: 'pending',
            extractionMethod: null,
            extractedText: null,
            ignored: false,
            digest: null,
            digestGeneratedAt: null,
            useDigest: false,
            indexingStatus: data.indexingStatus ?? 'queued',
            indexedAt: null,
            ferpaRisk: 'low',
            autoSetAside: false,
            setAsideReason: null,
            blobUrl: data.blobUrl ?? '',
            sourceCode: null,
            tier: null,
          });
          if (data.indexingStatus === 'queued') queuedCount++;
        } catch (e) {
          failures.push(`${file.name}: ${e instanceof Error ? e.message : 'upload failed'}`);
        }
      }
      if (added.length > 0) pushMaterials([...materials, ...added]);
      if (queuedCount > 0) {
        setUploadBgMessage(`${queuedCount} file${queuedCount === 1 ? '' : 's'} uploaded — indexing in the background. You can keep working; status updates here when ready.`);
      }
      if (failures.length > 0 || skipped.length > 0) {
        const parts: string[] = [];
        if (failures.length) parts.push(`${failures.length} failed — ${failures.join('; ')}`);
        if (skipped.length) parts.push(`Skipped (only PDF/DOCX): ${skipped.join(', ')}`);
        setUploadError(parts.join(' · '));
      }
    } finally {
      setUploading(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const ignoredCount = materials.filter(m => m.ignored).length;
  const activeCount = materials.length - ignoredCount;

  // Rough sum of what the audit chat will actually send: per-material
  // effective text (digest when useDigest && digest, else raw extracted
  // text). Catalog + profile + system prompt add ~5–10k tokens on top —
  // small relative to the materials, so we don't account for them here.
  const totalAuditTokens = materials
    .filter(m => !m.ignored)
    .reduce((sum, m) => {
      const text = m.useDigest && m.digest ? m.digest : (m.extractedText ?? '');
      return sum + estimateTokens(text);
    }, 0);
  // Calibrated against the gpt-5.4-mini 272k cap (the floor) so faculty
  // get a warning well before they actually break — even though
  // capture-chat now runs on the wider gpt-5.4 window.
  const totalTone =
    totalAuditTokens >= 220_000 ? 'text-red-700 font-semibold'
      : totalAuditTokens >= 150_000 ? 'text-amber-700'
      : 'text-muted-foreground';
  const compressionHint =
    totalAuditTokens >= 220_000
      ? 'Approaching the interview-prompt cap. Compress reference materials below, then ignore uploads you don\'t need.'
      : totalAuditTokens >= 150_000
      ? 'Getting large. Compressing reference materials below will shrink this.'
      : '';

  return (
    <section className="rounded-md border bg-card shadow-sm">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            Materials &amp; catalog context
            {totalAuditTokens >= 150_000 && (
              <span
                className={
                  'rounded-full px-2 py-0.5 text-[10px] font-medium ' +
                  (totalAuditTokens >= 220_000 ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800')
                }
                title="The active materials are large for the interview prompt — open this panel and compress/ignore some before starting."
              >
                {totalAuditTokens >= 220_000 ? 'Very large — review before starting' : 'Large — review before starting'}
              </span>
            )}
          </h2>
          <p className="text-[11px] text-muted-foreground">
            {activeCount} active material{activeCount === 1 ? '' : 's'}
            {ignoredCount > 0 && ` · ${ignoredCount} ignored`} ·{' '}
            {course.learningObjectives.length} objectives · {course.majorProjects.length} projects ·{' '}
            {course.skillsRequired.length} required skills
          </p>
          {totalAuditTokens > 0 && (
            <p
              className={'text-[11px] ' + totalTone}
              title="Estimated tokens the interview prompt will carry from your active materials. The interview input cap is 272k tokens; aim to stay well under it."
            >
              Interview prompt: ~{formatTokens(totalAuditTokens)} from materials
              {compressionHint && <span className="ml-1 font-normal">— {compressionHint}</span>}
            </p>
          )}
          {syncMessage && (
            <p className={'mt-1 text-[11px] ' + (syncMessage.kind === 'ok' ? 'text-green-700' : 'text-destructive')}>
              {syncMessage.text}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setAuditModeOpen(o => !o)}
              disabled={auditModeBusy}
              title="Simple mode skips chunk indexing for this course; the agent runs against AI summaries inline. Switch to Full to enable retrieval."
              className="rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              Interview mode: {course.auditMode === 'simple' ? 'Simple' : 'Full'} {auditModeOpen ? '▴' : '▾'}
            </button>
            {auditModeOpen && (
              <div className="absolute right-0 top-full z-10 mt-1 w-56 rounded-md border bg-card shadow-md">
                <button
                  type="button"
                  onClick={() => void setAuditMode('full')}
                  disabled={auditModeBusy}
                  className={
                    'block w-full px-3 py-1.5 text-left text-xs hover:bg-muted ' +
                    (course.auditMode === 'full' ? 'font-medium text-foreground' : 'text-muted-foreground')
                  }
                >
                  Full {course.auditMode === 'full' && '✓'}
                  <span className="block text-[10px] text-muted-foreground">Retrieval enabled (default).</span>
                </button>
                <button
                  type="button"
                  onClick={() => void setAuditMode('simple')}
                  disabled={auditModeBusy}
                  className={
                    'block w-full border-t px-3 py-1.5 text-left text-xs hover:bg-muted ' +
                    (course.auditMode === 'simple' ? 'font-medium text-foreground' : 'text-muted-foreground')
                  }
                >
                  Simple {course.auditMode === 'simple' && '✓'}
                  <span className="block text-[10px] text-muted-foreground">Skip indexing; AI summaries inline.</span>
                </button>
                {auditModeError && (
                  <p className="border-t px-3 py-1.5 text-[10px] text-destructive">{auditModeError}</p>
                )}
              </div>
            )}
          </div>
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
                  <h3 className="text-sm font-semibold">{hideRows ? `${materials.length} materials feed the interview` : `Materials (${materials.length})`}</h3>
                  {!materialsCollapsed && (
                    <p className="text-[11px] text-muted-foreground">
                      Ignored items stay in the database but don&apos;t feed the interview.
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
                  onClick={handleCompressMaterials}
                  disabled={compressing}
                  title="One-time backfill: generate structured AI summaries for any long reference materials uploaded before auto-compression shipped. New uploads are summarized automatically."
                  className="rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  {compressing ? 'Regenerating…' : 'Regenerate AI summaries'}
                </button>
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
                {materials.length > 0 && !confirmWipe && (
                  <button
                    type="button"
                    onClick={() => { setWipeError(null); setConfirmWipe(true); }}
                    title="Delete every material on this course — DB rows, files, and indexed chunks. Cannot be undone."
                    className="rounded-md border border-destructive/40 bg-background px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/10"
                  >
                    Clear all materials
                  </button>
                )}
              </div>
            </header>
            {confirmWipe && (
              <div className="border-b border-destructive/30 bg-destructive/5 px-3 py-2.5">
                <p className="text-xs font-medium text-destructive">
                  Delete all {materials.length} material{materials.length === 1 ? '' : 's'} on {course.code}? This removes their files and indexed chunks too, and can&apos;t be undone.
                </p>
                {wipeError && <p className="mt-1 text-[11px] text-destructive">{wipeError}</p>}
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleWipeAll}
                    disabled={wiping}
                    className="rounded-md bg-destructive px-2.5 py-1 text-xs font-semibold text-destructive-foreground shadow-sm hover:bg-destructive/90 disabled:opacity-50"
                  >
                    {wiping ? 'Deleting…' : `Yes, delete all ${materials.length}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmWipe(false)}
                    disabled={wiping}
                    className="rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {/* hideRows: per-row controls live in the three source boxes above (Step 1).
                The chat stage (CaptureClient trays) never sets hideRows, so it keeps full rows. */}
            {hideRows ? (
              <p className="px-3 py-2.5 text-[11px] text-muted-foreground italic">
The materials themselves — and their per-item controls (ignore, preview, AI summary, delete) — are listed in the three source boxes above. This panel is just for bulk actions.
              </p>
            ) : !materialsCollapsed && (
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
                {compressMessage && (
                  <p className={'border-b px-3 py-1.5 text-[11px] ' + (compressMessage.kind === 'ok' ? 'text-green-700 bg-green-50' : 'text-destructive bg-red-50')}>
                    {compressMessage.text}
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
                        onToggleUseDigest={next => toggleUseDigest(m.id, next)}
                        onIncludeAnyway={() => includeAutoSetAside(m.id)}
                        onDowngradeFerpa={() => downgradeFerpa(m.id)}
                        onSetIgnoredItems={next => setIgnoredItems(m.id, next)}
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

          {!hideRows && (
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
                  {uploading ? `Uploading ${uploading}…` : 'Choose files'}
                </button>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  multiple
                  onChange={e => handleFiles(e.target.files)}
                  className="hidden"
                />
              </div>
              {uploadError && <p className="mt-2 text-xs text-destructive">{uploadError}</p>}
              {uploadBgMessage && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{uploadBgMessage}</p>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">
                To pull from Canvas (syllabus, assignments, modules), use the Course Builder Materials tab.
                Imports land here automatically.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
