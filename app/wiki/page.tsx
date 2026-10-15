import Link from 'next/link';
import { isValidSlug } from '@/lib/slug';
import { loadWikiIndex, levelGroup, codeFromSlug, type WikiCourse } from '@/lib/wiki/index-data';
import { FeedbackLink } from '@/app/FeedbackLink';
import { AskTab } from '@/components/AskTab';
import { HowToRead, CAREER_TARGETS_BETA, TOOL_OVERVIEW_URL, TOOL_DOCS_URL } from './HowToRead';
import { loadTargetMap, loadRetiredCompetencyIds, withoutRetired, type TargetWithCompetencies } from '@/lib/wiki/course-views';

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

/** "ingest gc-3710 (uncaptioned): regenerated …" → "GC 3710 page updated". */
function describeLogEntry(text: string): string {
  const m = /^ingest\s+([a-z]+-[0-9]{4}[a-z]*)/i.exec(text);
  if (m?.[1]) return `${codeFromSlug(m[1])} page updated`;
  return text.replace(/: regenerated .*/, '');
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
  // Target → competency map from the DB (wiki competency pages don't record it).
  // Best-effort: the page still renders the flat list if the DB is unreachable.
  const targetMap: TargetWithCompetencies[] | null = await loadTargetMap().catch(() => null);
  // Retired competencies keep their wiki page as history; never list them as current.
  const retired = await loadRetiredCompetencyIds().catch(() => new Set<string>());
  const currentCompetencies = withoutRetired(data.competencies, retired);
  const compTitle = new Map(currentCompetencies.map(c => [c.slug, c.title]));
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
          What each Graphic Communications course actually has students{' '}
          <a href="#kud">know, understand and do</a>, written from captured course evidence rather
          than catalog copy, and how those courses build toward the{' '}
          <a href="#career-target">careers the program prepares for</a>.
        </p>
        <p className="wiki-index__about">
          New here? Read the <a href={TOOL_OVERVIEW_URL}>overview of the curriculum tool</a>, or browse <a href={TOOL_DOCS_URL}>all of its documents</a>.
          {data.research[0] && (
            <> For where the program could go next, read{' '}
              <Link href={`/wiki/research/${data.research[0].slug}${q}`}>{data.research[0].title}</Link>.</>
          )}
        </p>
        {!isEmpty && (
          <p className="wiki-index__status">
            {captured.length} of {data.courses.length} courses captured
            {latest ? `; most recent ${fmtDate(latest)}.` : '.'}
          </p>
        )}
      </header>

      {!isEmpty && <HowToRead q={q} />}

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
              <p className="wiki-col__intro">The five destinations the program prepares students for. Each is a family of the jobs graduates actually take, not a single job title.</p>
              <p className="wiki-col__intro">For now, each <a href="#competency">competency</a> is listed under the one target it serves most. That is a simplification: most competencies matter to several targets, at different depths. The catalog work described under Competencies will record, for each target, which competencies it needs, how much each one matters and the depth required. These will be drafted from O*NET and from where alumni actually work, then confirmed by faculty and employers.</p>
              <p className="wiki-beta"><strong>Beta.</strong> {CAREER_TARGETS_BETA}</p>
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
              <p className="wiki-col__intro">{currentCompetencies.length} competencies, grouped by the career target each belongs to. Each is scored on <a href="#kud">know, understand and do</a>.</p>
              <details className="wiki-col__more">
                <summary>Where these come from</summary>
                <p><strong>Where they came from.</strong> Starting from the five career targets, the program looked up our alumni&rsquo;s actual jobs in O*NET, the U.S. Department of Labor&rsquo;s occupation database, and drew an initial set of competencies for each target from what those jobs require. Target 5, Creative Technology &amp; Systems, was rewritten in October 2026 from research on AI and GC careers and from employer job descriptions.</p>
                <p><strong>What is changing.</strong> The list is becoming one shared catalog that any career target can draw on. Overlapping competencies have been merged: GC production literacy into domain knowledge, and timeline management into project management. Four business-acumen competencies have been proposed but not yet adopted. Each competency is now being matched to O*NET&rsquo;s descriptions of real work, so a target&rsquo;s needs can be compared with what graduates&rsquo; occupations actually ask for. No matches have been approved yet.</p>
                <p><strong>What comes next: real positions.</strong> The list will be refined as employer position capture gathers more detail: employers and alumni describing actual positions. That raises a chicken-and-egg problem: a position described in terms of competencies we have already named can only confirm the list, never reveal what it is missing. Three safeguards are planned:</p>
                <ul>
                  <li>The starting picture of demand comes from outside data (O*NET, and where alumni actually work), not from the program&rsquo;s own judgment.</li>
                  <li>Employers also say in their own words what matters, and skills that fit no listed competency are kept as gaps instead of being dropped.</li>
                  <li>Employer, O*NET and faculty views sit side by side, with disagreements shown rather than averaged.</li>
                </ul>
              </details>
              {targetMap ? (
                <div className="wiki-comp-groups">
                  {targetMap.map(t => (
                    <section key={t.id}>
                      <h3><Link href={`/wiki/targets/${t.id}${q}`}>{t.name}</Link></h3>
                      <ul className="wiki-col__list wiki-col__list--dense">
                        {t.competencies.filter(c => compTitle.has(c.id)).map(c => (
                          <li key={c.id}><Link href={`/wiki/competencies/${c.id}${q}`}>{compTitle.get(c.id)}</Link></li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              ) : (
                <ul className="wiki-col__list wiki-col__list--dense">
                  {currentCompetencies.map(c => (
                    <li key={c.slug}>
                      <Link href={`/wiki/competencies/${c.slug}${q}`}>{c.title}</Link>
                    </li>
                  ))}
                </ul>
              )}
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
                        <span>{describeLogEntry(r.text)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </section>
        </>
      )}

      {data.research.length > 0 && (
        <section className="wiki-cols" aria-labelledby="research-heading">
          <div className="wiki-col">
            <h2 id="research-heading" className="wiki-index__h2">AI and GC careers</h2>
            <p className="wiki-col__intro">What the program sees changing in graduates&rsquo; careers, which skills matter more, and what the curriculum could do. Start with the brief.</p>
            <ul className="wiki-col__list">
              {data.research.map(r => (
                <li key={r.slug}>
                  <Link href={`/wiki/research/${r.slug}${q}`}>{r.title}</Link>
                  {r.description && <p>{r.description}</p>}
                </li>
              ))}
            </ul>
          </div>
        </section>
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
