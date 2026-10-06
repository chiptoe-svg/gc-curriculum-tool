# Interview course-context brief — design

**Date:** 2026-10-06. **Status:** design approved by the owner in conversation; this spec awaits owner review.

## Purpose

The capture interview already gets the captured profiles of prerequisite courses and has program-memory tools. It has no grounded view of the courses that **build on** this one, or of their projects. The owner asked for:
- **(a)** what later courses expect students to arrive with;
- **(b)** the major projects of linked courses.

These are context for sharper handoff questions, **never evidence** for this course's scores.

## Owner decisions (2026-10-06)

- Scope is (a) and (b). A Clemson catalog lookup is not part of this build.
- "Related courses" means **directly linked courses only** (option 1): this course's prerequisites, and the courses that list it as a prerequisite.
- **Source:** the GC course sheet's prerequisites line now. The Clemson catalog (via MCP) comes later as the authoritative source.
- **Next phase, recorded, not built:** add courses that develop the same competencies (option 2), once the re-score gives every captured course coverage scores.

## 1. Prerequisite map from the sheet

New module `lib/curriculum/sheet-prereq-graph.ts`.

- **`loadSheetPrereqPairs()`** reads every course's `courses.prerequisites` and returns `{ focal, prereq }` pairs, one per course code found. It uses `extractPrereqCodes(text, selfCode)`, which today is copied privately into each capture route that needs it (`scores`, `stress-test`, and the chat route's context assembly). This change moves it into one shared module, `lib/capture/prereq-codes.ts`, and the routes import it. That is the only change to those routes, so so self-references and text without a course code ("Sophomore standing") give no pair. Only codes that exist in `courses` are kept.
- **`prereqsOf(pairs, code)`** and **`dependentsOf(pairs, code)`** are pure helpers.
- **`prereq_chain` fix.** The tool in `lib/ai/wiki/graph-tools.ts` reads `prerequisite_edges`, which has 0 rows, so it always returns an empty neighborhood. It now uses the union of `prerequisite_edges` pairs and sheet pairs, deduplicated. The pure `prereqNeighborhood(pairs, code)` is unchanged.

## 2. The course-context brief

New module `lib/capture/course-context-brief.ts`.

- **`buildCourseContextBrief(courseCode)`** returns a structured brief.
- **`renderCourseContextBrief(brief)`** returns markdown.

Both are deterministic; no AI call.

**Contents:**

- **Students arrive from:** each prerequisite course from the sheet map, with code, title, and whether it is captured. Captured profiles are already loaded separately, so the brief only points to them.
- **Courses that build on this one:** each dependent course, with:
  - **What it expects students to arrive with:** the `incoming_expectations` from its latest capture snapshot (draft profile as fallback, the same order the chat route uses for prerequisites). If neither exists, "not yet captured".
  - **Its major projects:** from its capture's `major_projects` when captured, otherwise from `courses.major_projects` (the sheet), labelled with which source was used.
- **Source labels:** every item says where it came from, e.g. "GC 4060 capture snapshot 2026-08-14" or "course sheet".
- **Size cap:** about 1,500 tokens (6,000 characters). Items are trimmed beyond that, and the brief says how many were left out. Prerequisites come first, then dependents in code order.
- **Heading:** *"Neighboring courses — context for better questions, never evidence for this course's scores."*
- **No linked courses:** the brief says so in one line.

## 3. Where it goes

- **Interview only.** The chat route (`app/api/capture/[code]/chat/route.ts`) builds the brief, and `lib/ai/analyze/capture-chat.ts` renders it into the at-rest context next to the prerequisite profiles.
- **Not in scoring.** The profile synthesis (`app/api/capture/[code]/scores/route.ts`, `capture-scores`), the stress test, and coverage scoring never receive it. A test asserts the scoring context contains no brief heading.

## 4. Interview instructions

These changes go in `lib/ai/prompts/capture-chat-agent.md`.

- **"What you have at rest"** gets one bullet describing the brief and its "never evidence" status.
- **"1b. Downstream connections"** is rewritten:
  - Use the brief for grounded handoff probes, e.g. *"GC 4060 and GC 4070 build on this course and run flexo jobs on film and board — does your substrate work prepare students for that?"*
  - Ask open first ("What can students do when they leave?"), then compare with what the later course expects. Don't lead the instructor.
  - Ask at most **2** handoff probes per session.
  - Where a later course is "not yet captured", say so; never invent its expectations.
  - Land findings in `audit_notes.downstream_connections`, as now.
- **Projects nudge:** watch for progression (builds on a linked course's project), duplication (the same project again), or a missed chance to share a project, and ask about it once if found.
- **The binding rule stays:** program memory is reference, never evidence.

## 5. Testing

Every regression test gets a red proof.

- **Sheet map:**
  - both directions;
  - multiple codes in one line ("GC 3460, GC 4060");
  - self-reference;
  - text without codes;
  - unknown codes dropped.
- **`prereq_chain`:** returns GC 3460's real neighbors when `prerequisite_edges` is empty (fake DB).
- **Brief:**
  - a captured dependent shows its incoming expectations;
  - an uncaptured dependent shows "not yet captured" plus sheet projects;
  - source labels are present;
  - the size cap trims and reports what was omitted;
  - the "never evidence" heading is present;
  - a course with no links gets the one-line note.
- **Separation:** the chat context includes the brief; the scores-route context does not.
- **Live check:**
  - build and print the brief for GC 3460 (dependents GC 4400, 4060, 4070, none captured) and for one course with a captured dependent;
  - run one interview turn on GC 3460 (read-only; no snapshot write) and check the handoff probe is grounded and labelled.

## Recorded as follow-ups (STATE.md Deferred/debt)

1. **Clemson catalog via MCP** as the authoritative prerequisite source, in both directions and including non-GC courses. Flag courses where the sheet and the catalog disagree.
2. **Option 2:** competency-overlap courses in the brief, after the re-score.
3. The `prerequisite_edges` table is empty, and the skill-tagged edges seed (`prereq-edge-seed`) was never run. Decide whether to keep it or retire it.

## Tracking

Update STATE.md in the same commits: the new brief in the interview context, the `prereq_chain` fix, and the three follow-ups.
