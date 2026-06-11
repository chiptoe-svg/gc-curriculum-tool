'use client';

import { useRouter } from 'next/navigation';
import type { CaptureMaterial, CourseCatalogView } from './MaterialsPanel';
import { SyllabusBox } from './boxes/SyllabusBox';
import { CanvasBox } from './boxes/CanvasBox';
import { OtherMaterialsBox } from './boxes/OtherMaterialsBox';

interface Props {
  course: CourseCatalogView;
  materials: CaptureMaterial[];
  slug: string;
  catalogSyncedAt: string | null;
  onMaterialsChange: (next: CaptureMaterial[]) => void;
  onCourseChange: (next: CourseCatalogView) => void;
  onContinue: () => void;
}

/** ~4 chars/token rule of thumb (matches MaterialsPanel.estimateTokens). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function CaptureMaterialsStep({ course, materials, slug, catalogSyncedAt, onMaterialsChange, onCourseChange, onContinue }: Props) {
  useRouter();

  const active = materials.filter((m) => !m.ignored && !m.autoSetAside);
  const ignored = materials.length - active.length;
  const tokens = active.reduce((sum, m) => sum + (m.extractedText ? estimateTokens(m.extractedText) : 0), 0);
  const tokK = (tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1);

  // The empty-guard: nothing imported AND no synced syllabus → offer start-anyway.
  const hasSyncedSyllabus = catalogSyncedAt != null;
  const isEmpty = materials.length === 0 && !hasSyncedSyllabus;

  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="mb-1 flex items-center gap-2 font-mono-plex text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        <span>Step 1 of 2 · Confirm materials</span>
        <span aria-hidden className="text-foreground">●</span><span aria-hidden>──</span><span aria-hidden>○</span>
      </div>
      <h2 className="font-display text-xl font-semibold tracking-tight">Here&apos;s what the auditor will read.</h2>
      <p className="mt-1 text-sm text-muted-foreground">Three sources — syllabus, Canvas, and anything else. Unroll each to see what&apos;s inside and add what&apos;s missing before you start.</p>

      <div className="mt-4 space-y-3">
        <SyllabusBox
          course={course}
          catalogSyncedAt={catalogSyncedAt}
          materials={materials}
          slug={slug}
          onCourseChange={onCourseChange}
          onMaterialsChange={onMaterialsChange}
        />
        <CanvasBox
          course={course}
          materials={materials}
          slug={slug}
          onMaterialsChange={onMaterialsChange}
        />
        <OtherMaterialsBox
          course={course}
          materials={materials}
          slug={slug}
          onMaterialsChange={onMaterialsChange}
        />
      </div>

      <p className="mt-4 text-[11px] text-muted-foreground">
        {active.length} active · {ignored} ignored · ~{tokK}k tok
      </p>

      <div className="mt-6 flex items-center justify-end gap-4">
        {isEmpty ? (
          <button type="button" onClick={onContinue}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">Start without materials anyway →</button>
        ) : (
          <button type="button" onClick={onContinue}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90">Continue to interview →</button>
        )}
      </div>
    </div>
  );
}
