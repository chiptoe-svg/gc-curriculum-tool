import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { CourseViews } from '@/lib/wiki/course-views';
import type { ObjectiveGuideSection } from '@/lib/wiki/objective-guide-section';
import { cleanProjectLinks, cleanProjects, cleanSyllabus, guideSummary, splitCourseBody } from '@/lib/wiki/course-page';
import { ObjectiveGuidePanel } from './ObjectiveGuidePanel';

/**
 * Course page body, in the order a reader asks (owner 2026-11-08, after a
 * layout review found the pages upside down and repetitive): what the course
 * is → what it says it does vs. what we found → what students learn → the
 * projects → where it fits → the instructor's assessment guide (collapsed) →
 * sources and limits. Each fact appears once. The generated markdown is split
 * by its `## ` headings (old and new generator headings both map); live data
 * (objectives, scores, predictions, guide) comes from the database.
 */

export interface PageLink { href: string; label: string }

const depth = (v: number | null) => (v === null ? '–' : String(v));
function Md({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>;
}
function SubSection({ title, md }: { title: string; md: string | undefined }) {
  if (!md) return null;
  return (
    <>
      <h3>{title}</h3>
      <Md>{md}</Md>
    </>
  );
}

/** Headings the layout places explicitly; anything else is kept, at the end. */
const PLACED = new Set([
  'At a glance', "Who it's for", 'The arc', 'Class structure', 'Competencies developed',
  'Audit notes', 'Limits of this capture', 'Where the syllabus and evidence differ',
  'Signature projects', 'How the projects connect', 'Syllabus', 'Source snapshots', 'Cross-references',
]);

export function CoursePageLayout({ body, views, guide, buildsToward, develops, q }: {
  body: string;
  views: CourseViews | null;
  guide: ObjectiveGuideSection | null;
  buildsToward: PageLink[];
  develops: PageLink[];
  q: string;
}) {
  const { intro, sections: s } = splitCourseBody(body);
  const objectives = views?.objectives ?? [];
  const evidence = views?.evidence ?? null;
  const predicted = views?.predicted ?? [];
  const arrival = views?.arrivalSkills ?? [];
  const differences = evidence?.disagreements ?? [];
  const differMd = s['Where the syllabus and evidence differ'];
  const projectLinks = s['How the projects connect'] ? cleanProjectLinks(s['How the projects connect']) : '';
  const syllabus = s['Syllabus'] ? cleanSyllabus(s['Syllabus'], { dropArrivalSkills: arrival.length > 0 }) : '';
  const limits = s['Limits of this capture'] ?? s['Audit notes'];
  const extra = Object.entries(s).filter(([h]) => !PLACED.has(h));

  const has = {
    objectives: objectives.length > 0 || differences.length > 0 || !!differMd,
    learn: !!evidence || !!s['Competencies developed'],
    projects: !!s['Signature projects'] || !!projectLinks,
    program: buildsToward.length > 0 || develops.length > 0 || predicted.length > 0,
    instructor: !!guide,
    sources: !!syllabus || !!limits || !!s['Cross-references'] || extra.length > 0,
  };
  const toc: Array<[string, string, boolean]> = [
    ['about', 'About this course', true],
    ['objectives', 'Stated objectives vs. what we found', has.objectives],
    ['learn', 'What students learn', has.learn],
    ['projects', 'Projects', has.projects],
    ['program', 'Where it fits in the program', has.program],
    ['instructor', 'For the instructor', has.instructor],
    ['sources', 'Sources and limits', has.sources],
  ];

  return (
    <div className="wiki-course">
      <nav className="wiki-course__toc" aria-label="On this page">
        <p>On this page</p>
        <ul>
          {toc.filter(([, , shown]) => shown).map(([id, label]) => (
            <li key={id}><a href={`#${id}`}>{label}</a></li>
          ))}
        </ul>
      </nav>

      <section id="about" className="wiki-course__section wiki-prose">
        <h2>About this course</h2>
        {intro && <Md>{intro}</Md>}
        <SubSection title="At a glance" md={s['At a glance']} />
        <SubSection title="Who it's for" md={s["Who it's for"]} />
        <SubSection title="How the course unfolds" md={s['The arc']} />
        <SubSection title="Class structure" md={s['Class structure']} />
        {arrival.length > 0 && (
          <>
            <h3>What students should arrive with</h3>
            <ul>{arrival.map((a, i) => <li key={i}>{a}</li>)}</ul>
          </>
        )}
      </section>

      {has.objectives && (
        <section id="objectives" className="wiki-course__section wiki-prose">
          <h2>Stated objectives vs. what we found</h2>
          {objectives.length > 0 && (
            <>
              <h3>What the syllabus says the course does</h3>
              <ol>{objectives.map((o, i) => <li key={i}>{o}</li>)}</ol>
            </>
          )}
          {(differences.length > 0 || differMd) && (
            <>
              <h3>Where the evidence differs</h3>
              {differences.length > 0 && <ul>{differences.map((d, i) => <li key={i}>{d}</li>)}</ul>}
              {differMd && <Md>{differMd}</Md>}
            </>
          )}
        </section>
      )}

      {has.learn && (
        <section id="learn" className="wiki-course__section">
          <h2>What students learn</h2>
          {evidence ? (
            <>
              <p className="wiki-course__legend">
                Each competency is scored for <Link href={`/wiki${q}#kud`}>know, understand and do</Link>, from 0 to 5.
                Evidence: <em>claimed</em> = said in the interview, <em>materials</em> = backed by course materials,{' '}
                <em>artifact</em> = seen in student work. Scores from the capture of{' '}
                {new Date(evidence.capturedOn + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}.
              </p>
              <div className="wiki-course__scroll">
                <table className="wiki-views__table wiki-course__table">
                  <thead><tr><th scope="col">Competency</th><th scope="col" title="Know">K</th><th scope="col" title="Understand">U</th><th scope="col" title="Do">D</th><th scope="col">Evidence</th></tr></thead>
                  <tbody>
                    {evidence.rows.filter(r => !r.foundational).map((r, i) => (
                      <tr key={i}>
                        <td>{r.statement}</td><td>{depth(r.k)}</td><td>{depth(r.u)}</td><td>{depth(r.d)}</td>
                        <td className={`wiki-views__src is-${r.evidence}`}>{r.evidence}</td>
                      </tr>
                    ))}
                    {evidence.rows.some(r => r.foundational) && (
                      <tr className="wiki-views__divider"><th scope="rowgroup" colSpan={5}>Foundational, scored on do only</th></tr>
                    )}
                    {evidence.rows.filter(r => r.foundational).map((r, i) => (
                      <tr key={`f${i}`}>
                        <td>{r.statement}</td><td>–</td><td>–</td><td>{depth(r.d)}</td>
                        <td className={`wiki-views__src is-${r.evidence}`}>{r.evidence}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="wiki-prose"><Md>{s['Competencies developed']!}</Md></div>
          )}
        </section>
      )}

      {has.projects && (
        <section id="projects" className="wiki-course__section wiki-prose">
          <h2>Projects</h2>
          {s['Signature projects'] && <Md>{cleanProjects(s['Signature projects'])}</Md>}
          {projectLinks && (
            <>
              <h3>What each project builds</h3>
              <Md>{projectLinks}</Md>
            </>
          )}
        </section>
      )}

      {has.program && (
        <section id="program" className="wiki-course__section">
          <h2>Where it fits in the program</h2>
          <div className="wiki-course__fit">
            {buildsToward.length > 0 && (
              <div>
                <h3>Builds toward these career targets</h3>
                <ul>{buildsToward.map(l => <li key={l.href}><Link href={l.href}>{l.label}</Link></li>)}</ul>
              </div>
            )}
            {develops.length > 0 && (
              <div>
                <h3>Develops these competencies</h3>
                <ul>{develops.map(l => <li key={l.href}><Link href={l.href}>{l.label}</Link></li>)}</ul>
              </div>
            )}
          </div>
          {predicted.length > 0 && (
            <>
              <h3>What the syllabus predicts</h3>
              <p className="wiki-course__legend">The depth the written course description implies for each career target. A prediction, not evidence.</p>
              <div className="wiki-course__scroll">
                <table className="wiki-views__table">
                  <thead><tr><th scope="col">Career target</th><th scope="col" title="Know">K</th><th scope="col" title="Understand">U</th><th scope="col" title="Do">D</th><th scope="col" title="Competencies the syllabus touches">Comp.</th></tr></thead>
                  <tbody>
                    {predicted.map(t => (
                      <tr key={t.targetId}>
                        <td><Link href={`/wiki/targets/${t.targetId}${q}`}>{t.name}</Link></td>
                        <td>{depth(t.k)}</td><td>{depth(t.u)}</td><td>{depth(t.d)}</td><td>{t.competencies}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {guide && (
        <section id="instructor" className="wiki-course__section">
          <h2>For the instructor</h2>
          <details className="wiki-course__guide">
            <summary>
              <strong>Assessing the course objectives</strong>
              {guide.kind === 'guide'
                ? <> — {guideSummary(guide.guide.objectives.map(o => o.measure))}</>
                : <> — no guide yet</>}
            </summary>
            <ObjectiveGuidePanel section={guide} embedded />
          </details>
        </section>
      )}

      {has.sources && (
        <section id="sources" className="wiki-course__section wiki-prose">
          <h2>Sources and limits</h2>
          <SubSection title="Syllabus and course sheet" md={syllabus || undefined} />
          <SubSection title="Limits of this capture" md={limits} />
          {extra.map(([h, md]) => <SubSection key={h} title={h} md={md} />)}
          <SubSection title="Read more" md={s['Cross-references']} />
        </section>
      )}
    </div>
  );
}
