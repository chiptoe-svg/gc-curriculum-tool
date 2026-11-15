# Curriculum builder — design

**Date:** 2026-11-14 (built 2026-11-14/15, branch `feat/curriculum-builder`)
**Status:** built. The owner asked for a usable tool to try and opted out of a design round ("brainstorm on your own"); the choices below marked *my call* were made on the owner's behalf and are open to correction. Requirements the owner added while it was being built are marked *owner*.

## What it is for

A group of faculty builds a curriculum together and sees, as they build, whether it reaches a set of targets. They stack courses into the three acts, set the Know / Understand / Do level each competency should reach by the end of each act for a career path, and the map shows which targets the stack reaches, which it misses, and which it reaches once and then lets fade.

It answers Q1 ("how well does the curriculum build toward the careers we claim?") as a design question rather than a report: change the stack, see the answer change.

## Goals

- Reach every course: the tool's own courses with both of their readings, the rest of the Clemson catalog, what-ifs on a course, and new courses invented in the plan. *(owner)*
- Two inputs per course, switchable for the whole map: **stated learning objectives** and **discovered outcomes**. *(owner)*
- The three acts organize the map, and it builds **from the bottom**: Act 1 at the bottom, career paths at the top. *(owner)*
- Targets are specific: K, U and D per competency, per career path, at the end of Act 1, 2 and 3, plus written objectives; the level achieved is visible against each. *(owner)*
- The map defines order, dependencies and branches. *(owner)*
- Combining follows the project's research on bundling and on reinforcement and fade, and every rule says what it rests on. *(owner)*
- A plan is shared: anyone with faculty access can open and edit it.

## Non-goals

- A plan never changes a real course, snapshot, coverage cell or catalog row.
- No AI call scores anything. The only model use is the campus embedding model, to shortlist competencies for a new course's description; a person picks and sets the levels.
- No credit-hour or scheduling arithmetic (semesters, seat counts, time to degree).
- No attainment claim. The map shows what the curriculum gives students the opportunity to reach.

## Anti-goals

- A number that looks measured and is not. Derived depths (fade) never appear as decimals; the fade rate is a visible setting labeled as an assumption.
- A soft reading passing as evidence. Anything resting on a stated objective, a proposed course or a what-if is drawn as a halftone and named.
- Zero standing in for "no data".

## How it is built

| Piece | Where |
| --- | --- |
| Analysis (pure, runs in the browser on every edit) | `lib/builder/compute.ts`, tests `lib/builder/__tests__/` |
| What can be stacked (read-only loader) | `lib/builder/library.ts`, `lib/builder/relations.ts` |
| Plan shape and limits | `lib/builder/types.ts`, `lib/builder/plan-schema.ts` |
| Saved plans | `curriculum_plans` (migration `0067`), `lib/db/curriculum-plan-queries.ts` |
| Routes | `/build`, `/build/[id]`, `/api/build/plans`, `/api/build/plans/[id]`, `/api/build/catalog`, `/api/build/suggest` |
| Access | new `plan-write` kind in `lib/auth/authorize.ts`: anyone who can capture at least one course (the what-if rule). Delete: the creator or an admin. |

A plan is one JSON document (`PlanState`): placements (course, act, branch, in teaching order), branches, dependency links added or set aside, proposed courses, the chosen version per course, the targets, the input lens, and the fade setting. Saving is optimistic: a save names the version it read and is refused if someone else saved first; the editor then offers to load theirs or overwrite.

## The combining rules and what each rests on

"Held" means the project holds the source and has a reference card for it under `docs/references/`. The published deep dive (`docs/curriculum-map-deep-dive.html`) carries the quotes and pages; this table is the engineering record.

