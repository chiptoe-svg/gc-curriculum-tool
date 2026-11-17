# Course cluster map — design

Date: 2026-11-17. Owner-directed (conversation of 2026-11-17). Builds on
`2026-11-16-map-course-edits-and-required-skills-design.md` (map edits, required-skill threads, the skill-match judge).

## Intent

The degree map at `/build` answers program-level questions (acts, terms, branches, competency targets). The owner
wants a second, simpler map for a **cluster** of related courses (for example a print-production sequence: direct
mail, perfect-bound books, brochures). Its job is one question: **do the skills each course requires on arrival come
from the skills developed upstream of it, and do the cluster's courses together develop what the cluster is meant to
deliver?** No competencies, targets, fade, acts or problem-solving.

Success: the owner can put five to ten courses on a canvas, draw or accept prerequisite arrows, open any course to see
and edit what it requires and develops, and read off which requirements, course objectives and cluster objectives are
met, partly met or not, and by which courses. It "should just be right much more often than wrong"; faculty override
where it is wrong.

## Goals

1. **Clusters are their own saved maps**, listed beside degree plans, with the same owner model (personal /
   department) and the same login gate as `/build`.
2. **A free canvas.** Add a course from: a captured course, a what-if version of a captured course, or a new course
   drafted from a syllabus. Cards are placed freely; position means nothing.
3. **Arrows decide upstream.** When both ends are on the canvas, a catalog prerequisite is drawn automatically. Faculty
   may add arrows and remove catalog arrows (as `/build` allows with `links` / `unlinked`). A course's **upstream** is
   every course reachable backward along arrows (the whole chain, not only direct prerequisites).
4. **Skill threads.** For each course, each required skill gets a status (Met / Partly / Not, plus the composite
   statuses below) against the developed skills of its upstream courses, naming the supplying course(s).
5. **Course objectives.** Each course's learning objectives get a status against **that course's own developed
   skills**.
6. **Cluster objectives.** Faculty write a handful of objectives for the cluster as a whole. Each gets a status against
   the developed skills of **every course on the cluster**, regardless of arrows.
7. **Skills are the evidence everywhere.** Captured courses use their captured skills; a syllabus-drafted course uses
   skills the free campus model drafts from the syllabus (existing `lib/builder/syllabus-draft.ts`); faculty can edit
   both.
8. **Proposed is visible.** Any status that rests on a made-up course (syllabus-drafted, or created on the cluster) or
   on a faculty-edited / added skill is labeled in words — "Met: proposed (GC 4xxx drafted from syllabus)", "Met:
   proposed (edited skill in GC 2070)" — on threads, course objectives and cluster objectives alike. Not only an
   asterisk.
9. **Overrides.** Faculty can override any status (thread, course objective, cluster objective). Pairwise thread
   overrides go to `skill_match_decisions` as today (shared across maps, since they are keyed by text and course).
   Objective overrides are kept with the cluster.
10. **Course panel.** Clicking a course opens a panel with what `/build`'s course drawer offers minus competencies:
    description, objectives (with status), developed skills, required skills (with thread status and candidates),
    editing of all three, version choice (captured / what-if), and — for captured courses with a stored guide — the
    wiki's "Assessing the course objectives" section read-only (owner: "if the wiki guide is useful, certainly use
    it"). The guide is a reference beside the skills-based status; it does not change any status.
11. **Edits stay on the cluster.** Course edits made on a cluster never show on degree plans or other clusters.
12. **Carry an edited course out.** Each edited course has "Save as a new version": it writes a what-if
    (`course_what_ifs`) holding the course as it reads on the cluster (objectives, developed and required skills),
    marked **skills only** (no competency estimate), selectable wherever that course is added on a cluster (see
    "Settled details"). The original course and
    its capture are never touched. The cluster's changes also download as Markdown (reuse `lib/builder/changes-md.ts`).

## Matching rule (threads and objectives)

One matcher for every "is X covered by these skills" question, all on the free campus models:

1. **Shortlist** by embedding similarity (qwen3-embedding-4b, existing `embedBatch`).
2. **Single supplier first:** the existing pair judge (`lib/ai/match-judge.ts`, `MODEL_IN_USE`, `CUTOFFS`). If one
   skill fully supplies it → **Met**. Judgments cached as today (text hash + model + prompt version).
3. **Otherwise the set test** (from the 2026-11-16 composite experiment, `composite.ts` v3): ask whether the shortlist
   together supplies it; ask for the smallest set; keep picks the pair judge scores at least partly; then ask, about
   that set only, (a) together do they develop it and (b) does any course have students use them together.
   - (a) high, (b) high → **Met by a set** ("Met by GC 2070 + GC 4400, used together").
   - (a) high, (b) low → **Parts met, combining not shown** (treated like a partial).
   - otherwise fall back to the best pair: **Partly** or **Not**.
