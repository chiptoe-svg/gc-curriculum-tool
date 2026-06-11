'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { isCanvasListMaterial, parseCanvasBlob } from '@/lib/canvas/parseCanvasBlob';
import { MaterialsPanel, IndexingStatusDot, type CaptureMaterial, type CourseCatalogView } from './MaterialsPanel';
import { fetchCourseMaterials } from '@/lib/capture/fetch-course-materials';
import {
  materialProvenance, PROVENANCE_LABEL, hasMaterials,
  catalogContributionSummary, materialReadability, relativeTimeFromNow, hasFixablyUnindexed,
} from '@/lib/capture/material-display';

interface Props {
  course: CourseCatalogView;
  materials: CaptureMaterial[];
  slug: string;
  catalogSyncedAt: string | null;
  onMaterialsChange: (next: CaptureMaterial[]) => void;
  onCourseChange: (next: CourseCatalogView) => void;
  onContinue: () => void;
}

export function CaptureMaterialsStep({ course, materials, slug, catalogSyncedAt, onMaterialsChange, onCourseChange, onContinue }: Props) {
  useRouter();
  const [showDetail, setShowDetail] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [syncedAt, setSyncedAt] = useState<string | null>(catalogSyncedAt);
  const [resyncing, setResyncing] = useState(false);
  const [resyncError, setResyncError] = useState<string | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);

  const ready = hasMaterials(materials.length);
  const showIndexNow = hasFixablyUnindexed(materials);

  async function resync() {
    setResyncing(true); setResyncError(null);
    try {
      const res = await fetch(`/api/courses/${encodeURIComponent(course.code)}/sync-from-sheet?slug=${encodeURIComponent(slug)}`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setResyncError(res.status === 404 ? 'no sheet tab for this course' : ((json as { error?: string }).error ?? 'sync failed')); return; }
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
    } catch { setResyncError('sync failed'); }
    finally { setResyncing(false); }
  }

  async function indexNow() {
    setIndexing(true); setIndexError(null);
    try {
      const res = await fetch(`/api/admin/v2-backfill?slug=${encodeURIComponent(slug)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ courseCode: course.code, slug }),
      });
      if (!res.ok) { setIndexError('indexing failed — try "Manage materials in detail"'); return; }
      const fresh = await fetchCourseMaterials(course.code, slug);
      if (fresh) onMaterialsChange(fresh);
    } catch { setIndexError('indexing failed'); }
    finally { setIndexing(false); }
  }

  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="mb-1 flex items-center gap-2 font-mono-plex text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        <span>Step 1 of 2 · Confirm materials</span>
        <span aria-hidden className="text-foreground">●</span><span aria-hidden>──</span><span aria-hidden>○</span>
      </div>
      <h2 className="font-display text-xl font-semibold tracking-tight">Here&apos;s what the auditor will read.</h2>
      <p className="mt-1 text-sm text-muted-foreground">Confirm the sources below — add anything missing before you start. This is the evidence the audit is grounded in.</p>

      {/* GC curriculum sheet catalog source */}
      <div className="mt-4 flex items-center gap-3 rounded-md border bg-muted/20 px-3 py-2.5">
        <span aria-hidden>📋</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">GC curriculum catalog</span>
            <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-800 dark:bg-sky-900/30 dark:text-sky-300">GC curriculum sheet</span>
          </div>
          <p className="truncate text-[11px] text-muted-foreground">{catalogContributionSummary(course)} · synced {relativeTimeFromNow(syncedAt, Date.now())}</p>
          {resyncError && <p className="text-[11px] text-amber-700 dark:text-amber-400">{resyncError}</p>}
        </div>
        <button type="button" onClick={resync} disabled={resyncing}
          className="shrink-0 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50">
          {resyncing ? 'Re-syncing…' : 'Re-sync'}
        </button>
      </div>

      {ready ? (
        <ul className="mt-3 divide-y rounded-md border">
          {materials.map((m) => {
            const prov = materialProvenance(m);
            const read = materialReadability(m);
            const dimmed = m.ignored || m.autoSetAside;
            const canvasList = isCanvasListMaterial(m.fileName);
            const open = !!expanded[m.id];
            const items = open && canvasList && m.extractedText ? parseCanvasBlob(m.extractedText) : [];
            const ignoredSet = new Set(m.ignoredItems ?? []);
            return (
              <li key={m.id} className={dimmed ? 'opacity-50' : ''}>
                <div className="flex items-center gap-3 px-3 py-2.5">
                  {canvasList ? (
                    <button type="button" aria-label={open ? 'Collapse items' : 'Expand items'}
                      onClick={() => setExpanded((e) => ({ ...e, [m.id]: !e[m.id] }))}
                      className="w-4 text-muted-foreground hover:text-foreground">{open ? '▾' : '▸'}</button>
                  ) : (<span aria-hidden className="w-4 text-center">📄</span>)}
                  <span className="min-w-0 flex-1 truncate text-sm">{m.fileName}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{PROVENANCE_LABEL[prov]}</span>
                  <span className={'flex items-center gap-1 text-[11px] ' + (read.readable ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-400')} title={read.reason ?? ''}>
                    <IndexingStatusDot status={m.indexingStatus} indexedAt={m.indexedAt} />
                    {read.label}{read.reason ? ` · ${read.reason}` : ''}
                  </span>
                </div>
                {open && (
                  <ul className="border-t bg-muted/20 px-9 py-2 text-[12px] text-muted-foreground">
                    {items.length === 0 ? <li>(no items)</li> : items.map((it, i) => (
                      <li key={i} className={ignoredSet.has(it.title) ? 'line-through opacity-60' : ''}>{it.title}</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-3 rounded-md border border-dashed px-4 py-6 text-center">
          <p className="text-sm font-medium">No documents added yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">The course catalog above is included, but uploaded documents make for stronger evidence.</p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setShowDetail(true)}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted">+ Add or import materials</button>
        {ready && (
          <button type="button" onClick={() => setShowDetail((v) => !v)}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">⚙ Manage materials in detail</button>
        )}
        {showIndexNow && (
          <button type="button" onClick={indexNow} disabled={indexing}
            className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:bg-amber-900/20 dark:text-amber-200">
            {indexing ? 'Indexing…' : 'Index now'}
          </button>
        )}
        {indexError && <span className="text-[11px] text-amber-700 dark:text-amber-400">{indexError}</span>}
      </div>

      {showDetail && (
        <div className="mt-4">
          <MaterialsPanel course={course} initialMaterials={materials} slug={slug}
            onMaterialsChange={onMaterialsChange} onCourseChange={onCourseChange} initiallyExpanded />
        </div>
      )}

      <div className="mt-6 flex items-center justify-end gap-4">
        {ready ? (
          <button type="button" onClick={onContinue}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90">Looks complete — continue to interview →</button>
        ) : (
          <button type="button" onClick={onContinue}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">Start without materials anyway →</button>
        )}
      </div>
    </div>
  );
}
