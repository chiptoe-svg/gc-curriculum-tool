import Link from 'next/link';
import { isValidSlug } from '@/lib/slug';
import { listCoursesWithStatus } from '@/lib/db/capture-status-queries';
import { getCourseDataStates } from '@/lib/db/courses-queries';
import { listPairedCodesForCourses } from '@/lib/db/course-codes-queries';
import { CoursesIndex } from './CoursesIndex';
import { FeedbackLink } from '@/app/FeedbackLink';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ slug?: string }>;
}

export default async function CoursesPage({ searchParams }: Props) {
  const { slug = '' } = await searchParams;

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

  const [rows, rosterRows] = await Promise.all([
    listCoursesWithStatus(),
    getCourseDataStates(),
  ]);
  rows.sort((a, b) => (a.level ?? 9999) - (b.level ?? 9999) || a.code.localeCompare(b.code));

  const pairedCodeRows = await listPairedCodesForCourses(rows.map(r => r.code));
  const pairedByCode: Record<string, Array<{ pairedCode: string }>> = {};
  for (const pc of pairedCodeRows) {
    const arr = pairedByCode[pc.courseCode] ?? [];
    arr.push({ pairedCode: pc.pairedCode });
    pairedByCode[pc.courseCode] = arr;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-baseline justify-between gap-4 px-6 py-4">
          <div>
            <p className="font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Catalog · GC
            </p>
            <h1 className="mt-0.5 font-display text-2xl font-semibold tracking-tight">Courses</h1>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href={`/program?slug=${encodeURIComponent(slug)}`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Coverage matrix →
            </Link>
            <Link
              href={`/wiki?slug=${encodeURIComponent(slug)}`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Wiki →
            </Link>
            <Link
              href={`/ask?slug=${encodeURIComponent(slug)}`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              💬 Ask
            </Link>
            <Link
              href={`/?slug=${encodeURIComponent(slug)}`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              ← Hub
            </Link>
            <FeedbackLink />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <CoursesIndex rows={rows} rosterRows={rosterRows} slug={slug} pairedByCode={pairedByCode} />
      </main>
    </div>
  );
}
