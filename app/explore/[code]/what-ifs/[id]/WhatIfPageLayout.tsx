import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { WHAT_IF_COPY } from '@/lib/what-if/copy';
import { changeText, formatDate, kudText } from '@/lib/what-if/format-rating';
import type { Kud, KnockOn, WhatIfEstimate, WhatIfProfile, WhatIfProse, WhatIfRating } from '@/lib/what-if/types';
import { WhatIfActions } from './WhatIfActions';

/** Everything the page shows, read from the stored record (dates as ISO strings). */
export interface WhatIfPageView {
  id: string;
  courseCode: string;
  title: string | null;
  authorName: string;
  pageCreatedAt: string;
  estimate: WhatIfEstimate;
  profile: WhatIfProfile;
  knockOn: KnockOn;
  prose: WhatIfProse;
  attachments: Array<{ fileName: string; status: 'ok' | 'failed' | 'held_back' }>;
}

/** The approved version the what-if started from. */
export interface WhatIfBase {
  /** 'newer': a newer version has been approved since; still updatable against the original. */
  state: 'ok' | 'newer' | 'withdrawn' | 'gone';
  approvedBy: string | null;
  approvedAt: string | null;
}

const wikiCourseHref = (code: string, q: string) => `/wiki/courses/${code.toLowerCase().replace(/\s+/g, '-')}${q}`;
const level = (v: number | null) => (v === null ? '–' : String(v));

