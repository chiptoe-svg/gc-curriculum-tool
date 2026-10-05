import type { ObjectiveGuideSection } from '@/lib/wiki/objective-guide-section';
import { MEASURE_LABEL, CLASS_LEVEL_NOTE, formatEvidence } from '@/lib/objective-guide/render';
import { CopyGuideButton } from './CopyGuideButton';

function fmt(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export const NO_SYLLABUS_NOTICE =
  'There is no guide for this course yet because no readable syllabus is on file, and the guide quotes its objectives from the syllabus. Instructors: add the course syllabus on the capture page, imported from Canvas or uploaded, and the guide is built with the next capture.';

export const SET_ASIDE_NOTICE =
  'There is no guide for this course yet: the syllabus is set aside, so it is not read. Instructors: include it on the capture page, and the guide is built with the next capture.';

/**
 * Fourth course-page section (spec 2026-10-05): for each syllabus objective,
 * how well it is measured, where the evidence is in Canvas, and what to gather
 * at the end of the semester. Public, read-only, from course_objective_guides.
 */
export function ObjectiveGuidePanel({ section }: { section: ObjectiveGuideSection }) {
  return (
    <section className="wiki-assess" aria-labelledby="assess-heading">
      <h2 id="assess-heading">Assessing the course objectives</h2>

      {section.kind === 'no-syllabus' && <p className="wiki-assess__notice">{NO_SYLLABUS_NOTICE}</p>}
      {section.kind === 'syllabus-set-aside' && <p className="wiki-assess__notice">{SET_ASIDE_NOTICE}</p>}

      {section.kind === 'guide' && (
        <>
          <div className="wiki-assess__head">
            <p className="wiki-assess__intro">{section.guide.intro}</p>
            <CopyGuideButton text={section.text} />
          </div>

          {section.guide.objectives.length === 0 ? (
            <p className="wiki-assess__notice">No learning objectives could be quoted from the syllabus.</p>
          ) : (
            <ol className="wiki-assess__list">
              {section.guide.objectives.map((o, i) => (
                <li key={i} className="wiki-assess__item">
                  <p className="wiki-assess__objective">{o.objective}</p>
                  <p className={`wiki-assess__measure is-${o.measure}`}>{MEASURE_LABEL[o.measure]}</p>
                  <dl className="wiki-assess__facts">
                    <dt>Where the evidence is</dt>
                    <dd>{o.evidence.length > 0 ? o.evidence.map(formatEvidence).join('; ') : 'No graded item yet'}</dd>
                    <dt>What to gather</dt>
                    <dd>{o.gather}</dd>
                    {o.suggestion && (
                      <>
                        <dt>Smallest change that would help</dt>
                        <dd>{o.suggestion}</dd>
                      </>
                    )}
                  </dl>
                </li>
              ))}
            </ol>
          )}

          {section.guide.checklist.length > 0 && (
            <div className="wiki-assess__checklist">
              <h3 id="assess-checklist">Items to pull from Canvas at the end of the semester</h3>
              <ul aria-labelledby="assess-checklist">
                {section.guide.checklist.map((c, i) => <li key={i}>{formatEvidence(c)}</li>)}
              </ul>
            </div>
          )}

          <p className="wiki-assess__note">{CLASS_LEVEL_NOTE}</p>
          <details className="wiki-assess__text">
            <summary>Show as plain text</summary>
            <pre>{section.text}</pre>
          </details>
          <p className="wiki-views__note">Built from the capture of {fmt(section.capturedOn)}.</p>
        </>
      )}
    </section>
  );
}
