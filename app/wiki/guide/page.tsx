import Link from 'next/link';
import { isValidSlug } from '@/lib/slug';
import { loadTargetMap, type TargetWithCompetencies } from '@/lib/wiki/course-views';
import { DEPTH_SCALE, EVIDENCE_LABELS, CAREER_TARGETS_BETA, TOOL_OVERVIEW_URL } from '../HowToRead';

export const dynamic = 'force-dynamic';

const BACKGROUND = 'https://chiptoe-svg.github.io/gc-curriculum-tool/docs/background.html';

interface Props { searchParams: Promise<{ slug?: string }> }

/**
 * /wiki/guide — the full explanation of how the knowledge base fits together:
 * courses → competencies (scored know / understand / do) → career targets.
 * Public like the rest of /wiki. Owner request 2026-10-05.
 */
export default async function WikiGuidePage({ searchParams }: Props) {
  const { slug = '' } = await searchParams;
  const q = isValidSlug(slug) ? `?slug=${encodeURIComponent(slug)}` : '';
  const targets: TargetWithCompetencies[] | null = await loadTargetMap().catch(() => null);

  return (
    <div className="wiki-index wiki-page wiki-guide">
      <header className="wiki-index__top">
        <div className="wiki-index__bar">
          <nav className="wiki-page__crumbs">
            <Link href={`/wiki${q}`}>Curriculum knowledge base</Link>
            <span aria-hidden="true">/</span>
            <span>Guide</span>
          </nav>
        </div>
        <p className="wiki-page__kind">Guide</p>
        <h1 className="wiki-index__title wiki-page__title">How the knowledge base fits together</h1>
        <p className="wiki-index__lede">
          Courses develop competencies. Each competency is scored on what students know, understand and can do.
          Competencies make up the career targets the program prepares students for. This page explains each step.
        </p>
      </header>

      <article className="wiki-prose wiki-guide__body">
        <h2>The chain, from a course to a career</h2>
        <ol>
          <li><strong>A course is captured.</strong> An instructor walks through the course in a structured interview, and the answers are checked against the course’s own materials: syllabus, assignments, rubrics.</li>
          <li><strong>The capture names the competencies the course develops.</strong> A competency is one specific capability a graduate needs, such as Quality Control or Brand Positioning.</li>
          <li><strong>Each competency is scored three ways.</strong> Know, understand and do, each from 0 to 5, with a label saying what the score rests on.</li>
          <li><strong>Competencies roll up into career targets.</strong> Each of the five targets is made of five to seven competencies. A target is well served when courses across the sequence, taken together, build its competencies to depth.</li>
        </ol>

        <h2>Why three scores instead of one</h2>
        <p>
          A course can teach the vocabulary of a subject without the reasoning behind it, or build skill without the ability to explain it.
          A single &ldquo;covered&rdquo; checkmark hides both. Scoring separately makes the gaps visible:
        </p>
        <ul>
          <li><strong>High know, low understand:</strong> jargon without rationale.</li>
          <li><strong>High understand, low do:</strong> theory without craft.</li>
          <li><strong>High do, low understand:</strong> craft the student cannot yet explain or adapt.</li>
          <li><strong>Know 1 only:</strong> mentioned in passing, never practised.</li>
        </ul>
        <p>
          <em>Know</em> is recall: can the student name it or pick it out? <em>Understand</em> is reasoning: can they say why it works and when to use it?
          <em> Do</em> is output: can they make it, produce it, demonstrate it?
        </p>

        <h2 id="depth">The depth scale</h2>
        <table>
          <thead><tr><th scope="col">Depth</th><th scope="col">What it looks like</th></tr></thead>
          <tbody>{DEPTH_SCALE.map(([n, t]) => <tr key={n}><td>{n}</td><td>{t}</td></tr>)}</tbody>
        </table>

        <h2 id="evidence">What a score rests on</h2>
        <p>
          A score above the lowest levels needs evidence that students reached it, not just a syllabus saying they will.
          Assessment items count for know, student reasoning for understand, graded work for do. Every score carries one of these labels:
        </p>
        <dl className="wiki-howto__labels">
          {EVIDENCE_LABELS.map(([label, text]) => <div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}
        </dl>
        <p>
          Five foundational competencies, Agency, Attention to Detail, Resilience, Curiosity and Communication, are scored on do only.
          A zero for know or understand would wrongly suggest the course tried to teach them as content and failed.
        </p>

        <h2>The five career targets and their competencies</h2>
        <p className="wiki-beta"><strong>Beta.</strong> {CAREER_TARGETS_BETA}</p>
        {targets ? (
          <div className="wiki-guide__targets">
            {targets.map(t => (
              <section key={t.id}>
                <h3><Link href={`/wiki/targets/${t.id}${q}`}>{t.name}</Link></h3>
                <ul>{t.competencies.map(c => <li key={c.id}><Link href={`/wiki/competencies/${c.id}${q}`}>{c.name}</Link></li>)}</ul>
              </section>
            ))}
          </div>
        ) : (
          <p>The target list is unavailable right now. See the <Link href={`/wiki${q}`}>knowledge base home</Link>.</p>
        )}

        <h2>On each course page</h2>
        <p>Course pages show three views side by side, so the stated course and the measured course can be compared directly:</p>
        <ol>
          <li><strong>What the syllabus says:</strong> the stated learning objectives.</li>
          <li><strong>What the evidence shows:</strong> the measured scores from the latest capture, with what each rests on, and the capture’s findings where the stated course and the evidence disagree.</li>
          <li><strong>What the syllabus predicts:</strong> the depth the written course description implies for each career target. A prediction only.</li>
        </ol>

        <h2>Further reading</h2>
        <p>For what the curriculum tool is and where it stands, see the <a href={TOOL_OVERVIEW_URL}>overview</a>.</p>
        <p>
          The academic background is in the program’s framework document: <a href={`${BACKGROUND}#kud`}>the know, understand, do model</a>,{' '}
          <a href={`${BACKGROUND}#depth`}>the depth scale</a>, and <a href={`${BACKGROUND}#anchors`}>the evidence rule</a>.
        </p>
      </article>
    </div>
  );
}
