import Link from 'next/link';
import { isValidSlug } from '@/lib/slug';
import { loadWikiIndex, levelGroup, type WikiCourse } from '@/lib/wiki/index-data';
import { FeedbackLink } from '@/app/FeedbackLink';
import { AskTab } from '@/components/AskTab';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ slug?: string }>;
}

const GROUP_ORDER = ['foundations', 'integration', 'specialty', 'related'] as const;

function fmtDate(iso: string | null): string {
  if (!iso) return 'not yet captured';
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function fmtStamp(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export default async function WikiIndexPage({ searchParams }: Props) {
  const { slug = '' } = await searchParams;
  // Public read-only since 2026-09-25 (see PUBLIC_PREFIXES). A valid slug
  // unlocks the faculty nav + embedded Ask chat; without it the page is
  // read-only with public links only.
  const faculty = isValidSlug(slug);
  const q = faculty ? `?slug=${encodeURIComponent(slug)}` : '';

  const data = await loadWikiIndex();
  const captured = data.courses.filter(c => c.lastCaptured);
  const latest = captured.map(c => c.lastCaptured!).sort().at(-1) ?? null;
  const groups = GROUP_ORDER.map(key => ({
    ...levelGroup(key === 'foundations' ? 1 : key === 'integration' ? 3 : key === 'specialty' ? 4 : 0),
    courses: data.courses.filter(c => levelGroup(c.level).key === key),
  })).filter(g => g.courses.length > 0);
  const isEmpty = data.courses.length === 0;

  return (
    <div className="wiki-index">
      <header className="wiki-index__top">
        <div className="wiki-index__bar">
          <span className="wiki-index__brand">Graphic Communications, Clemson</span>
          <nav className="wiki-index__nav">
            {faculty && (
              <>
                <Link href={`/program${q}`}>Program</Link>
                <Link href={`/courses${q}`}>Courses</Link>
                <Link href={`/ask${q}`}>Ask</Link>
              </>
            )}
            <Link href={`/${q}`}>Hub</Link>
            {faculty && <FeedbackLink />}
          </nav>
        </div>
        <h1 className="wiki-index__title">Curriculum knowledge base</h1>
        <p className="wiki-index__lede">
          What each Graphic Communications course actually has students know, understand and do,
          written from captured course evidence rather than catalog copy, and how those courses
          build toward the careers the program prepares for.
        </p>
        {!isEmpty && (
          <p className="wiki-index__status">
            {captured.length} of {data.courses.length} courses captured
            {latest ? `; most recent ${fmtDate(latest)}.` : '.'}
          </p>
        )}
      </header>

      {isEmpty ? (
        <section className="wiki-index__empty">
          <p>No course pages yet. The first appears when a course profile is approved.</p>
          {faculty && <Link href={`/courses${q}`}>Go to Courses</Link>}
        </section>
      ) : (
        <>
          <section className="wiki-map" aria-labelledby="map-heading">
            <h2 id="map-heading" className="wiki-index__h2">The course sequence</h2>
            {groups.map(g => (
              <div key={g.key} className={`wiki-map__group wiki-map__group--${g.key}`}>
                <div className="wiki-map__level">
                  <span className="wiki-map__mark" aria-hidden="true" />
                  <h3>{g.title}</h3>
                  {g.range && <span className="wiki-map__range">{g.range}</span>}
                </div>
                <ol className="wiki-map__list">
                  {g.courses.map((c: WikiCourse) => (
                    <li key={c.slug} className="wiki-map__course">
                      <Link href={`/wiki/courses/${c.slug}${q}`} className="wiki-map__link">
                        <span className="wiki-map__code">{c.code}</span>
                        <span className="wiki-map__name">{c.title}</span>
                      </Link>
                      {c.description && <p className="wiki-map__desc">{c.description}</p>}
                      <p className="wiki-map__meta">
                        <span
                          className={`wiki-map__evidence ${c.materialsSupported ? 'is-supported' : ''}`}
                          title={c.materialsSupported ? 'Supported by course materials' : 'Claimed in interview only'}
                        />
                        {c.materialsSupported ? 'Materials-supported' : 'Claimed'}; captured {fmtDate(c.lastCaptured)}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
            <p className="wiki-map__key">
              <span className="wiki-map__evidence is-supported" /> materials-supported evidence
              <span className="wiki-map__evidence" /> interview claims only
            </p>
          </section>

          <section className="wiki-cols">
            <div className="wiki-col">
              <h2 className="wiki-index__h2">Career targets</h2>
              <p className="wiki-col__intro">The destinations the program says it prepares students for.</p>
              <ul className="wiki-col__list">
                {data.targets.map(t => (
                  <li key={t.slug}>
                    <Link href={`/wiki/targets/${t.slug}${q}`}>{t.title}</Link>
                    {t.description && <p>{t.description}</p>}
                  </li>
                ))}
              </ul>
            </div>
            <div className="wiki-col">
              <h2 className="wiki-index__h2">Competencies</h2>
              <p className="wiki-col__intro">{data.competencies.length} competencies the targets decompose into, each scored on know, understand and do.</p>
              <ul className="wiki-col__list wiki-col__list--dense">
                {data.competencies.map(c => (
                  <li key={c.slug}>
                    <Link href={`/wiki/competencies/${c.slug}${q}`}>{c.title}</Link>
                  </li>
                ))}
              </ul>
            </div>
            <div className="wiki-col">
              <h2 className="wiki-index__h2">Concepts</h2>
              <p className="wiki-col__intro">The ideas the analysis leans on.</p>
              <ul className="wiki-col__list">
                {data.concepts.map(c => (
                  <li key={c.slug}>
                    <Link href={`/wiki/concepts/${c.slug}${q}`}>{c.title}</Link>
                    {c.description && <p>{c.description}</p>}
                  </li>
                ))}
              </ul>
              {data.recent.length > 0 && (
                <>
                  <h2 className="wiki-index__h2 wiki-index__h2--later">Recently updated</h2>
                  <ul className="wiki-recent">
                    {data.recent.map(r => (
                      <li key={r.date + r.text}>
                        <time dateTime={r.date}>{fmtStamp(r.date)}</time>
                        <span>{r.text.replace(/: regenerated .*/, '')}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </section>
        </>
      )}

      {faculty && (
        <section className="wiki-index__ask">
          <p>Or just ask; the curriculum chat reads these pages and cites them back.</p>
          <AskTab slug={slug} />
        </section>
      )}
    </div>
  );
}
