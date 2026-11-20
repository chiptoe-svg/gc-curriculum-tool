import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import Link from 'next/link';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { getLatestSnapshotByCourse } from '@/lib/db/capture-snapshots-queries';
import { listWhatIfsForCourse } from '@/lib/db/what-if-queries';
import { getRequestGrant, personalName } from '@/lib/auth/viewer';
import { ownerOf } from '@/lib/what-if/ownership';
import { FeedbackLink } from '@/app/FeedbackLink';
import { WhatIfList } from './WhatIfList';

import '../explore.css';

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
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="ex-title">Access link required</h1>
        <p className="ex-meta mt-3">
          Open this page through the access link your administrator shared.
        </p>
      </div>
    );
  }

  const course = await getCourseByCode(code);
  if (!course) notFound();

  // The list shows every what-if with a page, plus the caller's own unfinished ones.
  const grant = await getRequestGrant(await headers());
  const me = grant ? ownerOf(grant) : null;
  const [latestSnapshot, rows] = await Promise.all([getLatestSnapshotByCourse(code), listWhatIfsForCourse(code)]);
  const whatIfs = rows
    .map(w => ({
      id: w.id,
      title: w.title,
      authorName: w.authorName,
      summary: w.summary,
      pageCreatedAt: w.pageCreatedAt ? w.pageCreatedAt.toISOString() : null,
      createdAt: w.createdAt.toISOString(),
      skillsOnly: !!w.skills && !w.profile,
      mine: me !== null && w.ownerKind === me.ownerKind && w.ownerGrantId === me.ownerGrantId,
    }))
    .filter(w => w.pageCreatedAt !== null || w.skillsOnly || w.mine);

  return (
    <div className="min-h-screen bg-background">
      <header className="ex-header">
        <div className="ex-header-inner">
          <div>
            <p className="ex-eyebrow">Explore · What-ifs</p>
            <h1 className="ex-title">
              {course.code} <span className="ex-title-sub">— {course.title}</span>
            </h1>
          </div>
          <div className="ex-nav">
            <a
              href="https://tonkin.people.clemson.edu/pages/gc-curriculum/using-coursecapture-and-explore.html#explore"
              target="_blank"
              rel="noopener noreferrer"
              className="ex-btn"
              title="How-to guide — jumps to the Explore section (opens in new tab)"
            >
              Guide ↗
            </a>
            <Link
              href={`/capture/${encodeURIComponent(code)}?slug=${encodeURIComponent(slug)}`}
              className="ex-btn"
            >
              ← CourseCapture
            </Link>
            <FeedbackLink />
          </div>
        </div>
      </header>

      <main className="ex-main">
        <WhatIfList
          courseCode={course.code}
          slug={slug}
          whatIfs={whatIfs}
          canStart={latestSnapshot !== null}
          defaultName={personalName(grant)}
        />
      </main>
    </div>
  );
}
