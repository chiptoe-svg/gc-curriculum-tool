/**
 * Shared "why this matters" explainer for Course Capture. Rendered on both the
 * Step 1 materials screen and the Step 2 interview hero so the framing is
 * authored once and stays consistent across the flow.
 */
export function CaptureWhyBlurb({ className = '' }: { className?: string }) {
  return (
    <p className={`max-w-2xl text-sm text-muted-foreground ${className}`}>
      Grounded in your materials, the AI interviews you and builds a record of what your
      course develops in students: not what the syllabus aspires to do, but what the evidence
      shows, and at what depth. It can only see what you surface here, so name plainly what
      your students actually do and how deeply they do it. This step is foundational for
      optimizing curriculum paths, expanding career opportunities, and strengthening the
      program for students. Be candid: this maps the curriculum, and any gaps that may surface
      simply show where the program can grow next. Take as much time as you need to get it
      right; you can stop and pick up where you left off anytime.
    </p>
  );
}
