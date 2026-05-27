# The GC Curriculum Tool — Vision

> **Where the tool runs.** The live tool runs locally on the Clemson LAN at [http://130.127.162.180:3000/](http://130.127.162.180:3000/) — per-course audit at `/capture/<code>` (CourseCapture), alignment + what-if scenarios at `/explore/<code>`, and the program-level coverage matrix at `/program`. It is gated by HTTP Basic Auth and reachable only from inside the Clemson network. For a quick orientation without LAN access, see the [executive brief](../../executive-brief.html).
>
> **How it works.** Catalog values come from a [shared course sheet](https://docs.google.com/spreadsheets/d/12aPhgrIlhDYjKD0-Gt97glf1d9fKtwKmL4FwM8iTz7Q/edit?gid=1024237655#gid=1024237655), one tab per course — edit your tab and click **Sync from Sheet** in CourseCapture to pull the latest values. The audit session then combines those catalog values with Canvas-imported assignments and rubrics, uploaded materials, linked Google Docs / Sheets / Slides and Drive PDFs, and voice/chat audit; the confirmed snapshot feeds program-level analyses.
>
> For the academic background and theoretical justification behind the KUD+ framework — what it measures, why it's structured as it is, and how it's implemented at the course and career-path levels — see the [Background document](../../background.html).

## What we're building

Working backwards from career destinations and upwards from foundational courses — a periodically-refreshed view of where the two meet, where the scaffolding holds, and where the curriculum has drifted. The end state below is genuinely living (changes propagate automatically as courses are re-captured); the current build is closer to a manually-refreshed snapshot grid, with the self-updating machinery scheduled for Phase 2. The framing throughout the document is honest about which version is being described in each section.

> **Q1.** *How well does the GC curriculum build students toward the careers we claim to prepare them for?*

> **Q2.** *For any individual course, do the prerequisites students walk in with actually support what the course expects?*

Today these questions get answered through committee discussions, gut intuition, and the occasional curriculum review. Faculty know parts of the answer for the courses they teach. Nobody has the whole picture, and nobody has a way to update it as courses evolve.

The tool's job is to make evidence-backed draft judgments *visible* and *disputable* — for advising students, for accreditation conversations, for industry/advisory-board reviews, for the next curriculum redesign, and for hiring decisions about what kind of faculty the program needs. Defensibility depends on source coverage, instructor confirmation, and review of flagged cells.

## What we're producing

Beneath the curriculum sits a clear picture of what every GC graduate should be: a **tenacious, fearless problem-solver**, equipped with both program-wide foundational habits and a set of domain-specific cluster competencies. Career destinations are *where* a graduate is heading; this is *what they are* when they get there.

**Foundational competencies** — Agency, Attention to Detail, Resilience, Curiosity, Communication — should show up across every course in the program. They're program-wide threads, not something any single course delivers in isolation.

**Cluster competencies** — Structural Design, Color Management, Print Processes, Graphic Workflow, Brand Strategy — are the domain-specific tracks where deep expertise builds across multiple courses. The coverage matrix and scaffolding analysis read at this level.

The tool maps both layers. Clusters get explicit coverage analysis; foundational competencies show up implicitly inside every reasoned judgment. A course developing Quality Control at Do level may create strong conditions for Attention to Detail, but the disposition should be scored only when assignments or rubrics require accuracy, error-catching, revision, or similar observable behaviors.

## The 3-Act program (proposed)

The framework proposes a three-act organizing structure for the GC program: students learn the field, integrate the field, then apply a focus. The tool would read each course in light of where it sits in this proposed progression. Like every other commitment in this framework, the 3-Act structure is a proposal — a working organizing model offered for faculty deliberation, not an existing institutional policy.

**The design intent.** The structural target of Act 2 would be the empirical "aha" moment students consistently report from GC 4400 and GC 4060 — the mini-capstones where "it all came together" and they first recognized where they could add professional value. The proposal positions this integrative threshold at mid-Junior year so the back half of the program — 1.5+ years — would be available for career-path-specific Act 3 specialization. This would invert the cornerstone-capstone pattern common in engineering education (where integration is reserved for the senior capstone, leaving no time for post-integration specialization). The framework's bet is that students develop better career-path-specific capability when they reach integration earlier and have substantial time afterward to apply it in a focused way — and that the curriculum analysis is most useful when it diagnoses scaffolding against the act-boundary the program is actually trying to hit.

**Grounding.** The proposed 3-Act structure is consistent with established curriculum-design traditions (Bruner's spiral curriculum, the engineering cornerstone-capstone model, the modern medical-education three-phase structure, cognitive apprenticeship) but is not derived from any single one. The scaffolding analysis treats act boundaries as analytical waypoints; if the structure is refined or replaced through faculty deliberation, the scaffolding-diagnosis logic is revised accordingly. The full research synthesis — what the structure is consistent with, what it isn't grounded in, how it engages the strongest critiques (Lave & Wenger on situated learning, Schön on artificial boundaries, prerequisite-transfer findings), and an honest accounting of which design choices are research-supported vs. stipulated — is in the companion document [**The 3-Act Program Structure: A Research Synthesis**](../../three-act-deep-dive.html).

**Act 1 — Foundations & Agency.** *Learn the field.* Design & Typography, Production Art, Brand Strategy, AI as a Toolkit, Business Tools, Narrow Design & Execution.

**Act 2 — Integration & Mastery.** *Integrate the field.* Research & Strategy, Color & Imaging, Packaging & Structural Components, Project Execution, AI & Design Workflow, Idea-thru-Execution (GC 4060 & GC 4400 — the mini-capstones widely regarded by faculty and graduating students as the courses where "it all came together" and they first recognized where they could add professional value). *Complete by mid-Junior year — the timing is set so students cross this integrative threshold while they still have 1.5+ years to develop career-path-specific skills in Act 3.*

**Act 3 — Specialty & Application.** *Apply a focus.* Sales & Customer Facing, Technical & Operations, Brand Operations, Creative Technologist, AI-Driven Workflows, Company-Driven Capstone.

When the tool flags a brittle scaffold, the diagnosis often surfaces *between acts* — an Act-3 course expects mastery of a competency that no Act-1 or Act-2 course actually introduces.

## Why Know / Understand / Do — with depth

The tool classifies every competency at three levels. **Know** is facts and discrete information — terms, conventions, the names of things. **Understand** is the big ideas, principles, and transferable concepts that hold the facts together and explain why they matter. **Do** is skill, process, and applied performance — what a student can actually execute.

This is the **KUD framework**, drawn from Carol Ann Tomlinson's work on differentiated instruction (Tomlinson, 1999/2014; Tomlinson & Imbeau, 2010) and compatible with Wiggins and McTighe's *Understanding by Design* (2005), which centers curriculum planning on durable understanding and transfer rather than coverage.

**Each of K, U, and D is scored on a 0–5 depth scale.** Binary coverage ("covered/not covered") collapses in practice — most courses touch most relevant competencies at some level, and the matrix loses its ability to discriminate between a brief mention and an assessed performance. The depth scales restore that resolution. The anchors at each level describe **what the student does or grasps** rather than what the syllabus claims. All nonzero scores require evidence of delivery or assessment. K=1 can be supported by delivery evidence such as slides, readings, modules, or instructor confirmation; K>1, U>0, and D>0 require evidence of student engagement, reasoning, or performance.

KUD+ scores are *course-opportunity scores* — what the course is designed and evidenced to develop. They become *student-learning claims* only when linked to assessed student work; the [graduate-outcome-validation work](../../graduate-outcome-validation.html) is what bridges that gap. The full scale definitions, the evidence rule, and the theoretical grounding behind the extension are documented in the [Background document](../../background.html).

**Why not Bloom's Taxonomy?** Bloom's six-level cognitive taxonomy (Bloom, 1956; Anderson & Krathwohl, 2001) is the right tool for analyzing the cognitive demand of an *assessment task* — it discriminates finely between types of thinking and is well-suited to writing and evaluating assessments. That is a different job than the one this tool has to do. The GC Curriculum Tool needs a small set of faculty-readable categories that can drive coverage analysis, scaffolding analysis, prerequisite checks, and advising decisions *across an entire program*. For that purpose, three categories with internal depth outperforms six categories without: the question "does this prior course develop the *Understand*-level concept the focal course expects, and at what depth?" is clean and answerable. The finer distinctions Bloom provides — Analyze vs. Evaluate, Apply vs. Create — compound across hundreds of (course × competency × dimension) cells into judgment calls that make faculty review harder, not easier. KUD with depth is better suited to curriculum mapping; Bloom remains the right lens for assessment design and continues to inform the audit-conversation probes used inside each cell.

The framework fits a professional field like Graphic Communications naturally. *Knowing* color theory, *understanding* why it drives brand perception, being able to *color-grade* a project to brand spec are three real, separable things — and exactly the kind of distinction the program needs to track across courses and career destinations. The depth dimension then captures the difference between a course that briefly mentions color theory in a lecture and a course that assesses students on color-managed production files against a rubric.

**Further reading:** the [KUD+ Background document](../../background.html) is the academic companion to this vision; ASCD's *Understanding by Design* white paper at https://files.ascd.org/staticfiles/ascd/pdf/siteASCD/publications/UbD_WhitePaper0312.pdf remains the standard reference for the backward-design tradition the framework builds on.

### References

- Anderson, L. W., & Krathwohl, D. R. (Eds.). (2001). *A Taxonomy for Learning, Teaching, and Assessing: A Revision of Bloom's Taxonomy*. Longman.
- Bloom, B. S. (Ed.). (1956). *Taxonomy of Educational Objectives: The Classification of Educational Goals. Handbook I: Cognitive Domain*. David McKay.
- Tomlinson, C. A. (1999). *The Differentiated Classroom: Responding to the Needs of All Learners*. ASCD. (2nd ed., 2014).
- Tomlinson, C. A., & Imbeau, M. B. (2010). *Leading and Managing a Differentiated Classroom*. ASCD.
- Wiggins, G., & McTighe, J. (2005). *Understanding by Design* (2nd ed.). ASCD.

## The end state

When the full tool is in production, it is the department's shared, versioned working view of the GC program — a maintained evidence surface for curriculum discussion:

- **A career-target framework.** Five (initially) named career destinations — Account Management, Brand Strategy, Production & Operations, Creative Generalist, AI Workflow / Orchestrator — each with sub-competencies described at Know / Understand / Do levels (the "KUD" rubric). These are editable by the faculty leading each track; changes propagate through the rest of the system.

- **A complete course inventory.** Every active GC course has a structured record: description, learning objectives, projects, skills the instructor assumes students walk in with. The record is editable by the course owner and synced from each semester's syllabus.

- **A coverage matrix.** For every course × every career target, the system generates an AI-drafted, evidence-cited coverage judgment from confirmed snapshots; faculty can review, dispute, and override the judgment. [LIVE (faculty trial)]

- **Scaffolding analysis.** [Specified, not built] The planned scaffolding analysis will use confirmed course snapshots to generate evidence-cited scaffold judgments for faculty review — introduced in earlier courses, developed in middle courses, applied in capstones. It will flag the cases that look fine cell-by-cell but fail program-wide: a senior-level course that expects mastery of something never taught before.

- **Prerequisite-gap analysis.** For any course, the tool reports whether the prior coursework students actually take supports what this course expects. Not what the registrar says is required — what the *competencies* require.

- **A flag/dispute trail.** Every AI judgment can be flagged with a faculty note. Flags get reviewed; the prompts and rubrics improve over time; the curriculum's understanding of itself sharpens.

- **A handful of high-leverage views.** A heat map of program-wide coverage. A per-course "is it scaffolded?" view. A per-career-target "is the program preparing students for this destination?" view. An advising view that says "if a student wants to graduate ready for Brand Strategy roles, here is the recommended sequence and the gaps to watch."

## Curriculum flow

Where the heat map shows depth, the flow map shows reach. Each colored ribbon connects a course to a career target it contributes to. Ribbon width is coverage depth (Know / Understand / Do); colors match the five career destinations. The whole curriculum's coverage shape becomes legible at a glance — which targets are well-served, which are thin, and which courses are doing the most lifting. *(See the [HTML version](./gc-curriculum-tool-vision.html#viz-flow) for the full Sankey-style diagram.)*

In an illustrative 15-course slice: Production & Ops is the densest column (11 courses contribute), AI Workflow has only 4. The thinnest ribbon is a curriculum-shape signal — the destination exists in our framework but few courses contribute. That's the kind of finding the curriculum committee can use to decide whether to add a course, retool an existing one, or sharpen the target's definition.

## What this enables

- **Faculty conversations grounded in evidence.** When two faculty disagree about whether a course teaches workflow design at Do level, they have an AI-drafted reading to argue against — and a way to make their disagreement persistent.

- **Curriculum changes with feedback before they ship.** A faculty member redesigning a course can see how their proposed syllabus would change coverage and scaffolding before the redesign goes through Curriculum Committee.

- **Honest career-readiness claims.** "Graduates of this program are ready for X" becomes a verifiable statement, not a marketing assertion.

- **A starting point for accreditation and advisory-board conversations.** Industry partners can see what the program actually delivers; the program can see what industry says is missing.

- **Defense against drift.** Curricula erode over decades. Each captured snapshot is a dated record of what a course developed at a moment in time, and the snapshot system is designed so that cross-snapshot comparison surfaces erosion at the pace of re-captures rather than at the pace of every seven-year program review. The cross-snapshot diff that operationalizes this comparison is Phase 2 work; what the system can do today is hold the snapshots that will, over time, accumulate into the comparison.

## What's live now

The framework's intended day-to-day workflow runs across four surfaces. A fifth — the original M-trial prototype — is still accessible but superseded for new work.

**The current workflow:**

- **`/capture/<code>` — CourseCapture.** [LIVE (faculty trial)] The instructor-facing audit conversation that produces a Course Outcome Profile. For details on what Canvas sources and uploaded materials are ingested, see the ingestion summary in the Background document. Voice input via Whisper. Snapshots are immutable and versioned; the draft remains mutable.
- **`/explore/<code>` — Explore module.** [LIVE (faculty trial)] Alignment analyses (custom target / downstream target) and what-if scenarios run against any saved snapshot. Custom-target authoring; downstream-target auto-detection from captured prereq courses.
- **`/program` — Program Coverage Matrix.** [LIVE (faculty trial)] Confirmed snapshots × career-target sub-competencies, rendered as a depth-aware heat map with a problem-solving lens. On-demand AI scoring per cell; full rationale and evidence excerpt visible in a drawer. The coverage-matrix view from the end state, in a snapshot-grid form — the self-updating machinery and the cross-snapshot diff that would make it a true "living" view are Phase 2 work.
- **`/settings` — Per-function AI model tuning.** [LIVE (faculty trial)] Tier-based selection (Light / Default / Heavy) plus per-function model dropdowns sourced from the OpenAI provider's available models.

**Legacy (still accessible, no new work):**

- **`/preview/<slug>` — M-trial prototype.** The original three-tool slice (Course Builder · Prereq Analyzer · Career Target Alignment) that demonstrated the AI's analysis quality on real GC courses. Superseded by CourseCapture + Explore + Program for new captures; kept accessible because the existing M-trial flags and runs remain useful institutional memory.

The point of the trial period is unchanged: confirm that *the analysis is good enough to be useful*. If faculty find the readings credible, defensible, and worth disputing on the merits, the remaining Phase 1 views (scaffolding, prerequisite gaps, advising) become the next implementation work.

## Operational realities

A research tool that runs on real institutional data sits inside an institutional context, and the Vision should be honest about the parts of that context that determine whether the tool will actually be useful.

**Career-target governance.** The five named destinations — Account Management, Brand Strategy, Production & Operations, Creative Generalist / AI-Native, AI Workflow / Orchestrator — were established through faculty judgment informed by advisory-board conversations and a scan of typical entry-level job postings in the field. They are a working set, not the result of a formal labor-market study; the framework treats them as research input rather than ground truth. Authority to revise the set sits with the faculty leading each track plus the program coordinator; advisory-board feedback over time is expected to refine the descriptors and possibly add or retire targets. When a sub-competency descriptor changes, the existing coverage scores against that target become stale — the system marks them for re-scoring rather than silently invalidating them. Cross-target stability is not guaranteed; it is a working hypothesis that we'll know more about after the first year of use.

**Faculty engagement model.** The coverage matrix is only as complete as the set of confirmed snapshots. CourseCapture sessions are voluntary in the trial period, with department-level coordination by the program coordinator and the curriculum committee chair. The trial is being run with a cohort of faculty who have agreed to capture their courses; if participation across the full 28-course program remains incomplete, the matrix renders the missing courses as unscored rather than imputing values — partial participation produces a partial matrix, not a misleadingly complete one. The plan for low participation is incremental: the tool's usefulness has to be demonstrable on the courses that *are* captured before broader adoption is requested.

**Relationship to the curriculum committee.** The curriculum committee retains all authority over curriculum changes. This tool is designed to inform that body's deliberations — by surfacing patterns, gaps, and conflicts that gut-intuition curriculum review tends to miss — not to replace its judgment or sidestep its process. A proposed curriculum change still goes through the committee; what the tool adds is the ability to bring evidence-grounded readings into the conversation and to model the proposed change's coverage impact before the committee votes.

**When the AI is wrong.** Faculty will sometimes disagree with the AI's reading of their own course. The framework's commitment is that disagreements persist (as flags) rather than vanishing into a button click — and that flagged cells are not silently overwritten in future re-scores. The full dispute-resolution workflow (who reviews flags, how they affect downstream views, how systematic patterns of disagreement update the AI's prompts) is Phase 2 work; in the trial period, flags are reviewed by the project maintainer and surfaced to the curriculum committee as patterns rather than per-cell rulings.

**Snapshot governance.** Each captured snapshot is owned by the faculty member who confirmed it, visible to the program coordinator and the curriculum committee, and retained as part of the program's longitudinal record. A faculty member who wants a snapshot retired can request retirement; retired snapshots are soft-deleted (removed from downstream views) but not purged, so the historical trail remains. Department leadership and individual faculty share ownership of the data; this is a working policy the framework expects to refine.

**Cost.** AI scoring has a quantifiable per-pair cost (roughly $0.04 per snapshot-target cell at current model defaults; ~$5 for a full program-wide refresh against five targets and ~30 courses). Recurring re-scoring at end-of-semester cadence is well within typical departmental software budgets. The tool optimizes for prompt-cache reuse to keep this number low; the function-tier settings page (`/settings`) lets the program tune cost-per-call against analytical depth on a per-function basis.

**Failure modes.** The most consequential failure mode is systematic over-scoring (the coverage matrix shows healthier coverage than the program actually delivers, and the program adopts the misleading reading for accreditation or advising purposes). The framework's mitigations are the evidence rule (all nonzero scores require evidence of delivery or assessment; K>1, U>0, and D>0 require evidence of student engagement or performance), the dispute trail (faculty can flag and contest cells), and the deliberately conservative scoring discipline built into the AI prompts. Even with those, the tool is not infallible; a recurring audit of the most consequential cells against actual student work and graduate-outcome data is the long-term validation path described in the Validation proposal.

### Trial period

Test drive the prototype over **roughly the next two weeks**, focusing on the courses you know best. Pay attention to whether the AI's reasoning matches your lived experience of those courses, and whether the gaps it surfaces match the gaps you already worry about. After the trial settles, the next phase (the program-wide views) starts based on what the feedback surfaces.

### Where to leave feedback

Two channels — both visible to other faculty so feedback compounds instead of sitting in one inbox:

- **In the tool itself.** Every AI judgment has a "Flag this" button with a note field. Best for specific feedback (*"this score is wrong because…"*).
- **On the shared sheet.** Open the [Feedback tab on the shared sheet](https://docs.google.com/spreadsheets/d/12aPhgrIlhDYjKD0-Gt97glf1d9fKtwKmL4FwM8iTz7Q/edit?gid=1820124586#gid=1820124586) — visible to the whole department. Best for cross-cutting questions (*"should we add a career target for X?"*) and anything worth other faculty seeing.

## How we get there

- **M-trial** — ✅ Done. The original faculty-facing analysis prototype at `/preview/<slug>` remains live and exposes three tools (Course Builder, Prereq Analyzer, Career Target Alignment). The shared sheet of standardized course records has since been replaced by a catalog seed (120 courses).
- **CourseCapture v1** — ✅ Done. The per-course audit workflow at `/capture/<code>` produces a confirmed Course Outcome Profile from catalog + Canvas + uploads + voice/chat audit. Snapshots are immutable; drafts remain mutable; multiple snapshots per course supported.
- **Explore module v1** — ✅ Done. Custom-target and downstream-target alignment modes at `/explore`, plus what-if scenarios.
- **Phase 1A — Program Coverage Matrix** — ✅ Done (2026-05-25). The end-state coverage matrix described above is live at `/program`: confirmed snapshots × career-target sub-competencies, heat-map rendering, on-demand AI scoring, cell drawer with evidence and rationale. The other Phase 1 views (scaffolding, prerequisite gaps, advising) are spec'd but not yet implemented.
- **Phase 1B–D** — In progress. Scaffolding analysis, prerequisite-gap analysis, and the advising view. Specs are in [`docs/superpowers/specs/`](https://github.com/chiptoe-svg/gc-curriculum-tool/tree/main/docs/superpowers/specs); implementation order will follow Phase 1A's reception.
- **Phase 2** — Program-wide cross-snapshot diff, rescore-on-edit machinery, conversational agents, accreditation and advisory-board views.
- **Phase 3** — Public/employer-facing views (CareerCapture), alumni/industry feedback integration, and program-level analytics.

Each phase is shippable on its own and is useful to faculty before the next phase arrives.

## What this is *not*

- **Not** a replacement for faculty judgment. The tool drafts; faculty decide. Every AI reading is disputable, and disputes persist.
- **Not** a grading or evaluation tool for individual students or instructors. Coverage scores describe what the *course* delivers, not how well a student or instructor performed.
- **Not** an automated curriculum redesigner. It surfaces what is, makes scaffolding visible, and supports faculty conversations. The redesigning is still humans-in-a-room work.

## The full implementation design

For the technical details — data model, AI prompts, build sequence — see the [v1 implementation design](../specs/2026-05-17-gc-curriculum-tool-v1-design.html).
