import Link from 'next/link';

/**
 * Plain-language definitions for the terms the wiki uses (owner request
 * 2026-10-05: "competencies, career targets, KUD+ assume understanding").
 * Rendered in full on the index (id="how-to-read"); every other page links to
 * its anchors. The full explanation lives at /wiki/guide.
 */
export const DEPTH_SCALE: Array<[number, string]> = [
  [0, 'Not present'],
  [1, 'Exposure: has met it, or performs with step-by-step direction'],
  [2, 'Recognizes it and explains it in their own words, or performs with a reference'],
  [3, 'Recalls it, predicts consequences, performs independently in familiar conditions'],
  [4, 'Uses it precisely and reasons through new cases, adapting to new conditions'],
  [5, 'Fluent with edge cases, critiques and extends it, guides others'],
];

export const EVIDENCE_LABELS: Array<[string, string]> = [
  ['claimed', 'The instructor said so in the capture interview.'],
  ['materials', 'Backed by the course’s own materials: syllabus, assignments, rubrics.'],
  ['artifact', 'Seen in graded student work.'],
  ['predicted', 'Implied by the course’s written description. A prediction, not evidence.'],
];

export function HowToRead({ q }: { q: string }) {
  return (
    <section className="wiki-howto" id="how-to-read" aria-labelledby="howto-heading">
      <h2 id="howto-heading" className="wiki-index__h2">How to read this</h2>
      <ol className="wiki-howto__chain">
        <li id="course">
          <span className="wiki-howto__term">Courses</span>
          <p>Each course page is written from a capture: a structured interview with the instructor, checked against the course’s own materials.</p>
        </li>
        <li id="competency">
          <span className="wiki-howto__term">Competencies</span>
          <p>The specific capabilities a course develops, such as Quality Control or Brand Positioning. There are 30, and each belongs to one career target.</p>
        </li>
        <li id="kud">
          <span className="wiki-howto__term">Know, understand, do</span>
          <p>Every competency is scored three ways, each from 0 to 5. <em>Know</em>: recalls the content. <em>Understand</em>: can explain why it works. <em>Do</em>: produces the work. “K4 U2 D3” reads know 4, understand 2, do 3. Together with the depth scale this is called KUD+.</p>
        </li>
        <li id="career-target">
          <span className="wiki-howto__term">Career targets</span>
          <p>The five destinations the program prepares students for. Each is made of five to seven competencies, so a target is well served when courses across the sequence build its competencies to depth.</p>
        </li>
      </ol>

      <div className="wiki-howto__keys">
        <div id="depth">
          <h3>Depth, 0 to 5</h3>
          <dl className="wiki-howto__scale">
            {DEPTH_SCALE.map(([n, text]) => (
              <div key={n}><dt>{n}</dt><dd>{text}</dd></div>
            ))}
          </dl>
        </div>
        <div id="evidence">
          <h3>Evidence labels</h3>
          <dl className="wiki-howto__labels">
            {EVIDENCE_LABELS.map(([label, text]) => (
              <div key={label}><dt>{label}</dt><dd>{text}</dd></div>
            ))}
          </dl>
          <p className="wiki-howto__note">
            Five foundational competencies (Agency, Attention to Detail, Resilience, Curiosity, Communication) are scored on Do only.
          </p>
        </div>
      </div>
      <p className="wiki-howto__more">
        <Link href={`/wiki/guide${q}`}>Read the full guide</Link>, including why the three scores are kept separate.
      </p>
    </section>
  );
}

/** One-line pointer used at the top of article pages. */
export function TermsHint({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <p className="wiki-howto__hint">
      {children} <Link href={`/wiki${q}#how-to-read`}>How to read this</Link>
    </p>
  );
}
