import type { Metadata } from 'next';
import { FeedbackLink } from '@/app/FeedbackLink';

export const metadata: Metadata = { title: 'How to capture a course — GC Curriculum Tool' };

// Step-by-step how-to for CourseCapture (owner, 2026-10-07). Screenshots are of
// GC 1010 and live in public/howto/; retake them with scripts/howto/screenshots.cjs
// whenever these screens change. The long explainer stays on GitHub Pages.
const GUIDE_URL = 'https://chiptoe-svg.github.io/gc-curriculum-tool/docs/using-coursecapture-and-explore.html';

interface Step {
  title: string;
  img: string;
  w: number;
  h: number;
  alt: string;
  body: React.ReactNode;
}

const STEPS: Step[] = [
  {
    title: 'Open your course',
    img: '01-course-list.png', w: 1692, h: 214,
    alt: 'A course row in the course list with an Edit Course link',
    body: (
      <>
        From the course list, find your course and click <strong>Capture Course</strong> (first time) or{' '}
        <strong>Edit Course</strong> (it has been captured before).
      </>
    ),
  },
  {
    title: 'Check your materials',
    img: '02-materials.png', w: 2560, h: 1800,
    alt: 'The materials step with Canvas, Syllabus and Other materials boxes',
    body: (
      <>
        Pick your name under <strong>I&apos;m the instructor</strong>. Then open each box (Canvas, Syllabus &amp;
        course info, Other materials) and add anything missing. <strong>A syllabus is required.</strong> Assignment
        sheets, rubrics and slides make the record stronger. Click <strong>Continue →</strong>.
      </>
    ),
  },
  {
    title: 'Choose how closely to read each file',
    img: '03-triage.png', w: 2560, h: 1800,
    alt: 'The triage step with High, Middle and Background levels',
    body: (
      <>
        The tool has guessed a level for each file. Anything graded (syllabus, assignments, rubrics, quizzes)
        belongs in <strong>High</strong>; lecture slides in <strong>Middle</strong>; readings in{' '}
        <strong>Background</strong>. Use ▲ ▼ to move a file, then click <strong>Read files &amp; continue</strong>.
        Reading takes a few minutes the first time, and you go on to the interview automatically.
      </>
    ),
  },
  {
    title: 'Start the interview',
    img: '04-interview-start.png', w: 2560, h: 1800,
    alt: 'The interview start screen with instructor and start mode',
    body: (
      <>
        Check your name, and choose <strong>Build on prior capture</strong> (if the course was captured before) or{' '}
        <strong>Fresh capture</strong>. Scroll down and click <strong>Start the interview</strong>.
      </>
    ),
  },
  {
    title: 'Answer the interviewer',
    img: '05-interview.png', w: 2196, h: 2226,
    alt: 'An interview exchange with a highlighted question and the reply box',
    body: (
      <>
        Each turn ends with a <strong>Question for you</strong>. Type your answer, or click{' '}
        <strong>Voice</strong> to speak it, then <strong>Send</strong>. Be specific about what students actually
        do and how it is graded. The readiness bar shows how much the interviewer has covered. Your answers are
        saved as you go, so you can stop and come back any time.
      </>
    ),
  },
  {
    title: 'Finish the interview',
    img: '06-generate-button.png', w: 2192, h: 242,
    alt: 'The Generate Profile button with a note to answer the last question first',
    body: (
      <>
        When you have said what matters, click <strong>I&apos;m done — give me one last question</strong>. Answer
        that question, then click <strong>Generate Profile</strong>.
      </>
    ),
  },
  {
    title: 'Wait about two minutes',
    img: '07-generating.png', w: 2560, h: 1800,
    alt: 'The generating screen with a timer',
    body: <>The tool turns the interview and your materials into a draft profile. Keep the tab open.</>,
  },
  {
    title: 'Check the outcomes',
    img: '08-outcomes-check.png', w: 2560, h: 1800,
    alt: 'The apparent outcomes list with Looks good, Add or change something, and Back to the interview',
    body: (
      <>
        Read the list of what students can do by the end. If it fits, click <strong>✓ Looks good — proceed</strong>.
        To fix something, click <strong>Add or change something</strong>, describe it, and accept the suggested
        edit. The next screen does the same for the skills students arrive with.
      </>
    ),
  },
  {
    title: 'Review the profile',
    img: '09-review.png', w: 2560, h: 1800,
    alt: 'The review page with the How to review box',
    body: (
      <>
        Read the overview at the top. Below it, the cards the AI was least sure about are highlighted. Each one
        needs a decision before you can approve.
      </>
    ),
  },
  {
    title: 'Confirm or adjust each highlighted card',
    img: '10-needs-adjusting.png', w: 2100, h: 1408,
    alt: 'A card opened for adjusting, with a Change button for each score',
    body: (
      <>
        Click <strong>✓ Looks right</strong> if the card is correct. Otherwise click{' '}
        <strong>Needs adjusting</strong>, use <strong>Change</strong> next to the score that is wrong, pick the
        description that fits best, and click <strong>Save changes</strong>.
      </>
    ),
  },
  {
    title: 'Approve',
    img: '11-approve.png', w: 2196, h: 682,
    alt: 'The approve dialog with an optional caption',
    body: (
      <>
        When every card is done, click <strong>Approve the profile</strong> at the bottom of the page (it says{' '}
        <strong>Approve update</strong> for a course captured before). Add a caption if you like, and confirm.
      </>
    ),
  },
  {
    title: "You're done",
    img: '12-captured.png', w: 2196, h: 320,
    alt: 'The green Captured card with links',
    body: (
      <>
        The green card means the course is recorded. Its public profile and the curriculum wiki update on their
        own. Nothing else is needed.
      </>
    ),
  },
];

