import Link from 'next/link';
import { isValidSlug } from '@/lib/slug';
import { listCoursesWithStatus } from '@/lib/db/capture-status-queries';
import { getCourseDataStates } from '@/lib/db/courses-queries';
import { listPairedCodesForCourses } from '@/lib/db/course-codes-queries';
import { countSnapshotsByCourse } from '@/lib/db/capture-snapshots-queries';
import { countWhatIfsByCourse } from '@/lib/db/what-if-queries';
import { CoursesIndex } from './CoursesIndex';
import { FeedbackLink } from '@/app/FeedbackLink';

import './courses.css';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ slug?: string }>;
}

export default async function CoursesPage({ searchParams }: Props) {
  const { slug = '' } = await searchParams;

  if (!isValidSlug(slug)) {
    return (
      <div className="cs-main is-narrow cs-center">
        <h1 className="cs-title">Access link required</h1>
        <p className="cs-meta mt-3">
          Open this page through the access link your administrator shared.
        </p>
      </div>
    );
  }

  const [rows, rosterRows, snapshotCountByCode, whatIfCountByCode] = await Promise.all([
    listCoursesWithStatus(),
    getCourseDataStates(),
    countSnapshotsByCourse(),
    countWhatIfsByCourse(),
  ]);
  rows.sort((a, b) => (a.level ?? 9999) - (b.level ?? 9999) || a.code.localeCompare(b.code));

  const pairedCodeRows = await listPairedCodesForCourses([...new Set(rows.map(r => r.code))]);
  const pairedByCode: Record<string, Array<{ pairedCode: string }>> = {};
  for (const pc of pairedCodeRows) {
    const arr = pairedByCode[pc.courseCode] ?? [];
    arr.push({ pairedCode: pc.pairedCode });
    pairedByCode[pc.courseCode] = arr;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="cs-header">
        <div className="cs-header-inner">
          <div>
            <p className="cs-eyebrow">Catalog · GC</p>
            <h1 className="cs-title">Courses</h1>
          </div>
          <div className="cs-nav">
            <Link
              href={`/program?slug=${encodeURIComponent(slug)}`}
              className="cs-btn"
            >
              Coverage matrix →
            </Link>
            <Link
              href={`/wiki?slug=${encodeURIComponent(slug)}`}
              className="cs-btn"
            >
              Wiki →
            </Link>
            <Link
              href={`/ask?slug=${encodeURIComponent(slug)}`}
              className="cs-btn"
            >
              💬 Ask
            </Link>
            <Link
              href={`/?slug=${encodeURIComponent(slug)}`}
              className="cs-btn"
            >
              ← Hub
            </Link>
            <FeedbackLink />
          </div>
        </div>
      </header>
      <main className="cs-main">
        <CoursesIndex rows={rows} rosterRows={rosterRows} slug={slug} pairedByCode={pairedByCode} snapshotCountByCode={snapshotCountByCode} whatIfCountByCode={whatIfCountByCode} />
      </main>
    </div>
  );
}
