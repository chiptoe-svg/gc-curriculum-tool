import Link from 'next/link';
import type { CourseViews } from '@/lib/wiki/course-views';

const depth = (v: number | null) => (v === null ? '–' : String(v));

function fmt(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/**
 * The three views of a course, side by side: what the syllabus says, what the
 * evidence shows, and what the syllabus predicts. Deterministic, from recorded
 * data (lib/wiki/course-views.ts). Owner request 2026-10-05.
 */
export function CourseViewsPanel({ views, q }: { views: CourseViews; q: string }) {
  const { objectives, evidence, predicted } = views;
  const technical = evidence?.rows.filter(r => !r.foundational) ?? [];
  const foundational = evidence?.rows.filter(r => r.foundational) ?? [];
  const how = `/wiki${q}#how-to-read`;

  return (
    <section className="wiki-views" aria-labelledby="views-heading">
      <h2 id="views-heading">Objectives, evidence and predictions</h2>
      <p className="wiki-views__intro">
        Three views of the same course. Scores are <Link href={`/wiki${q}#kud`}>know, understand and do</Link>,
        each on a <Link href={`/wiki${q}#depth`}>0 to 5 depth scale</Link>. <Link href={how}>How to read this</Link>
      </p>

      <div className="wiki-views__grid">
        <div className="wiki-views__col">
          <h3><span className="wiki-views__n">1</span> What the syllabus says</h3>
          <p className="wiki-views__sub">The course’s stated learning objectives.</p>
          {objectives.length > 0 ? (
            <ol className="wiki-views__objectives">
              {objectives.map((o, i) => <li key={i}>{o}</li>)}
            </ol>
          ) : (
            <p className="wiki-views__empty">No learning objectives are recorded for this course.</p>
          )}
        </div>

        <div className="wiki-views__col">
          <h3><span className="wiki-views__n">2</span> What the evidence shows</h3>
          {evidence ? (
            <>
              <p className="wiki-views__sub">
                Measured in the capture of {fmt(evidence.capturedOn)}. <Link href={`/wiki${q}#evidence`}>Evidence labels</Link>
              </p>
              <table className="wiki-views__table">
                <thead><tr><th scope="col">Competency</th><th scope="col" title="Know">K</th><th scope="col" title="Understand">U</th><th scope="col" title="Do">D</th><th scope="col">Evidence</th></tr></thead>
                <tbody>
                  {technical.map((r, i) => (
                    <tr key={i}>
                      <td>{r.statement}</td>
                      <td>{depth(r.k)}</td><td>{depth(r.u)}</td><td>{depth(r.d)}</td>
                      <td className={`wiki-views__src is-${r.evidence}`}>{r.evidence}</td>
                    </tr>
                  ))}
                  {foundational.length > 0 && (
                    <tr className="wiki-views__divider"><th scope="rowgroup" colSpan={5}>Foundational, scored on Do only</th></tr>
                  )}
                  {foundational.map((r, i) => (
                    <tr key={`f${i}`}>
                      <td>{r.statement}</td>
                      <td>–</td><td>–</td><td>{depth(r.d)}</td>
                      <td className={`wiki-views__src is-${r.evidence}`}>{r.evidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {evidence.disagreements.length > 0 && (
                <div className="wiki-views__gaps">
                  <h4>Where the stated course and the evidence disagree</h4>
                  <ul>{evidence.disagreements.map((d, i) => <li key={i}>{d}</li>)}</ul>
                  <p className="wiki-views__note">These are the capture’s own findings. Objectives are not yet matched to evidence one by one.</p>
                </div>
              )}
            </>
          ) : (
            <p className="wiki-views__empty">This course has not been captured yet, so there is no measured evidence.</p>
          )}
        </div>

        <div className="wiki-views__col">
          <h3><span className="wiki-views__n">3</span> What the syllabus predicts</h3>
          <p className="wiki-views__sub">
            The depth the course’s written description implies for each <Link href={`/wiki${q}#career-target`}>career target</Link>. A prediction, not evidence.
          </p>
          {predicted.length > 0 ? (
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
          ) : (
            <p className="wiki-views__empty">No syllabus-based prediction has been run for this course yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}
