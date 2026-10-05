'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CatalogOverview } from '../CatalogOverview';
import type { CaptureMaterial, CourseCatalogView } from '../MaterialsPanel';
import { fetchCourseMaterials } from '@/lib/capture/fetch-course-materials';
import { uploadFileWithProgress } from '@/lib/capture/upload-with-progress';
import { UploadProgressBar, type UploadProgressState } from '../UploadProgressBar';
import {
  isSyllabusCanvasMaterial,
  materialProvenance,
  catalogContributionSummary,
  syllabusMaterials,
  syllabusReadinessLabel,
  PROVENANCE_LABEL,
} from '@/lib/capture/material-display';

interface Props {
  course: CourseCatalogView;
  /** When the GC-sheet catalog was last synced (ISO), or null if never. */
  catalogSyncedAt: string | null;
  materials: CaptureMaterial[];
  slug: string;
  onCourseChange: (next: CourseCatalogView) => void;
  onMaterialsChange: (next: CaptureMaterial[]) => void;
  /** Two-phase triage flow: uploads wait for the Ingest step, so "pending" is expected. */
  triageEnabled?: boolean;
}

const ALLOWED_UPLOAD_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/**
 * One recognised syllabus (flagged is_syllabus, uploaded or Canvas) with its
 * readiness, and — when it is set aside — the reason plus the include control.
 * Include mirrors OtherMaterialsBox's FERPA include-anyway: optimistic local
 * update, PATCH {ignored:false}, revert + error on failure.
 */
