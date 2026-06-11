'use client';

import { useState } from 'react';
import { MaterialsPanel, IndexingStatusDot, type CaptureMaterial, type CourseCatalogView } from './MaterialsPanel';
import { materialProvenance, PROVENANCE_LABEL, indexingStatusLabel, hasMaterials } from '@/lib/capture/material-display';

interface Props {
  course: CourseCatalogView;
  materials: CaptureMaterial[];
  slug: string;
  onMaterialsChange: (next: CaptureMaterial[]) => void;
  onCourseChange: (next: CourseCatalogView) => void;
  onContinue: () => void;
}

export function CaptureMaterialsStep({ course, materials, slug, onMaterialsChange, onCourseChange, onContinue }: Props) {
  const [showDetail, setShowDetail] = useState(false);
  const ready = hasMaterials(materials.length);

  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="mb-1 flex items-center gap-2 font-mono-plex text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        <span>Step 1 of 2 · Confirm materials</span>
        <span aria-hidden className="text-foreground">●</span><span aria-hidden>──</span><span aria-hidden>○</span>
      </div>
      <h2 className="font-display text-xl font-semibold tracking-tight">
        Here&apos;s what the auditor will read.
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Confirm the materials below — add anything missing before you start. This is the evidence the audit is grounded in.
      </p>

      {ready ? (
        <ul className="mt-4 divide-y rounded-md border">
          {materials.map((m) => {
            const prov = materialProvenance(m);
            const dimmed = m.ignored || m.autoSetAside;
            return (
              <li key={m.id} className={'flex items-center gap-3 px-3 py-2.5 ' + (dimmed ? 'opacity-50' : '')}>
                <span aria-hidden>📄</span>
                <span className="flex-1 truncate text-sm">{m.fileName}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {PROVENANCE_LABEL[prov]}
                </span>
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <IndexingStatusDot status={m.indexingStatus} indexedAt={m.indexedAt} />
                  {indexingStatusLabel(m.indexingStatus)}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-4 rounded-md border border-dashed px-4 py-6 text-center">
          <p className="text-sm font-medium">No materials loaded yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add a syllabus, assignment, or other course document so the audit has something to read.
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setShowDetail(true)}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
        >
          + Add a material
        </button>
        {ready && (
          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            ⚙ Manage materials in detail
          </button>
        )}
      </div>

      {showDetail && (
        <div className="mt-4">
          <MaterialsPanel
            course={course}
            initialMaterials={materials}
            slug={slug}
            onMaterialsChange={onMaterialsChange}
            onCourseChange={onCourseChange}
            initiallyExpanded
          />
        </div>
      )}

      <div className="mt-6 flex items-center justify-end gap-4">
        {ready ? (
          <button
            type="button"
            onClick={onContinue}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
          >
            Looks complete — continue to interview →
          </button>
        ) : (
          <button
            type="button"
            onClick={onContinue}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Start without materials anyway →
          </button>
        )}
      </div>
    </div>
  );
}
