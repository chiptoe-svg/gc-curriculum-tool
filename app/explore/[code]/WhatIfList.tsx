import Link from 'next/link';
import { WHAT_IF_COPY } from '@/lib/what-if/copy';
import { formatDate } from '@/lib/what-if/format-rating';
import { StartWhatIf } from './StartWhatIf';

export interface WhatIfListItem {
  id: string;
  title: string | null;
  authorName: string;
  summary: string | null;
  pageCreatedAt: string | null;
  createdAt: string;
  /** The caller started it (so an unfinished one is theirs to continue). */
  mine: boolean;
  /** Saved from a cluster: skills and objectives only, no page. */
  skillsOnly?: boolean;
}

/** The course's what-ifs: every one with a page, plus the caller's own unfinished ones. */
export function WhatIfList({
  courseCode,
  slug,
  whatIfs,
  canStart,
  defaultName,
}: {
  courseCode: string;
  slug: string;
  whatIfs: WhatIfListItem[];
  /** The course has an approved version to start from. */
  canStart: boolean;
  defaultName: string | null;
}) {
  const base = `/explore/${encodeURIComponent(courseCode)}/what-ifs`;
  const q = `?slug=${encodeURIComponent(slug)}`;
  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{WHAT_IF_COPY.listHeading}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{WHAT_IF_COPY.listIntro}</p>
      </div>

      {canStart
        ? <StartWhatIf courseCode={courseCode} slug={slug} defaultName={defaultName} />
        : <p className="text-sm text-muted-foreground">{WHAT_IF_COPY.listNoApproved}</p>}

      {whatIfs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{WHAT_IF_COPY.listEmpty}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {whatIfs.map(w => (
            <li key={w.id} className="px-4 py-3">
              {w.pageCreatedAt || w.skillsOnly ? (
                <>
                  <Link href={`${base}/${w.id}${q}`} className="font-medium underline-offset-2 hover:underline">
                    {w.title ?? WHAT_IF_COPY.untitled}
                  </Link>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {WHAT_IF_COPY.listBy(w.authorName, formatDate(w.pageCreatedAt ?? w.createdAt))}
                  </p>
                  {w.skillsOnly && <p className="mt-0.5 text-xs font-medium">{WHAT_IF_COPY.listSkillsOnly}</p>}
                  {w.summary && <p className="mt-1 text-sm">{w.summary}</p>}
                </>
              ) : (
                <>
                  <p className="text-sm font-medium">{WHAT_IF_COPY.listUnfinished}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {WHAT_IF_COPY.listBy(w.authorName, formatDate(w.createdAt))}
                  </p>
                  <Link href={`${base}/${w.id}/talk${q}`} className="mt-1 inline-block text-sm underline-offset-2 hover:underline">
                    {WHAT_IF_COPY.listContinue}
                  </Link>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
