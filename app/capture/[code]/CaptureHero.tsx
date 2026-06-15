/**
 * Goal-first landing hero for Course Capture's first-run (empty-conversation)
 * state. Answers, in plain GC-faculty language, the three questions a busy
 * instructor has on arrival: what am I doing here, am I ready, and what do I do
 * next. It now also owns the pre-start chooser (who's auditing + build-on vs.
 * fresh) — the controlled state lives in CaptureClient (single source) and is
 * shared with the chat panel's mid-session auditor badge + the start request.
 * The "Start audit" button itself stays in CaptureChatPanel directly below
 * (it owns postChat); this hero is the decision surface above it.
 *
 * Design: docs/superpowers/specs/2026-06-10-capture-ux-redesigns-design.md
 */

import { FACULTY_ROSTER } from '@/lib/faculty';

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
  mode: 'fresh' | 'continue';
  onModeChange: (v: 'fresh' | 'continue') => void;
  priorSnapshotInfo: { instructorName: string | null; createdAt: string } | null;
}) {
  const ready = materialsCount > 0;
  return (
    <section className="rounded-lg border bg-card px-6 py-7 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {courseCode} · Course capture
      </p>
      <h2 className="mt-1 text-xl font-semibold leading-snug">
        Capture what students should actually walk away knowing, understanding, and being able to do in{' '}
        {courseTitle}.
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Grounded in your materials, the AI interviews you and builds a record of what your
        course develops in students: not what the syllabus aspires to do, but what the evidence
        shows, and at what depth. This will become the foundation for everything that helps us
        strengthen the program for students: the curriculum map, prerequisite checks, and the
        line from coursework to careers. It can only see what you surface here, so the most valuable
        thing you can do is name, plainly, what your students actually do and how deeply they do
        it. Be candid: this maps the curriculum, not you, and any gaps that may surface simply
        show the program where to grow next, for this class and the ones after. Take as much time as you
        need to get it right; you can stop and pick up where you left off anytime.
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
            className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
          >
            I&apos;m the instructor
          </label>
          <select
            id="hero-chooser-instructor"
            value={instructor}
            onChange={e => onInstructorChange(e.target.value)}
            className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm"
          >
            {FACULTY_ROSTER.map(name => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        {priorSnapshotInfo && (
          <fieldset className="space-y-1">
            <legend className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Start mode
            </legend>
            <label className="flex items-start gap-2 rounded border border-transparent px-1 py-1 text-xs hover:bg-muted/40">
              <input
                type="radio"
                name="hero-chooser-mode"
                value="continue"
                checked={mode === 'continue'}
                onChange={() => onModeChange('continue')}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Build on prior capture</span>
                <span className="block text-[11px] text-muted-foreground">
                  {priorSnapshotInfo.instructorName ?? 'Unknown'}
                  {' · '}
                  {new Date(priorSnapshotInfo.createdAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded border border-transparent px-1 py-1 text-xs hover:bg-muted/40">
              <input
                type="radio"
                name="hero-chooser-mode"
                value="fresh"
                checked={mode === 'fresh'}
                onChange={() => onModeChange('fresh')}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Fresh capture</span>
                <span className="block text-[11px] text-muted-foreground">
                  Don&apos;t anchor on what previous instructors found — start from materials +
                  catalog only.
                </span>
              </span>
            </label>
          </fieldset>
        )}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">Start the interview just below ↓</p>
    </section>
  );
}
