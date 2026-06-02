import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { listSnapshotsByCourse } from '@/lib/db/capture-snapshots-queries';
import { listTargetsByCourse, listAnalysesByCourse } from '@/lib/db/explore-queries';
import { ExploreClient } from './ExploreClient';
import { FeedbackLink } from '@/app/FeedbackLink';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ slug?: string; snapshot?: string }>;
}

export default async function ExplorePage({ params, searchParams }: Props) {
  const { code: rawCode } = await params;
  const { slug = '', snapshot: initialSnapshotId } = await searchParams;
  const code = decodeURIComponent(rawCode);

  if (!isValidSlug(slug)) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">Access link required</h1>
        <p className="mt-3 text-muted-foreground">
          Open this page through the access link your administrator shared.
        </p>
      </div>
    );
  }

  const course = await getCourseByCode(code);
  if (!course) notFound();

  const [snapshots, targets, analyses] = await Promise.all([
    listSnapshotsByCourse(code),
    listTargetsByCourse(code),
    listAnalysesByCourse(code),
  ]);

  if (snapshots.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold">No snapshot to explore yet</h1>
        <p className="mt-3 text-muted-foreground">
          Explore operates on a confirmed Course Outcome Profile snapshot. <Link
            href={`/capture/${encodeURIComponent(code)}?slug=${encodeURIComponent(slug)}`}
            className="underline hover:text-foreground"
          >Capture and snapshot this course first</Link>, then come back.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          New to the tool? Read the <a
            href="https://chiptoe-svg.github.io/gc-curriculum-tool/docs/using-coursecapture-and-explore.html"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >CourseCapture &amp; Explore guide</a> first.
        </p>
      </div>
    );
  }

  const initialSnapshot =
    (initialSnapshotId && snapshots.find(s => s.id === initialSnapshotId)) ||
    snapshots[0]!;  // guarded above: snapshots.length === 0 returns early

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-baseline justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Explore · v1</p>
            <h1 className="mt-0.5 text-xl font-semibold">
              {course.code} <span className="text-muted-foreground">— {course.title}</span>
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="https://chiptoe-svg.github.io/gc-curriculum-tool/docs/using-coursecapture-and-explore.html#ex-modes"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:text-foreground"
              title="How-to guide — jumps to the Explore section (opens in new tab)"
            >
              Guide ↗
            </a>
            <Link
              href={`/capture/${encodeURIComponent(code)}?slug=${encodeURIComponent(slug)}`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              ← CourseCapture
            </Link>
            <FeedbackLink />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-6">
        <ExploreClient
          courseCode={course.code}
          courseTitle={course.title}
          slug={slug}
          snapshots={snapshots.map(s => ({
            id: s.id,
            caption: s.caption,
            createdAt: s.createdAt.toISOString(),
            hasIncomingExpectations: Array.isArray(s.profile?.incoming_expectations),
          }))}
          initialSnapshotId={initialSnapshot.id}
          initialTargets={targets.map(t => ({
            id: t.id,
            kind: t.kind,
            caption: t.caption,
            createdAt: t.createdAt.toISOString(),
            authoredAgainstSnapshotId: t.authoredAgainstSnapshotId,
          }))}
          initialAnalyses={analyses.map(a => ({
            id: a.id,
            snapshotId: a.snapshotId,
            targetId: a.targetId,
            createdAt: a.createdAt.toISOString(),
            recommendationCount: a.analysis.recommendations.length,
          }))}
        />
      </main>
    </div>
  );
}