const TROUBLE: Array<{ q: string; a: React.ReactNode }> = [
  { q: 'The first voice recording is slow', a: 'The first one takes a few extra seconds to start. After that it is quick.' },
  {
    q: "A file couldn't be read",
    a: (
      <>
        The reading step stops and says which one. Go <strong>← Back to materials</strong> to replace it, or
        continue without it.
      </>
    ),
  },
  {
    q: 'I need to stop partway',
    a: 'Close the tab. Your interview is saved; open the course again and the interviewer picks up where you left off.',
  },
  {
    q: 'The profile gets the course badly wrong',
    a: (
      <>
        Click <strong>← Back to the interview</strong>, tell the interviewer what it missed, and generate again. For
        a score or two, just adjust those cards.
      </>
    ),
  },
  {
    q: 'A page looks broken or a button does nothing',
    a: 'The tool may have just been updated. Reload the page (Shift-Reload).',
  },
];

export default function HowToPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-baseline justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-sm text-muted-foreground">GC Curriculum Tool</p>
            <h1 className="mt-0.5 font-display text-2xl font-semibold tracking-tight">How to capture a course</h1>
          </div>
          <div className="flex items-baseline gap-4">
            <a href="/" className="text-sm text-muted-foreground hover:text-foreground">Course List</a>
            <a href={GUIDE_URL} target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground hover:text-foreground">
              Detailed guide ↗
            </a>
            <FeedbackLink />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        <p className="text-base leading-relaxed text-muted-foreground">
          To capture a course, you check your materials, answer an AI interviewer&apos;s
          questions, then review and approve the profile it drafts. These are the steps, using GC 1010 as the
          example. For the reasoning behind each step, see the{' '}
          <a href={GUIDE_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">detailed guide</a>.
        </p>

        <ol className="mt-8 space-y-12">
          {STEPS.map((s, i) => (
            <li key={s.img} id={`step-${i + 1}`} className="scroll-mt-6">
              <h2 className="font-display text-xl font-semibold tracking-tight">
                <span className="mr-2 text-muted-foreground">{i + 1}.</span>
                {s.title}
              </h2>
              <p className="mt-2 text-base leading-relaxed">{s.body}</p>
              {/* eslint-disable-next-line @next/next/no-img-element -- static screenshots, sized by width/height */}
              <img
                src={`/howto/${s.img}`}
                alt={s.alt}
                width={s.w / 2}
                height={s.h / 2}
                loading={i < 2 ? 'eager' : 'lazy'}
                className="mt-4 h-auto w-full rounded-md border shadow-sm"
              />
            </li>
          ))}
        </ol>

        <section className="mt-16 border-t pt-8" aria-labelledby="trouble">
          <h2 id="trouble" className="font-display text-xl font-semibold tracking-tight">If something goes wrong</h2>
          <dl className="mt-4 space-y-4">
            {TROUBLE.map(t => (
              <div key={t.q}>
                <dt className="font-semibold">{t.q}</dt>
                <dd className="mt-1 text-base leading-relaxed text-muted-foreground">{t.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>
    </div>
  );
}
