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
} from '@/lib/capture/material-display';

interface Props {
  course: CourseCatalogView;
  /** When the GC-sheet catalog was last synced (ISO), or null if never. */
  catalogSyncedAt: string | null;
  materials: CaptureMaterial[];
  slug: string;
  onCourseChange: (next: CourseCatalogView) => void;
  onMaterialsChange: (next: CaptureMaterial[]) => void;
}

const ALLOWED_UPLOAD_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/**
 * Box 1 of the three-source capture surface — the course's syllabus / catalog
 * context. The synced GC-sheet catalog is the free default; a faculty member
 * may *also* attach a syllabus document. When more than one source is present
 * and they differ we surface a discrepancy note (never silently merge). The
 * Canvas syllabus page lives in the Canvas box; here we only note that it
 * exists. Collapsed = a one-line summary + sync status + actions; unrolled =
 * the <CatalogOverview/> block (read-only; edit in Course Builder).
 */
export function SyllabusBox({
  course,
  catalogSyncedAt,
  materials,
  slug,
  onCourseChange,
  onMaterialsChange,
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

  // An attached syllabus = a non-Canvas, non-linked material whose name reads
  // like a syllabus (uploaded by faculty as "the syllabus"). The Canvas
  // syllabus list is intentionally excluded — it lives in the Canvas box.
  const attachedSyllabus = materials.find(
    (m) =>
      materialProvenance(m) === 'uploaded' &&
      /syllab/i.test(m.fileName) &&
      !isSyllabusCanvasMaterial(m),
  );
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
    : syncedAt !== null && !hasCatalogContent
      ? 'not in the Google Sheet — attach a syllabus'
      : attachedSyllabus
        ? `${attachedSyllabus.fileName} attached`
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

      {!hasSheetCatalog && !attachedSyllabus && (
        <p className="px-4 pb-2 text-[11px] text-muted-foreground">
          No syllabus yet — attach one above, or import it from Canvas.
        </p>
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
