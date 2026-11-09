/**
 * Goal-first landing hero for Course Capture's first-run (empty-conversation)
 * state. Answers, in plain GC-faculty language, the three questions a busy
 * instructor has on arrival: what am I doing here, am I ready, and what do I do
 * next. It now also owns the pre-start chooser (who's auditing + the revision
 * mode for an approved course) — the controlled state lives in CaptureClient (single source) and is
 * shared with the chat panel's mid-session auditor badge + the start request.
 * The "Start audit" button itself stays in CaptureChatPanel directly below
 * (it owns postChat); this hero is the decision surface above it.
 *
 * Design: docs/superpowers/specs/2026-06-10-capture-ux-redesigns-design.md
 */

import { InstructorSelect } from './InstructorSelect';
import { REVISION_HEADING, REVISION_MODES, REVISION_MODE_COPY, type RevisionMode } from '@/lib/capture/revision-copy';

export function CaptureHero({
  courseCode,
  courseTitle,
  materialsCount,
  instructor,
  onInstructorChange,
  mode,
  onModeChange,
  priorSnapshotInfo,
}: {
  courseCode: string;
  courseTitle: string;
  materialsCount: number;
  instructor: string;
  onInstructorChange: (v: string) => void;
  /** Revision mode for a course with an approved snapshot; null until chosen. */
  mode: RevisionMode | null;
  onModeChange: (v: RevisionMode) => void;
  priorSnapshotInfo: { instructorName: string | null; createdAt: string } | null;
}) {
  const ready = materialsCount > 0;
  return (
    <section className="rounded-lg border bg-card px-6 py-7 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {courseCode} · Course capture
      </p>
      <h2 className="mt-1 text-xl font-semibold leading-snug">
        Capture what students should actually walk away knowing, understanding, and being able to do in{' '}
        {courseTitle}.
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Your materials are set. Now I&apos;ll interview you about the course and build the
        evidence record from your answers, so reply in as much depth as you can. You can stop
        and pick up where you left off anytime.
      </p>
      <p
        className={
          'mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ' +
          (ready ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800')
        }
      >
        {ready
          ? `Ready to capture — ${materialsCount} material${materialsCount === 1 ? '' : 's'} loaded`
          : 'No materials yet — you can still start from the catalog (add materials below for a richer interview)'}
      </p>

      {/* Pre-start chooser (controlled by CaptureClient). The Start button is in
          the chat panel just below. */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label
            htmlFor="hero-chooser-instructor"
            className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground"
          >
            I&apos;m the instructor
          </label>
          <InstructorSelect
            id="hero-chooser-instructor"
            value={instructor}
            onChange={onInstructorChange}
          />
        </div>

        {priorSnapshotInfo && (
          <fieldset className="space-y-1 sm:col-span-2">
            <legend className="text-sm font-semibold">{REVISION_HEADING}</legend>
            <p className="text-xs text-muted-foreground">
              Approved version: {priorSnapshotInfo.instructorName ?? 'Unknown'}
              {' · '}
              {new Date(priorSnapshotInfo.createdAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
            {REVISION_MODES.map(m => (
              <label
                key={m}
                className="flex items-start gap-2 rounded border border-transparent px-1 py-1 text-xs hover:bg-muted/40"
              >
                <input
                  type="radio"
                  name="hero-chooser-mode"
                  value={m}
                  checked={mode === m}
                  onChange={() => onModeChange(m)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">{REVISION_MODE_COPY[m].label}</span>
                  <span className="block text-xs text-muted-foreground">{REVISION_MODE_COPY[m].description}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">Start the interview just below ↓</p>
    </section>
  );
}
