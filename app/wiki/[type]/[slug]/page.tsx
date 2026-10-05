import { notFound } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { isValidSlug } from '@/lib/slug';
import { readWikiPage } from '@/lib/wiki/git-ops';
import { parseFrontmatter, resolveWikilinks } from '@/lib/wiki/markdown-helpers';
import { loadWikiIndex, levelGroup, codeFromSlug, listFromFrontmatter } from '@/lib/wiki/index-data';
import { FeedbackLink } from '@/app/FeedbackLink';
import { CourseViewsPanel } from '../../CourseViewsPanel';
import { TermsHint, CAREER_TARGETS_BETA } from '../../HowToRead';
import { loadCourseViews, loadTargetMap, type CourseViews } from '@/lib/wiki/course-views';

export const dynamic = 'force-dynamic';

const ALLOWED_TYPES = ['courses', 'competencies', 'targets', 'concepts'] as const;
type WikiType = (typeof ALLOWED_TYPES)[number];
const TYPE_LABEL: Record<WikiType, string> = {
  courses: 'Course', competencies: 'Competency', targets: 'Career target', concepts: 'Concept',
};
const TYPE_PLURAL: Record<WikiType, string> = {
  courses: 'Courses', competencies: 'Competencies', targets: 'Career targets', concepts: 'Concepts',
};