function SyllabusRow({
  m,
  courseCode,
  slug,
  triageEnabled,
  allMaterials,
  onMaterialsChange,
}: {
  m: CaptureMaterial;
  courseCode: string;
  slug: string;
  triageEnabled: boolean;
  allMaterials: CaptureMaterial[];
  onMaterialsChange: (next: CaptureMaterial[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function include(): Promise<void> {
    setBusy(true);
    setError(null);
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
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Failed (${res.status})`);
      }
    } catch (e) {
      onMaterialsChange(previous);
      setError(e instanceof Error ? e.message : 'Failed to include');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-1 px-3 py-2">
      <div className="flex items-center gap-2">
        <span aria-hidden className="w-4 shrink-0 text-center text-sm">📄</span>
        <span className="min-w-0 flex-1 truncate text-sm">{m.fileName}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {PROVENANCE_LABEL[materialProvenance(m)]}
        </span>
        <span className={'shrink-0 text-[11px] ' + (m.ignored ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>
          {syllabusReadinessLabel(m, triageEnabled)}
        </span>
      </div>
      {m.ignored && (
        <div className="flex items-start justify-between gap-2 rounded border border-amber-200 bg-amber-50/50 px-2 py-1">
          <p className="text-[11px] leading-snug italic text-amber-800">
            {m.setAsideReason ?? (m.autoSetAside ? 'set aside automatically' : 'set aside by hand')}
          </p>
          <button
            type="button"
            onClick={() => void include()}
            disabled={busy}
            className="shrink-0 text-[11px] font-medium text-amber-900 underline hover:text-amber-700 disabled:opacity-50"
          >
            {busy ? 'Including…' : m.autoSetAside ? 'Include anyway' : 'Include'}
          </button>
        </div>
      )}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </li>
  );
}

/**
 * Box 1 of the three-source capture surface — the course's syllabus / catalog
 * context. The syllabus is required (owner decision 2026-10-05): it is found by
 * the is_syllabus flag, listed here whether uploaded or imported from Canvas,
 * and until one exists the box shows the required notice and Step 1 cannot be
 * passed. The synced GC-sheet catalog is still shown when unrolled; when it and
 * an uploaded syllabus both exist we surface a discrepancy note (never merge).
 */
export function SyllabusBox({
  course,
  catalogSyncedAt,
  materials,
  slug,
  onCourseChange,
  onMaterialsChange,
  triageEnabled = false,
}: Props) {
  useRouter();
  const [open, setOpen] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(catalogSyncedAt);
  const [resyncing, setResyncing] = useState(false);
  const [resyncError, setResyncError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [progress, setProgress] = useState<UploadProgressState | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const syllabi = syllabusMaterials(materials);
  const hasSyllabus = syllabi.length > 0;
  // An attached syllabus = a flagged syllabus that faculty uploaded (not Canvas).
  const attachedSyllabus = syllabi.find((m) => materialProvenance(m) === 'uploaded');
  // A stamp alone isn't enough — Google returns non-errors for missing tabs,
  // so the sync-from-sheet route may have written a blank row in the past.
  // Require real catalog content (non-empty summary) in addition to a syncedAt
  // timestamp so legacy wrongly-stamped rows don't show as "synced".
  const hasCatalogContent = catalogContributionSummary(course) !== 'no catalog details synced yet';
  const hasSheetCatalog = syncedAt !== null && hasCatalogContent;
  const hasCanvasSyllabus = materials.some(isSyllabusCanvasMaterial);

  // Differ-warning: a sheet catalog AND a separately-attached syllabus are both
  // present — two syllabus sources that may disagree. Surface, never merge.
  const showDiffer = hasSheetCatalog && !!attachedSyllabus;

  const statusText = hasSheetCatalog
    ? `synced to Google Sheet on ${new Date(syncedAt!).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' })}`
    : attachedSyllabus
      ? `${attachedSyllabus.fileName} attached`
      : syncedAt !== null && !hasCatalogContent
        ? 'not in the Google Sheet — attach a syllabus'
        : 'add a syllabus';

  async function resync() {
    setResyncing(true);
    setResyncError(null);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(course.code)}/sync-from-sheet?slug=${encodeURIComponent(slug)}`,
        { method: 'POST' },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResyncError(
          res.status === 404 ? 'no sheet tab for this course' : ((json as { error?: string }).error ?? 'sync failed'),
        );
        return;
      }
      const c = (json as { course?: Record<string, unknown> }).course;
      if (c) {
        onCourseChange({
          ...course,
          description: (c.description as string) ?? course.description,
          prerequisites: (c.prerequisites as string) ?? course.prerequisites,
          learningObjectives: (c.learningObjectives as string[]) ?? course.learningObjectives,
          majorProjects: (c.majorProjects as string[]) ?? course.majorProjects,
          skillsRequired: (c.skillsRequired as string[]) ?? course.skillsRequired,
        });
        setSyncedAt((c.lastSyncedAt as string) ?? new Date().toISOString());
      }
    } catch {
      setResyncError('sync failed');
    } finally {
      setResyncing(false);
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
    setProgress({ fileName: file.name, index: 1, total: 1, pct: 0 });
    try {
      const res = await uploadFileWithProgress({
        url: `/api/courses/${encodeURIComponent(course.code)}/materials`,
        file,
        slug,
        role: 'syllabus',
        onProgress: (p) => setProgress({ fileName: file.name, index: 1, total: 1, pct: p.pct }),
      });
      if (!res.ok) {
        setUploadError((res.json as { error?: string }).error ?? `Upload failed (${res.status})`);
        return;
      }
      const fresh = await fetchCourseMaterials(course.code, slug);
      if (fresh) onMaterialsChange(fresh);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(null);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <section className="rounded-md border bg-card">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
        >
          <span aria-hidden className="w-4 text-muted-foreground">
            {open ? '▾' : '▸'}
          </span>
          <span aria-hidden className="w-5 text-center">📋</span>
          <span className="text-sm font-medium">Syllabus &amp; course info</span>
          <span className="truncate text-xs text-muted-foreground">— {statusText}</span>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {(hasSheetCatalog || (syncedAt !== null && !hasCatalogContent)) && (
            <button
              type="button"
              onClick={resync}
              disabled={resyncing}
              className="rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              {resyncing ? 'Re-syncing…' : 'Re-sync'}
            </button>
          )}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading !== null}
            title={hasSheetCatalog
              ? 'Attach a syllabus document — it will be used alongside the synced Google-Sheet catalog; differences are surfaced, never merged'
              : undefined}
            className="rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            {uploading ? 'Attaching…' : hasSheetCatalog ? 'Replace syllabus' : 'Attach a syllabus'}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      </div>

      {!hasSyllabus && (
        <p
          role="alert"
          className="mx-4 mb-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-900 dark:bg-amber-900/20 dark:text-amber-200"
        >
          Add the course syllabus: import it from Canvas or upload it here.
        </p>
      )}

      {hasSyllabus && (
        <ul aria-label="Syllabus materials" className="mx-4 mb-2 divide-y rounded border">
          {syllabi.map((m) => (
            <SyllabusRow
              key={m.id}
              m={m}
              courseCode={course.code}
              slug={slug}
              triageEnabled={triageEnabled}
              allMaterials={materials}
              onMaterialsChange={onMaterialsChange}
            />
          ))}
        </ul>
      )}

      {progress && (
        <div className="px-4 pb-2">
          <UploadProgressBar state={progress} />
        </div>
      )}
      {resyncError && <p className="px-4 pb-1 text-[11px] text-amber-700 dark:text-amber-400">{resyncError}</p>}
      {uploadError && <p className="px-4 pb-1 text-[11px] text-amber-700 dark:text-amber-400">{uploadError}</p>}

      {showDiffer && (
        <p className="mx-4 mb-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          ⚠ a different syllabus is also attached — review
        </p>
      )}

      {open && (
        <div className="border-t px-4 py-3">
          <CatalogOverview
            description={course.description}
            prerequisites={course.prerequisites}
            learningObjectives={course.learningObjectives}
            majorProjects={course.majorProjects}
            skillsRequired={course.skillsRequired}
          />
          {hasCanvasSyllabus && (
            <p className="mt-2 text-[11px] italic text-muted-foreground">
              (a Canvas syllabus is also available — see Canvas)
            </p>
          )}
        </div>
      )}
    </section>
  );
}