function Md({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>;
}

function Predicted({ rating }: { rating: WhatIfRating }) {
  const change = changeText(rating.before, rating.kud);
  return (
    <>
      <span className="font-semibold">{WHAT_IF_COPY.predictedLabel}</span>
      {rating.status === 'new' && <span> · {WHAT_IF_COPY.newRating} ({kudText(rating.kud)})</span>}
      {change && <> · <span>{change}</span></>}
      {rating.confidence && <> · <span>{WHAT_IF_COPY.confidence(rating.confidence)}</span></>}
      {rating.reason && <> — <span>{rating.reason}</span></>}
      {!rating.linked && <> · <span>{WHAT_IF_COPY.notLinked}</span></>}
    </>
  );
}

function CourseLink({ code, q }: { code: string; q: string }) {
  return <Link href={wikiCourseHref(code, q)}>{code}</Link>;
}

export function WhatIfPageLayout({ view, base, canManage, slug }: {
  view: WhatIfPageView;
  base: WhatIfBase;
  canManage: boolean;
  slug: string;
}) {
  const q = `?slug=${encodeURIComponent(slug)}`;
  const { estimate, profile, knockOn, prose } = view;
  const added = estimate.changeItems.filter(i => i.kind === 'added');
  const changed = estimate.changeItems.filter(i => i.kind === 'changed');
  const removed = estimate.changeItems.filter(i => i.kind === 'removed');
  const moved = profile.ratings.filter(r => r.status !== 'approved');
  const hasFoundational = profile.ratings.some(r => r.type === 'foundational');
  const neighborsEmpty = knockOn.laterCourses.length === 0 && knockOn.earlierCourses.length === 0
    && knockOn.careerTargets.length === 0 && knockOn.notComputed.length === 0;
  const canUpdate = base.state === 'ok' || base.state === 'newer';
  const title = view.title ?? WHAT_IF_COPY.untitled;

  return (
    <div className="wiki-index wiki-page">
      <header className="wiki-index__top">
        <p className="wiki-page__kind">{view.courseCode}</p>
        <h1 className="wiki-index__title wiki-page__title">{title}</h1>
        <div className="mt-3 max-w-2xl rounded border-2 border-foreground px-4 py-3">
          <p className="text-base"><strong>{WHAT_IF_COPY.banner}</strong></p>
          <p className="mt-1 text-sm">{WHAT_IF_COPY.predictedExplain}</p>
        </div>
        <p className="wiki-index__status">
          {WHAT_IF_COPY.writtenBy(view.authorName, formatDate(view.pageCreatedAt))}{' '}
          {base.approvedAt && (base.approvedBy
            ? WHAT_IF_COPY.basedOn(base.approvedBy, formatDate(base.approvedAt))
            : WHAT_IF_COPY.basedOnUnknown(formatDate(base.approvedAt)))}
        </p>
        {base.state === 'newer' && <p className="wiki-beta">{WHAT_IF_COPY.newerVersion}</p>}
        {base.state === 'withdrawn' && <p className="wiki-beta">{WHAT_IF_COPY.withdrawnVersion}</p>}
        {base.state === 'gone' && <p className="wiki-beta">{WHAT_IF_COPY.goneVersion}</p>}
      </header>

      <div className="wiki-page__body">
        <article className="wiki-prose">
          <h2>{WHAT_IF_COPY.sectionChanges}</h2>
          {prose.whatChanges && <Md>{prose.whatChanges}</Md>}
          <h3>{WHAT_IF_COPY.added}</h3>
          {added.length > 0
            ? <ul>{added.map((i, n) => <li key={n}>{i.description}</li>)}</ul>
            : <p>{WHAT_IF_COPY.nothingAdded}</p>}
          {changed.length > 0 && (
            <>
              <h3>{WHAT_IF_COPY.changed}</h3>
              <ul>{changed.map((i, n) => <li key={n}>{i.description}</li>)}</ul>
            </>
          )}
          <h3>{WHAT_IF_COPY.removed}</h3>
          {removed.length > 0
            ? <ul>{removed.map((i, n) => <li key={n}>{i.description}</li>)}</ul>
            : <p>{WHAT_IF_COPY.removedFallback}</p>}
          <h3>{WHAT_IF_COPY.newlyNeeded}</h3>
          {profile.incomingChanges.length > 0 ? (
            <ul>
              {profile.incomingChanges.map((c, n) => (
                <li key={n}>
                  {c.statement} — {c.kind === 'new' ? WHAT_IF_COPY.incomingNew : c.kind === 'raised' ? WHAT_IF_COPY.incomingRaised : WHAT_IF_COPY.incomingDropped}
                  {c.expected && <> ({kudText(c.expected)})</>}
                </li>
              ))}
            </ul>
          ) : <p>{WHAT_IF_COPY.incomingNone}</p>}
          <h3>{WHAT_IF_COPY.movedHeading}</h3>
          {moved.length > 0 ? (
            <ul>
              {moved.map((r, n) => (
                <li key={n}>
                  <strong>{r.statement}</strong>: <Predicted rating={r} />
                </li>
              ))}
            </ul>
          ) : <p>{WHAT_IF_COPY.nothingMoved}</p>}

          <h2>{WHAT_IF_COPY.sectionCourse}</h2>
          {prose.description && <Md>{prose.description}</Md>}
          <h3>{WHAT_IF_COPY.ratingsHeading}</h3>
          <table>
            <thead>
              <tr>
                <th>{WHAT_IF_COPY.colRating}</th>
                <th>{WHAT_IF_COPY.colK}</th>
                <th>{WHAT_IF_COPY.colU}</th>
                <th>{WHAT_IF_COPY.colD}</th>
              </tr>
            </thead>
            <tbody>
              {profile.ratings.map((r, n) => (
                <tr key={n}>
                  <td>
                    <span>{r.statement}</span>
                    {r.status !== 'approved' && <div className="text-sm"><Predicted rating={r} /></div>}
                  </td>
                  {(['k', 'u', 'd'] as Array<keyof Kud>).map(d => <td key={d}>{level(r.kud[d])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {hasFoundational && <p className="text-sm">{WHAT_IF_COPY.foundationalNote}</p>}

          <h2>{WHAT_IF_COPY.sectionNeighbors}</h2>
          {prose.neighbors && <Md>{prose.neighbors}</Md>}
          {knockOn.earlierCourses.length > 0 && (
            <>
              <h3>{WHAT_IF_COPY.earlierHeading}</h3>
              <ul>
                {knockOn.earlierCourses.map((e, n) => (
                  <li key={n}>
                    {e.statement}{e.label ? ` (${e.label})` : ''}:{' '}
                    {e.status === 'met' ? WHAT_IF_COPY.earlierMet : e.status === 'not_met' ? WHAT_IF_COPY.earlierNotMet : WHAT_IF_COPY.earlierNotKnown}
                    {e.deliveredBy.length > 0 && (
                      <> ({WHAT_IF_COPY.deliveredBy}{' '}
                        {e.deliveredBy.map((c, i) => <span key={c}>{i > 0 && ', '}<CourseLink code={c} q={q} /></span>)})
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {knockOn.laterCourses.length > 0 && (
            <>
              <h3>{WHAT_IF_COPY.laterHeading}</h3>
              <ul>
                {knockOn.laterCourses.map((l, n) => (
                  <li key={n}>
                    <CourseLink code={l.courseCode} q={q} />: {l.label} {l.effect === 'closed' ? WHAT_IF_COPY.laterClosed : WHAT_IF_COPY.laterOpened}
                  </li>
                ))}
              </ul>
            </>
          )}
          {knockOn.careerTargets.length > 0 && (
            <>
              <h3>{WHAT_IF_COPY.careerHeading}</h3>
              <ul>
                {knockOn.careerTargets.map((c, n) => (
                  <li key={n}>
                    {c.targetName}: {c.label} {c.before} → {c.after} ({c.direction === 'up' ? WHAT_IF_COPY.careerUp : WHAT_IF_COPY.careerDown})
                  </li>
                ))}
              </ul>
            </>
          )}
          {knockOn.notComputed.length > 0 && (
            <p>{WHAT_IF_COPY.notComputed} {knockOn.notComputed.join('; ')}.</p>
          )}
          {neighborsEmpty && <p>{WHAT_IF_COPY.neighborsNone}</p>}
          <p className="text-sm">{WHAT_IF_COPY.effectsNote}</p>

          <h2>{WHAT_IF_COPY.sectionQuestions}</h2>
          {prose.questions.length > 0
            ? <ul>{prose.questions.map((t, n) => <li key={n}>{t}</li>)}</ul>
            : <p>{WHAT_IF_COPY.questionsNone}</p>}

          <h2>{WHAT_IF_COPY.sectionBasis}</h2>
          {view.attachments.length > 0 ? (
            <ul>
              {view.attachments.map((a, n) => (
                <li key={n}>
                  <span>{a.fileName}</span>
                  {a.status === 'held_back' && <> ({WHAT_IF_COPY.basisHeldBack})</>}
                  {a.status === 'failed' && <> ({WHAT_IF_COPY.basisFailed})</>}
                </li>
              ))}
            </ul>
          ) : <p>{WHAT_IF_COPY.basisNone}</p>}
        </article>

        <aside className="wiki-page__aside" aria-label="Actions">
          <section>
            <p><Link href={`/explore/${encodeURIComponent(view.courseCode)}${q}`}>{WHAT_IF_COPY.listLink}</Link></p>
            <p><Link href={wikiCourseHref(view.courseCode, q)}>{WHAT_IF_COPY.courseLink} {view.courseCode}</Link></p>
          </section>
          {canManage && (
            <section>
              <WhatIfActions
                courseCode={view.courseCode}
                whatIfId={view.id}
                slug={slug}
                title={title}
                canUpdate={canUpdate}
              />
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
