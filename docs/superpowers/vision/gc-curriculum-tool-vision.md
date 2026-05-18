# The GC Curriculum Tool — Vision

> **Want to test drive a rough prototype?** → [Open the prototype](https://gc-curriculum-tool.vercel.app/preview/4QcseN0pvlpd35gb) (real AI analysis on real GC courses, ~30s per run)

## What we're building

A living view of where the curriculum is strong, where it's brittle, and where it's drifted — kept current, course by course.

> **Q1.** *How well does the GC curriculum build students toward the careers we claim to prepare them for?*

> **Q2.** *For any individual course, do the prerequisites students walk in with actually support what the course expects?*

Today these questions get answered through committee discussions, gut intuition, and the occasional curriculum review. Faculty know parts of the answer for the courses they teach. Nobody has the whole picture, and nobody has a way to update it as courses evolve.

The tool's job is to make those answers *visible* and *defensible* — for advising students, for accreditation conversations, for industry/advisory-board reviews, for the next curriculum redesign, and for hiring decisions about what kind of faculty the program needs.

## The end state

When the full tool is in production, it is the canonical living view of the GC program:

- **A career-target framework.** Five (initially) named career destinations — Account Management, Brand Strategy, Production & Operations, Creative Generalist, AI Workflow / Orchestrator — each with sub-competencies described at Know / Understand / Do levels (the "KUD" rubric). These are editable by the faculty leading each track; changes propagate through the rest of the system.

- **A complete course inventory.** Every active GC course has a structured record: description, learning objectives, projects, skills the instructor assumes students walk in with. The record is editable by the course owner and synced from each semester's syllabus.

- **A coverage matrix.** For every course × every career target, the AI maintains a current judgment of how well the course covers each sub-competency, at what level (Know / Understand / Do / not addressed), with confidence and reasoning that faculty can read, dispute, and flag.

- **Scaffolding analysis.** Across all 28+ courses, the AI judges how well each competency is scaffolded *as a program* — introduced in earlier courses, developed in middle courses, applied in capstones. It flags the cases that look fine cell-by-cell but fail program-wide: a senior-level course that expects mastery of something never taught before.

- **Prerequisite-gap analysis.** For any course, the tool reports whether the prior coursework students actually take supports what this course expects. Not what the registrar says is required — what the *competencies* require.

- **A flag/dispute trail.** Every AI judgment can be flagged with a faculty note. Flags get reviewed; the prompts and rubrics improve over time; the curriculum's understanding of itself sharpens.

- **A handful of high-leverage views.** A heat map of program-wide coverage. A per-course "is it scaffolded?" view. A per-career-target "is the program preparing students for this destination?" view. An advising view that says "if a student wants to graduate ready for Brand Strategy roles, here is the recommended sequence and the gaps to watch."

## What this enables

- **Faculty conversations grounded in evidence.** When two faculty disagree about whether a course teaches workflow design at Do level, they have an AI-drafted reading to argue against — and a way to make their disagreement persistent.

- **Curriculum changes with feedback before they ship.** A faculty member redesigning a course can see how their proposed syllabus would change coverage and scaffolding before the redesign goes through Curriculum Committee.

- **Honest career-readiness claims.** "Graduates of this program are ready for X" becomes a verifiable statement, not a marketing assertion.

- **A starting point for accreditation and advisory-board conversations.** Industry partners can see what the program actually delivers; the program can see what industry says is missing.

- **Defense against drift.** Curricula erode over decades. The tool surfaces erosion as it happens, instead of every seven-year program review.

## What the prototype shows

The prototype available now ([`/preview/<slug>`](#)) is the **M-trial**: a faculty-facing slice that demonstrates the AI's analysis quality on real GC courses against the five career targets. It doesn't yet have the program-wide views, the official course-record store, the rescore-on-edit machinery, or accreditation reporting. What it has:

- Pick a course from the GC course list, add 1–8 prior courses, pick a career target.
- The AI drafts Know / Understand / Do outcomes for each course, scores coverage against the target's sub-competencies, judges scaffolding quality, and identifies prerequisite gaps.
- Every judgment is expandable: click "Why?" to read the AI's reasoning. Flag any judgment that looks wrong with a note.

The point of the prototype is to confirm that *the analysis is good enough to be useful*. If faculty find the readings credible, defensible, and worth disputing on the merits, the rest of the tool is mostly plumbing.

## How we get there

- **M-trial (now)** — the faculty-facing analysis prototype, plus a shared sheet of standardized course records.
- **Phase 1** — the full coverage matrix in production: every course × every career target, kept current; the dispute/flag pipeline; the heat-map and per-course views; admin tooling for career-target evolution.
- **Phase 2** — program-wide scaffolding views, advising views, rescore-on-edit, and the views needed for accreditation and advisory-board conversations.
- **Phase 3** — public/employer-facing views, alumni/industry feedback integration, and the analytics needed to drive program decisions.

Each phase is shippable on its own and is useful to faculty before the next phase arrives.

## What this is *not*

- **Not** a replacement for faculty judgment. The tool drafts; faculty decide. Every AI reading is disputable, and disputes persist.
- **Not** a grading or evaluation tool for individual students or instructors. Coverage scores describe what the *course* delivers, not how well a student or instructor performed.
- **Not** an automated curriculum redesigner. It surfaces what is, makes scaffolding visible, and supports faculty conversations. The redesigning is still humans-in-a-room work.

## The full implementation design

For the technical details — data model, AI prompts, build sequence — see the [v1 implementation design](../specs/2026-05-17-gc-curriculum-tool-v1-design.html).
