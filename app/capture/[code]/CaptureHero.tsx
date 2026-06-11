/**
 * Goal-first landing hero for Course Capture's first-run (empty-conversation)
 * state. Answers, in plain GC-faculty language, the three questions a busy
 * instructor has on arrival: what am I doing here, am I ready, and what do I do
 * next. The actual pre-start chooser + "Start audit" button live in the
 * CaptureChatPanel directly below this hero (the hero points down to them);
 * materials / help / snapshots collapse into a disclosure further down.
 *
 * Design: docs/superpowers/specs/2026-06-10-capture-ux-redesigns-design.md
 */

export function CaptureHero({
  courseCode,
  courseTitle,
  materialsCount,
}: {
  courseCode: string;
  courseTitle: string;
  materialsCount: number;
}) {
  const ready = materialsCount > 0;
  return (
    <section className="rounded-lg border bg-card px-6 py-7 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {courseCode} · Course capture
      </p>
      <h2 className="mt-1 text-xl font-semibold leading-snug">
        Capture what students actually walk away knowing, understanding, and being able to do in{' '}
        {courseTitle}.
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        The AI interviews you about your course — grounded in your materials — and builds the
        evidence record. A few minutes; you can stop and pick up where you left off anytime.
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
      <p className="mt-4 text-xs text-muted-foreground">
        Choose who&apos;s auditing and start the interview just below ↓
      </p>
    </section>
  );
}