4. The set-test cut-offs are **provisional** until the owner's 22 set labels
   (https://claude.ai/artifact/GNQDJuYtUa5DLKvzUvs6WU) are scored; they live beside `CUTOFFS` and are refit then.
5. Set-test answers are cached by (target text hash, sorted member text hashes, model, prompt version) so a cluster
   reopens without re-asking.

For **course objectives** the candidate pool is the course's own developed skills; for **cluster objectives** it is
all developed skills on the cluster; for **required skills** it is the developed skills of upstream courses.

## Non-goals

- Competencies, KUD levels in any status, targets, acts, terms, branches, fade, problem-solving, degree hours.
- Changing `/build`'s behavior or its Met* label (the shared pieces are moved, not altered).
- Grading evidence: whether an objective is graded in Canvas is shown (wiki guide) but never counted.
- Generating new wiki guides from the cluster (that runs on the paid provider; out of scope).

## Anti-goals

- A cluster edit leaking into a degree plan or a course's capture.
- A proposed (drafted / edited) basis reading the same as a captured one.
- Paid AI spend from normal use. Everything here is campus models; if any step would need a paid call, it is out.
- Duplicating `/build`'s shared components (the reason approach A was rejected).

## Approaches considered

- **A. Copy `/build` and strip it** (owner's first idea). Fastest start, but the shared parts (add course, syllabus
  import, editing, required skills) would exist twice and drift; and `Map.tsx` is mostly act lanes and term rows, so
  the canvas is rewritten either way.
- **B. A cluster mode inside the builder.** One codebase, but act/term/branch logic runs through `Builder.tsx`,
  `Map.tsx`, `compute.ts` and `threads.ts`; the switch would sit in dozens of places and every cluster change would
  risk the live degree map.
- **C. A new cluster page that imports the shared parts — chosen by the owner** (also Claude's pick). New
  canvas, new skills-only checks, a lean course panel; the shared pieces are imported, and `CourseDrawer.tsx`'s
  skills / objectives / editing sections are split into components both pages use.

## Constraints

- Next.js 15 App Router, Drizzle on Postgres 17, Vitest; follow `lib/builder` patterns (pure compute modules with
  tests; React client components under `app/build`).
- Storage: a new table for clusters (same columns as `curriculum_plans`: name, state jsonb, version, owner grant/kind,
  created/updated by/at) with its own zod-validated `ClusterState`; a migration, applied to the live DB only with the
  owner's go-ahead and a backup first. Set-test cache: a new table or an extension of `skill_match_judgments` (builder's
  call). Objective overrides live in `ClusterState`.
- `threads.ts`'s eligibility is term-based; clusters need upstream-by-arrows. Do not change `requiredByCourse`'s
  behavior for `/build`; write the cluster check alongside it, sharing what can be shared.
- Campus models only (`CAMPUS_LLM_*`, embeddings); judge calls are batched and cached; the UI shows a pending state
  while judgments arrive, as `/build` does.
- US spelling; plain-language copy for faculty.
- The user is headless: verification on https://gcworkflow.clemson.edu:8443, never localhost.

## Settled details (from the builder check)

- **Where skill text comes from (answered by the code).** Captured courses already carry statement-level text in the
  builder library (`lib/builder/library.ts`): developed skills as `Skill { statement, k, u, d }` on the course's
  version, required skills as `RequiredSkill { ref, statement, need }`, objectives as `LibraryCourse.objectives`
  ("Stated learning objectives", the same objectives that get a status here). The 2026-11-16 thread work and the
  composite experiment both match on this text; no derivation step is needed. Map edits apply on top through the
  existing `effectiveCourse` (`lib/builder/edits.ts`).
- **Edits are stored as ops** (Claude's call): `ClusterState.courseEdits` uses the same `CourseEdits` op shape as
  `/build`, so `effectiveCourse` and `changes-md` are reused. Edits sit on top of the live capture and follow it when
  it is re-run, as on `/build`.
- **Cycles** (Claude's call): an arrow that would make a cycle is refused when drawn, with a one-line reason; upstream
  is the reachable set backward, excluding the course itself. A saved state with a cycle (hand-edited) is tolerated
  the same way.
- **What the set judge sees** (Claude's call): as in `composite.ts` v3, each member as course code + title + catalog
  description (first 350 characters; a drafted course's own description) + the skill statement. Same for proposed
  courses.
- **Empty pools** (Claude's call): a requirement or objective with no candidate skills reads **Not met** with the
  reason in words ("no upstream courses", "this course has no developed skills yet"); no extra status.
- **Overrides** (Claude's call): pairwise thread overrides write `skill_match_decisions` with `plan_id` = the cluster
  id; `source` gains a value `'cluster'` (the check constraint is extended in the cluster migration). An override of a
  set-based or objective status is stored in `ClusterState.overrides`, keyed by the target's id (required-skill ref,
  or a stable objective id: course objectives by `courseRef` + hash of normalized text, cluster objectives by their
  own id) plus a hash of the target text; if the text changes, the override is shown as stale, not applied.
- **What "Save as a new version" writes (owner's choice, 2026-11-17).** A `course_what_ifs` row that also holds
  skills: the cluster migration adds a nullable jsonb column (e.g. `skills`: `{ objectives: string[], developed:
  Skill-like[], required: RequiredSkill-like[] }`) and the row's `estimate` / `profile` stay null ("skills only").
  The builder library carries these on `LibraryWhatIf`; the cluster's version picker offers them. **`/build` hides
  skills-only what-ifs** (no competency rating to show) until someone scores one; existing what-if pages and readers
  must tolerate the null `estimate` / `profile` (check every reader of `course_what_ifs`). The author and owner grant
  come from the saving user, as for other what-ifs.
- **Wiki guide**: read with `getObjectiveGuide(courseCode)` (parsed `ObjectiveGuide`), rendered with the existing
  `ObjectiveGuidePanel` in its embedded form; nothing shown when none is stored.
- **Judge load** (Claude's call): candidates are the top 8 by embedding per target (as in the experiment); pair calls
  reuse the cache and run at concurrency 4; the set test runs only when no single supplier is fully met. Statuses
  appear as judgments arrive, as on `/build`.

## Left to the builder

- Route names (proposed: list at `/build` with a "Clusters" section; cluster page `/build/clusters/[id]`).
- Canvas mechanics (drag, arrow drawing, auto-placement of a newly added course).
- Exact set-test thresholds before the owner's labels are scored.
- Whether a status's "proposed" label names one source or all of them when several apply.
