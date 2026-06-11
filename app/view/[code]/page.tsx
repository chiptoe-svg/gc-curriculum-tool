import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db/client';
import { eq, desc, and, isNull } from 'drizzle-orm';
import { courses, courseCaptureSnapshots } from '@/lib/db/schema';
import { CapturedView } from './CapturedView';
import { CatalogFallbackView } from './CatalogFallbackView';
import { fetchLiveCourseFromSheet } from '@/lib/sheets/fetchLiveCourse';
import { redactPiiDeep } from '@/lib/capture/redact-pii';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ code: string }>;
}

/**
 * Public HTTP read-only profile view. No slug, no Basic Auth — anyone on
 * the LAN can read a course's captured profile or, if uncaptured, the
 * catalog/Google-Sheets data we have.
 *
 * Two states:
 *   - Captured: snapshot exists → <CapturedView> renders the rich
 *     post-audit findings (course shape, real outcomes, catalog deltas,
 *     incoming expectations, strongest evidence). Depth scores and
 *     citation chunk IDs are hidden — auditor calibration internals.
 *   - Uncaptured: no snapshot → <CatalogFallbackView> shows description,
 *     learning objectives, major projects, prereqs, syllabus link from
 *     the courses table, with a prominent "not yet audited" banner.
 *
 * Edit button (header) sends faculty to the HTTPS Tailscale Funnel where
 * Basic Auth gates the editor and mic works natively.
 */
export default async function ViewCoursePage({ params }: Props) {
  const { code: rawCode } = await params;
  const code = decodeURIComponent(rawCode);

  const [course] = await db
    .select()
    .from(courses)
    .where(eq(courses.code, code))
    .limit(1);

  if (!course) notFound();

  const [snapshot] = await db
    .select({
      id: courseCaptureSnapshots.id,
      profile: courseCaptureSnapshots.profile,
      createdAt: courseCaptureSnapshots.createdAt,
      instructorName: courseCaptureSnapshots.instructorName,
    })
    .from(courseCaptureSnapshots)
    .where(
      and(
        eq(courseCaptureSnapshots.courseCode, code),
        isNull(courseCaptureSnapshots.retiredAt),
      ),
    )
    .orderBy(desc(courseCaptureSnapshots.createdAt))
    .limit(1);

  // Other (older or same-course-different-instructor) captures that
  // exist but aren't the latest. Drives the "Other captures →" line in
  // the header when >0.
  const otherCaptures = snapshot
    ? await db
        .select({
          id: courseCaptureSnapshots.id,
          instructorName: courseCaptureSnapshots.instructorName,
          createdAt: courseCaptureSnapshots.createdAt,
        })
        .from(courseCaptureSnapshots)
        .where(
          and(
            eq(courseCaptureSnapshots.courseCode, code),
            isNull(courseCaptureSnapshots.retiredAt),
          ),
        )
        .orderBy(desc(courseCaptureSnapshots.createdAt))
    : [];
  const otherCount = Math.max(0, otherCaptures.length - 1);

  // For catalog-fallback courses, pull the live Sheet tab so faculty
  // edits in the Sheet appear without waiting for a re-seed. Falls back
  // to the DB row on any failure (sheet unavailable, tab missing,
  // timeout). Captured courses skip this — the snapshot is canonical.
  const liveSheet = !snapshot ? await fetchLiveCourseFromSheet(code) : null;
  const catalogSource: 'sheet-live' | 'db' = liveSheet ? 'sheet-live' : 'db';
  const fallbackCourse = liveSheet
    ? {
        code,
        title: liveSheet.title || course.title,
        description: liveSheet.description || course.description,
        prerequisites: liveSheet.prerequisites || course.prerequisites,
        syllabusUrl: liveSheet.syllabusUrl ?? course.syllabusUrl ?? null,
        learningObjectives: liveSheet.learningObjectives.length > 0
          ? liveSheet.learningObjectives
          : ((course.learningObjectives ?? []) as string[]),
        majorProjects: liveSheet.majorProjects.length > 0
          ? liveSheet.majorProjects
          : ((course.majorProjects ?? []) as string[]),
      }
    : {
        code,
        title: course.title,
        description: course.description,
        prerequisites: course.prerequisites,
        syllabusUrl: course.syllabusUrl ?? null,
        learningObjectives: (course.learningObjectives ?? []) as string[],
        majorProjects: (course.majorProjects ?? []) as string[],
      };

  // Bake the slug into the Edit link server-side so faculty don't need
  // to know or type it. The slug is a deeper-layer access gate alongside
  // Basic Auth; PROTOTYPE_SLUG is the canonical source.
  const slug = process.env.PROTOTYPE_SLUG ?? '';
  const funnelOrigin = process.env.TAILSCALE_FUNNEL_ORIGIN ?? '';
  const editHref = funnelOrigin && slug
    ? `${funnelOrigin}/capture/${encodeURIComponent(code)}?slug=${encodeURIComponent(slug)}`
    : null;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-4xl items-baseline justify-between gap-4 px-6 py-4">
          <div>
            <p className="font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {course.code}{snapshot ? ' · captured' : ' · catalog'}
            </p>
            <h1 className="mt-0.5 font-display text-2xl font-semibold tracking-tight">
              {course.title}
            </h1>
            {snapshot && (
              <p className="mt-1 text-xs text-muted-foreground">
                Captured by <span className="font-medium text-foreground">{snapshot.instructorName ?? 'Department canonical'}</span>
                {' · '}
                {snapshot.createdAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                {otherCount > 0 && (
                  <>
                    {' · '}
                    <span title="Other instructors have also captured this course">
                      {otherCount} other {otherCount === 1 ? 'capture' : 'captures'} on file
                    </span>
                  </>
                )}
              </p>
            )}
            {course.catalogUrl && (
              <p className="mt-1 text-xs">
                <a
                  href={course.catalogUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  Clemson catalog ↗
                </a>
              </p>
            )}
          </div>
          <div className="flex items-center gap-4">
            <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
              ← Courses
            </Link>
            {editHref && (
              <a
                href={editHref}
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
                title="Faculty edit (requires login)"
              >
                Edit →
              </a>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-8">
        {snapshot ? (
          // Defense-in-depth: scrub any PII the model may have echoed into the
          // generated profile before it reaches this anonymous public surface.
          // (Faculty/authenticated views render the un-redacted profile.)
          <CapturedView profile={redactPiiDeep(snapshot.profile)} capturedAt={snapshot.createdAt} />
        ) : (
          <CatalogFallbackView course={fallbackCourse} editHref={editHref} catalogSource={catalogSource} />
        )}
      </main>
    </div>
  );
}
