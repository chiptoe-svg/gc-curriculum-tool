/**
 * Render for courses that don't yet have a captured profile.
 *
 * Shows whatever the catalog/Google-Sheets carries — description,
 * learning objectives, major projects, prereqs, syllabus link — with a
 * prominent banner explaining that this is unaudited catalog text, not
 * a captured profile.
 *
 * Lives behind the same /view/[code] URL as the captured view so the
 * landing's View link is uniform regardless of capture state.
 */

interface CourseRow {
  code: string;
  title: string;
  description: string;
  prerequisites: string;
  syllabusUrl: string | null;
  learningObjectives: string[];
  majorProjects: string[];
}

interface Props {
  course: CourseRow;
  editHref: string | null;
}

export function CatalogFallbackView({ course, editHref }: Props) {
  const hasObjectives = course.learningObjectives.length > 0;
  const hasProjects = course.majorProjects.length > 0;
  const hasPrereqs = course.prerequisites.trim().length > 0;
  const hasDescription = course.description.trim().length > 0;

  return (
    <article className="space-y-10">
      <div className="rounded-md border border-stone-300 bg-stone-50 px-4 py-3 dark:border-stone-700 dark:bg-stone-900/30">
        <p className="font-mono-plex text-[10px] uppercase tracking-[0.18em] text-stone-700 dark:text-stone-300">
          Not yet audited
        </p>
        <p className="mt-1 text-sm text-stone-800 dark:text-stone-200">
          {course.code} hasn&apos;t been audited yet. Showing catalog data from the
          GC course list and the live syllabus.
          {editHref && (
            <>
              {' '}Faculty can start a capture via the{' '}
              <a href={editHref} className="font-medium underline-offset-2 hover:underline">
                Edit
              </a>
              {' '}button above.
            </>
          )}
        </p>
      </div>

      {hasDescription && (
        <section>
          <h2 className="mb-3 font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Catalog description
          </h2>
          <p className="font-display text-base leading-relaxed text-foreground">
            {course.description}
          </p>
        </section>
      )}

      {hasObjectives && (
        <section>
          <h2 className="mb-3 font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Learning objectives (catalog)
          </h2>
          <ul className="space-y-2">
            {course.learningObjectives.map((obj, i) => (
              <li key={i} className="text-sm leading-relaxed text-foreground">
                — {obj}
              </li>
            ))}
          </ul>
        </section>
      )}

      {hasProjects && (
        <section>
          <h2 className="mb-3 font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Major projects (catalog)
          </h2>
          <ul className="space-y-2">
            {course.majorProjects.map((p, i) => (
              <li key={i} className="text-sm leading-relaxed text-foreground">
                — {p}
              </li>
            ))}
          </ul>
        </section>
      )}

      {hasPrereqs && (
        <section>
          <h2 className="mb-3 font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Prerequisites
          </h2>
          <p className="text-sm text-foreground">{course.prerequisites}</p>
        </section>
      )}

      {course.syllabusUrl && (
        <section>
          <h2 className="mb-3 font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Live syllabus
          </h2>
          <a
            href={course.syllabusUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-foreground underline-offset-2 hover:underline"
          >
            Open {course.code} syllabus on Simple Syllabus →
          </a>
        </section>
      )}

      {!hasDescription && !hasObjectives && !hasProjects && !hasPrereqs && !course.syllabusUrl && (
        <p className="text-sm text-muted-foreground">
          No catalog content available for {course.code}.
        </p>
      )}
    </article>
  );
}