function isAllowedType(t: string): t is WikiType {
  return (ALLOWED_TYPES as readonly string[]).includes(t);
}
/** Defensive slug check — alphanumeric + hyphen only, no slashes or dots. */
function isValidWikiSlug(s: string): boolean {
  return /^[a-z0-9-]+$/.test(s);
}
function fmtDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
/** The body repeats the title as its first H1; the page header owns that now. */
function stripLeadingH1(md: string): string {
  return md.replace(/^\s*#\s+[^\n]*\n+/, '');
}

interface Props {
  params: Promise<{ type: string; slug: string }>;
  searchParams: Promise<{ slug?: string }>;
}

interface RelatedGroup { heading: string; type: WikiType; slugs: string[] }

export default async function WikiPage({ params, searchParams }: Props) {
  const { type, slug: pageSlug } = await params;
  const { slug = '' } = await searchParams;
  // Public read-only since 2026-09-25 (see PUBLIC_PREFIXES). The slug is
  // optional: valid → faculty links (Ask) carry it; absent → public links only.
  const faculty = isValidSlug(slug);
  const q = faculty ? `?slug=${encodeURIComponent(slug)}` : '';

  if (!isAllowedType(type)) notFound();
  if (!isValidWikiSlug(pageSlug)) notFound();
  const raw = await readWikiPage(`${type}/${pageSlug}.md`);
  if (raw === null) notFound();

  const { frontmatter: fm, body } = parseFrontmatter(raw);
  const title = fm.title ?? pageSlug;
  const description = fm.description ?? '';

  // Titles for related links + reverse relations (targets/competencies name
  // their courses; courses mostly don't name them back).
  const index = await loadWikiIndex();
  const titleOf = new Map<string, string>();
  for (const c of index.courses) titleOf.set(c.slug, `${c.code} ${c.title}`);
  for (const t of index.targets) titleOf.set(t.slug, t.title);
  for (const c of index.competencies) titleOf.set(c.slug, c.title);
  for (const c of index.concepts) titleOf.set(c.slug, c.title);
  const processedBody = resolveWikilinks(stripLeadingH1(body), faculty ? slug : '', titleOf);
  const list = (k: string) => listFromFrontmatter(fm[k]).filter(s => titleOf.has(s));
  const fmOf = makeFmReader(); // per-request: the wiki regenerates, so never cache across requests

  const related: RelatedGroup[] = [];
  let facts: string[] = [];
  // DB-backed structure (best-effort; the page still renders from the wiki alone).
  let views: CourseViews | null = null;
  const targetMap = type === 'competencies' || type === 'targets' ? await loadTargetMap().catch(() => null) : null;
  if (type === 'courses') {
    const course = index.courses.find(c => c.slug === pageSlug);
    if (course) {
      const g = levelGroup(course.level);
      facts = [
        g.range ? `${g.range} course (${g.title.toLowerCase()})` : 'Course outside the GC sequence',
        course.lastCaptured ? `captured ${fmtDate(course.lastCaptured)}` : 'not yet captured',
        course.materialsSupported ? 'evidence supported by course materials' : 'evidence from the interview only',
      ];
    }
    related.push({ heading: 'Prerequisites', type: 'courses', slugs: list('prerequisites') });
    // Forward links from this page, plus reverse links from pages that cite it.
    const targets = new Set(list('contributes_to_targets'));
    const comps = new Set(list('develops_competencies'));
    for (const t of index.targets) if (listFromFrontmatter(await fmOf('targets', t.slug, 'contributing_courses')).includes(pageSlug)) targets.add(t.slug);
    for (const c of index.competencies) if (listFromFrontmatter(await fmOf('competencies', c.slug, 'contributing_courses')).includes(pageSlug)) comps.add(c.slug);
    related.push({ heading: 'Builds toward', type: 'targets', slugs: [...targets] });
    views = await loadCourseViews(codeFromSlug(pageSlug)).catch(() => null);
    related.push({ heading: 'Develops', type: 'competencies', slugs: [...comps] });
  } else if (type === 'targets') {
    const fromDb = targetMap?.find(t => t.id === pageSlug)?.competencies.map(c => c.id).filter(id => titleOf.has(id)) ?? [];
    related.push({ heading: 'Made of these competencies', type: 'competencies', slugs: fromDb.length ? fromDb : list('sub_competencies') });
    related.push({ heading: 'Contributing courses', type: 'courses', slugs: list('contributing_courses') });
  } else if (type === 'competencies') {
    const owner = targetMap?.find(t => t.competencies.some(c => c.id === pageSlug))?.id;
    related.push({ heading: 'Part of', type: 'targets', slugs: owner && titleOf.has(owner) ? [owner] : list('career_target') });
    related.push({ heading: 'Contributing courses', type: 'courses', slugs: list('contributing_courses') });
    if (fm.evidence_bands) facts = [listFromFrontmatter(fm.evidence_bands).includes('materials_supported') ? 'Evidence supported by course materials' : 'Evidence from interviews only'];
  } else {
    related.push({ heading: 'Courses where it shows up', type: 'courses', slugs: list('related_courses') });
    related.push({ heading: 'Related competencies', type: 'competencies', slugs: list('related_competencies') });
  }
  const relatedShown = related.filter(r => r.slugs.length > 0);

  return (
    <div className="wiki-index wiki-page">
      <header className="wiki-index__top">
        <div className="wiki-index__bar">
          <nav className="wiki-page__crumbs">
            <Link href={`/wiki${q}`}>Curriculum knowledge base</Link>
            <span aria-hidden="true">/</span>
            <span>{TYPE_PLURAL[type]}</span>
          </nav>
          <nav className="wiki-index__nav">
            {faculty && <Link href={`/ask${q}`} title="Ask the curriculum chat about this">Ask</Link>}
            <Link href={`/${q}`}>Hub</Link>
            {faculty && <FeedbackLink />}
          </nav>
        </div>
        <p className="wiki-page__kind">{type === 'courses' ? codeFromSlug(pageSlug) : TYPE_LABEL[type]}</p>
        <h1 className="wiki-index__title wiki-page__title">{title}</h1>
        {description && <p className="wiki-index__lede">{description}</p>}
        {facts.length > 0 && (
          <p className="wiki-index__status">{facts.map((f, i) => (i === 0 ? f.charAt(0).toUpperCase() + f.slice(1) : f)).join('; ')}.</p>
        )}
        {type === 'competencies' && (
          <TermsHint q={q}>A competency is one capability a graduate needs. It belongs to one career target and is scored on know, understand and do, each 0 to 5.</TermsHint>
        )}
        {type === 'targets' && (
          <>
            <TermsHint q={q}>A career target is one of the five destinations the program prepares students for, made of the competencies listed beside this text.</TermsHint>
            <p className="wiki-beta"><strong>Beta.</strong> {CAREER_TARGETS_BETA}</p>
          </>
        )}
      </header>

      {type === 'courses' && views && <CourseViewsPanel views={views} q={q} />}

      <div className="wiki-page__body">
        <article className="wiki-prose">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{processedBody}</ReactMarkdown>
        </article>
        {relatedShown.length > 0 && (
          <aside className="wiki-page__aside" aria-label="Related pages">
            {relatedShown.map(r => (
              <section key={r.heading}>
                <h2>{r.heading}</h2>
                <ul>
                  {r.slugs.map(s => (
                    <li key={s}><Link href={`/wiki/${r.type}/${s}${q}`}>{titleOf.get(s)}</Link></li>
                  ))}
                </ul>
              </section>
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}

// Small frontmatter reader for reverse relations, memoised for ONE request only.
// Pages are tiny; a few dozen reads per request is cheap and keeps the
// index-data loader single-purpose.
function makeFmReader() {
  const cache = new Map<string, Record<string, string | undefined>>();
  return async (type: WikiType, slug: string, key: string): Promise<string | undefined> => {
    const k = `${type}/${slug}`;
    let fm = cache.get(k);
    if (!fm) {
      const raw = await readWikiPage(`${k}.md`);
      fm = raw ? parseFrontmatter(raw).frontmatter : {};
      cache.set(k, fm);
    }
    return fm[key];
  };
}
