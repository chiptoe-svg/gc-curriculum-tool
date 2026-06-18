'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MaterialsPanel, type CaptureMaterial, type CourseCatalogView } from './MaterialsPanel';
import { SyllabusBox } from './boxes/SyllabusBox';
import { CanvasBox } from './boxes/CanvasBox';
import { OtherMaterialsBox } from './boxes/OtherMaterialsBox';
import { InstructorSelect } from './InstructorSelect';
import { CaptureWhyBlurb } from './CaptureWhyBlurb';

interface Props {
  course: CourseCatalogView;
  materials: CaptureMaterial[];
  slug: string;
  catalogSyncedAt: string | null;
  onMaterialsChange: (next: CaptureMaterial[]) => void;
  onCourseChange: (next: CourseCatalogView) => void;
  onContinue: () => void;
  instructor: string;
  onInstructorChange: (v: string) => void;
  /** When true: Canvas-first box order, wide blurb, INSTRUCTIONS paragraph,
   *  and relabeled continue button. Default false = byte-for-byte legacy UI. */
  triageEnabled?: boolean;
  /** Show the .imscc cartridge fallback in the Canvas box. False for Clemson
   *  faculty (they have a Canvas API token); true for external testers. */
  showImscc?: boolean;
}

/** ~4 chars/token rule of thumb (matches MaterialsPanel.estimateTokens). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function CaptureMaterialsStep({ course, materials, slug, catalogSyncedAt, onMaterialsChange, onCourseChange, onContinue, instructor, onInstructorChange, triageEnabled = false, showImscc = false }: Props) {
  useRouter();
  const [showManager, setShowManager] = useState(false);

  // Overridden FERPA/auto rows (autoSetAside but no longer ignored) count as
  // active — they're included in the interview.
  const active = materials.filter((m) => !m.ignored);
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
      <h2 className="font-display text-xl font-semibold tracking-tight">Here&apos;s what we&apos;ll work from.</h2>
      <CaptureWhyBlurb className="mt-2" wide={triageEnabled} />
      <p className="mt-3 text-sm text-muted-foreground">Three sources — syllabus, Canvas, and anything else. Unroll each to see what&apos;s inside and add what&apos;s missing before you start.</p>
      {triageEnabled && (
        <p className="mt-3 text-sm text-muted-foreground">
          <span className="font-mono-plex text-[11px] uppercase tracking-[0.18em] text-muted-foreground">INSTRUCTIONS</span>{' '}
          Surface everything that surrounds this course — Canvas, syllabus, assignment sheets, rubrics, project briefs, slide decks, readings, exemplars — because the AI can only reason from what&apos;s here, and{' '}
          <strong className="font-semibold text-foreground">more is better</strong>: thin input yields a thin record.
        </p>
      )}

      <div className="mt-3 flex items-center gap-3">
        <label
          htmlFor="step1-auditor"
          className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
        >
          I&apos;m the instructor
        </label>
        <InstructorSelect
          id="step1-auditor"
          value={instructor}
          onChange={onInstructorChange}
          className="rounded border border-input bg-background px-2 py-1 text-sm"
        />
      </div>

      <div className="mt-4 space-y-3">
        {triageEnabled ? (
          <>
            <CanvasBox
              course={course}
              materials={materials}
              slug={slug}
              onMaterialsChange={onMaterialsChange}
              triageEnabled
              showImscc={showImscc}
            />
            <SyllabusBox
              course={course}
              catalogSyncedAt={catalogSyncedAt}
              materials={materials}
              slug={slug}
              onCourseChange={onCourseChange}
              onMaterialsChange={onMaterialsChange}
            />
            <OtherMaterialsBox
              course={course}
              materials={materials}
              slug={slug}
              onMaterialsChange={onMaterialsChange}
              triageEnabled
            />
          </>
        ) : (
          <>
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
              showImscc={showImscc}
            />
            <OtherMaterialsBox
              course={course}
              materials={materials}
              slug={slug}
              onMaterialsChange={onMaterialsChange}
            />
          </>
        )}
      </div>

      {/* Aggregate counters dropped 2026-06-12 (operator walkthrough: "what is
          this? not sure it is needed" — the boxes already summarize themselves,
          and row-counts read confusingly against parsed item-counts). The token
          figure returns ONLY as a warning when the corpus is genuinely large
          (same 150k threshold as MaterialsPanel's review-before-starting chip). */}
      {tokens >= 150_000 && (
        <p className="mt-4 text-[11px] text-amber-700 dark:text-amber-400">
          ~{tokK}k tokens of material — large; consider ignoring or summarizing items before starting (see the materials manager below).
        </p>
      )}

      {/* Bulk-operations panel: Regenerate AI summaries / Scan linked files /
          Import from Canvas — the per-material row list is hidden here because
          ignore, preview, AI summary, delete, and FERPA include-anyway all live
          in the three source boxes above. hideRows avoids duplicating that parity
          surface while keeping the bulk-op affordances available. */}
      <div className="mt-4 border-t pt-4">
        <button
          type="button"
          onClick={() => setShowManager((v) => !v)}
          className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          {showManager ? '⚙ Hide material tools' : '⚙ Material tools (regenerate · scan · import)'}
        </button>
        {showManager && (
          <div className="mt-3">
            <MaterialsPanel
              course={course}
              initialMaterials={materials}
              slug={slug}
              onMaterialsChange={onMaterialsChange}
              onCourseChange={onCourseChange}
              initiallyExpanded
              hideRows
            />
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-end gap-4">
        {isEmpty ? (
          <button type="button" onClick={onContinue}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">Start without materials anyway →</button>
        ) : (
          <button type="button" onClick={onContinue}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90">
            {triageEnabled ? 'Continue →' : 'Continue to interview →'}
          </button>
        )}
      </div>
    </div>
  );
}
