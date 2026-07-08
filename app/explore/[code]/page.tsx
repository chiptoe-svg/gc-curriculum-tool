import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { AskTab } from '@/components/AskTab';
import { FeedbackLink } from '@/app/FeedbackLink';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ slug?: string }>;
}

export default async function ExplorePage({ params, searchParams }: Props) {
  const { code: rawCode } = await params;
  const { slug = '' } = await searchParams;
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

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-baseline justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Explore · Curriculum chat</p>
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
        <AskTab courseCode={course.code} courseTitle={course.title} slug={slug} />
      </main>
    </div>
  );
}
