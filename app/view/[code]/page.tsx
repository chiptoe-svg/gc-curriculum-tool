import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db/client';
import { eq, desc, and, isNull } from 'drizzle-orm';
import { courses, courseCaptureSnapshots } from '@/lib/db/schema';
import { ReadOnlyProfile } from './ReadOnlyProfile';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ code: string }>;
}

/**
 * Public HTTP read-only profile view. No slug, no Basic Auth — anyone
 * on the LAN can read a captured course profile. Renders the latest
 * non-retired snapshot if one exists; falls back to a "no profile yet"
 * message otherwise.
 *
 * The Edit link sends faculty to the HTTPS Tailscale Funnel origin
 * where Basic Auth gates the editor and mic works natively.
 */
export default async function ViewCoursePage({ params }: Props) {
  const { code: rawCode } = await params;
  const code = decodeURIComponent(rawCode);

  const [course] = await db
    .select({ code: courses.code, title: courses.title })
    .from(courses)
    .where(eq(courses.code, code))
    .limit(1);

  if (!course) notFound();

  const [snapshot] = await db
    .select({
      id: courseCaptureSnapshots.id,
      profile: courseCaptureSnapshots.profile,
      capturedAt: courseCaptureSnapshots.createdAt,
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

  // Bake the slug into the Edit link server-side so faculty don't need
  // to know or type it. The slug is a deeper-layer gate (defense in
  // depth alongside Basic Auth); the env var is the canonical source.
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
              {course.code} · read-only
            </p>
            <h1 className="mt-0.5 font-display text-2xl font-semibold tracking-tight">
              {course.title ?? course.code}
            </h1>
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
          <ReadOnlyProfile profile={snapshot.profile} capturedAt={snapshot.capturedAt} />
        ) : (
          <div className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
            <p>No captured profile yet for {course.code}.</p>
            {editHref && (
              <p className="mt-2 text-sm">
                Faculty can start a capture via the Edit link above.
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