| Rule | In the code | Rests on | Standing |
| --- | --- | --- | --- |
| Depth across courses is the per-dimension **maximum**, never a sum or mean | `stack()` | The project's own rule since the prerequisite-gap engine (`lib/program/prereq-gaps.ts`) and the sufficiency seam (`lib/program/sufficiency.ts`): the 0–5 scale is ordinal with anchored rungs (`depth-scale.md`), so two D2s are not a D4. | Framework commitment |
| K, U and D are kept apart; foundational competencies are judged on Do only | `checkpoint()`, `requiredLevels()` | KUD+ (`docs/background.html`); CLAUDE.md load-bearing rule 2 | Framework commitment |
| No reading is not zero | every `null` in `compute.ts` | Repo-wide null discipline (prereq-gaps, sufficiency, depth-band) | Framework commitment |
| A target reached only through a stated objective, a what-if or a proposed course is marked | `evidenceBasis()`, flag `soft_evidence` | Evidence-above-zero rule (CLAUDE.md rule 1); the measured / mixed / intended basis in prereq-gaps; intended vs. enacted vs. attained curriculum (deep dive) | Framework commitment |
| Introduce, practice, integrate; integration with no earlier setup is "brittle" | `depthScaffoldingStatus` reused unchanged | Phase 1B scaffolding spec (2026-05-25); 3-Act deep dive (Bruner's spiral, backward design, cornerstone-capstone) | Consistent with the literature, not derived from it (the 3-Act page's own wording) |
| The three acts and what each is for | board bands, `defaultAct()` (GC 4400 and GC 4060 start in Act 2) | `docs/three-act-deep-dive.html` | A proposal, not institutional policy |
| A depth reached and never revisited **fades** | `durable()` | Measurement-hypotheses spec 2026-06-19 §2: decay of unused skill (Arthur et al. 1998, held), durable vs. instantaneous depth (Bahrick 1984, held), forgetting curve (Murre & Dros 2015, held) | The phenomenon is supported |
| It fades **about one level per act** | `plan.fade` (0, 0.5 or 1; default 1) | The owner's working assumption, recorded in that spec §2.2. The spec's own caveat stands: the literature gives decay in standard-deviation units, not KUD levels, and decay is front-loaded | **Assumption.** Shown as a setting; the spec says these parameters must be fitted to graduate outcomes before being trusted |
| Each further course working the competency within a level of its peak **halves** the loss | `durable()` (`0.5 ** (reinforcers − 1)`) | Form borrowed from Half-Life Regression (Settles & Meeder 2016), which the spec §2.7b names as the borrowable shape; spacing and distributed practice (Cepeda et al. 2006/2008, held); desirable difficulties (Bjork 1994, held). "Two or three D4s … resolve to a D4 that sticks" is the owner's wording (§2.2) | Form supported; the factor of one half is an **assumption** |
| A lighter touch slows the loss and never raises the level | `durable()` (`touched`) | Spec §4.2: "a D2 touch does not promote a D4 to D5; it adds a fractional boost and slows decay" | Supported in direction; size is an **assumption** |
| A closely related competency worked at integration depth slows the fade; it never raises a level. **Off unless the plan switches it on** (`plan.support`) | `integrationByAct()`, `durable()` (`support`) | Spec §2.3–2.4 and §2.7d: durability-lift is the better-evidenced reading; pull-up must be directional, bounded, depth-gated and never across distant domains. The deep dive adds that the transfer literature (Perkins & Salomon 1992) argues against assuming it | The weakest claim in the model: an **assumption**, opt-in, and never more than a halving of one act's loss |
| Which competencies are "related" | `relations.ts`: nearest three bundle cards **in the same stratum** with cosine ≥ 0.5 | Bundle cards are the catalog's definition of a competency (competency-catalog deep dive); "embeddings shortlist, don't adjudicate" (spec §2.3). The 0.5 floor is the 90th percentile of same-stratum pairs measured on the stored vectors on 2026-11-14 | Topology is a **shortlist**, not a judgment. The July 2026 alignment measurement found off-the-shelf cosine and LLM identity judgments both unreliable for "same skill", which is why nothing here raises a level |
| Derived depths are floats inside the model and bands or arrows on screen | `heldByAct` is never rendered; `dimNote()` shows ▾ | Spec §4.2 "integer at the boundary, float in the model", guardrail 1 | Framework commitment |
| Lone peak vs. reinforced thread | `thread`, flag `lone_peak` | Spec §2.5 B1 "structural durability (buildable now)" | Supported as a structural flag |
| Dissociation flags (terms without reasons, theory without craft, craft without articulation, mentioned only) | flags in `computePlan()` | CLAUDE.md rule 3; `isMentionOnly` in `lib/program/depth-band.ts` | Framework commitment |
| Career-path "% of the way" | `TargetResult.fit` | Entry weights from `career_target_membership` (P3 career weights). Every weight in the database is still a draft (230 AI-drafted, 35 faculty drafts on 2026-11-14) | Counts are the primary display; the percentage says the weights are drafts. Bridges (2020, held 2026-11-15) is an independent, field-specific importance source that could check them: importance only, not depth |

## Targets

There are no employer-required depths in the database (`career_target_requirements.required_*` is empty), so required levels are the faculty's to set. Until someone sets them a competency uses starting values: about K2 U1 D1 after Act 1 and 3 across after Acts 2 and 3, the same for every competency. *My call*, and labeled "starting values, not yet reviewed" wherever shown. An earlier draft asked for 4 on competencies a path rates very important; the deep dive's review caught that this turns an importance rating into a depth, which neither the weights nor Bridges (2020) support, so importance no longer sets depth. A level of 0 or blank asks for nothing at that checkpoint. The act targets are a hypothesized progression the department should expect to revise (Corcoran et al., in the deep dive).

When several career paths are selected, a trunk is drawn against the strictest requirement, and each path is scored against its own levels on its own courses (the trunk plus the branches tied to it).

A written objective belongs to a checkpoint (and optionally a career path) and is checked through the competencies it is linked to; with no link it reads "cannot be checked". This is the same shape as the 2026-11-15 handoff proposal (objective = catalog competency + target depth + the course's wording, one-to-many); if that link table is built, the builder should read it in place of the syllabus rough pass.

## Stated vs. discovered

- **Stated** = `course_intended_coverage` (the syllabus rough pass) plus the course sheet's objective sentences.
- **Discovered** = `snapshot_competency_coverage` for one approved capture per (course, instructor): the newest one that has been scored against the catalog.
- "Fill gaps" lets a course with no reading under the chosen input use its other one; such a course is marked "other reading".
- A what-if (one with a finished page) can be chosen as a course's version. It is a prediction, so it counts as **proposed** under either input.

Data gaps found while building (2026-11-15), neither fixed here:
- **GC 4400's five captures have never been scored against the competency catalog** (zero coverage cells), so the map can use only its stated reading. `/program`'s refresh scores it.
- Four captured courses (GC 1010, 3460, 3800, 4800) have no stated-objective reading.

## Order, dependencies and branches

- Order is the position within an act; acts are ordered 1, 2, 3.
- Dependencies start from the prerequisite map (`loadPrereqMap`: catalog, then the course sheet). A plan can add its own links and set a catalog prerequisite aside; neither touches the catalog. Any-of groups are honored. Checks: not in the plan, placed before it, or on a different branch.
- A branch is a set of courses only some students take, tied to one or more career paths. A course with no branch is taken by everyone. The map can be drawn for everyone together, for the shared courses only, or for one branch's students.

## Choices made on the owner's behalf

1. Plans are stored as one JSON document in a new table rather than normalized rows: nothing queries inside a plan, and the engine runs in the browser.
2. New and catalog-only courses live inside the plan, not in `courses`, so the catalog and `/program` are not polluted by proposals.
3. The engine is pure and shared by tests and browser; the server does no analysis.
4. Access follows the what-if rule (any capture right).
5. Starting target values, as above.
6. The model-judged competency-relation pass was **not** run, although the owner approved it: the 2026-11-15 handoff reports the July measurement (LLM skill-identity judgments 46–59% wrong, cosine ranges overlapping), so its output would have been unmeasured. See Deferred below.

## Where the literature pushes against this design

From the deep dive's review (`docs/curriculum-map-deep-dive.html`). The first three were corrected before release; the rest stand as known limits.

- Importance was setting depth in the starting targets. **Corrected** (above).
- Related-competency support was on by default. **Corrected**: opt-in.
- One fade rate covers K, U and D, though decay differs by kind of task (Arthur et al. 1998). **Labeled** as a simplification in the fade control; separate rates are deferred with the rest of the fade fitting.
- The map shows no cost for adding courses or prerequisites. Curricular analytics (Heileman et al. 2018) measures a course's blocking and delay; the builder checks order but does not show that cost. Deferred.
- Every reading is drawn as equally certain, although each coverage cell carries a confidence and agreement between readers varies by competency. Deferred.
- The per-dimension maximum assumes growth only adds up; learning-progression work warns that early understandings sometimes have to be undone. A known limit of the rule, shared with the prerequisite-gap and sufficiency engines.
- The evidence on what makes mapping tools useful to faculty is case reports; nothing held compares maps faculty used with ones they ignored. The build-around-faculty-questions choices rest on that.

## Deferred

- Blocking and delay per course (Heileman et al. 2018) beside the trunks.
- Showing how certain each reading is (bands, confidence).
- Judging each branch as a complete route and naming the weakest route to each target.

- A judged or learned competency-relation map (focused embedder or probe from the Spark test) to replace the same-stratum cosine shortlist in `relations.ts`, gated on the success test in the handoff.
- Fitting the fade parameters against graduate outcomes (spec §2.5 B2).
- Productive-failure and reflection cycles per competency (`aggregateSubCompetency`'s PF half) on the map.
- Comparing two plans side by side.
- AI drafting of a new course's levels.

## Verification

`lib/builder/__tests__/` (engine, relations, plan shape) and `tests/auth/authorize.test.ts` (access rule). The screen was exercised in headless Chromium against a scratch copy of the live database (`scripts/migrations/builder-scratch-db.sh`): create a plan, choose a path, open each panel, search the catalog, add a catalog course and a new course, get suggestions, drag between acts, add a branch, save and reload.
