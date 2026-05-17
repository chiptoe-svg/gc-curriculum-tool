# GC Curriculum Design Tool — Full Specification
**Clemson University · Department of Graphic Communications**
**Powers College of Business**
*Handoff document for Claude Code — May 2026*

---

## Overview

A web-based curriculum design tool that serves as the living record of the GC department's curriculum — what it currently is, what it is becoming, and how well it builds toward defined career targets. It is simultaneously a working design environment for faculty, an analytical engine that evaluates curriculum coverage, and a presentation-ready artifact for leadership.

The tool is not a reporting tool. It does not produce a one-time analysis. It is a permanent, collaborative environment that remains accurate because faculty own and maintain it.

---

## Core Concepts and Terminology

These terms should appear consistently throughout the UI. They are designed to be immediately understandable to faculty without technical background.

| Term | Meaning | Replaces (technical equivalent) |
|---|---|---|
| **Official Record** | The current accurate description of a course — what it actually is today, marked as accurate on a specific date | Main branch / trunk |
| **Proposal** | A set of proposed changes to a course, submitted for review and evaluation | Branch / pull request |
| **Curriculum Proposal** | A proposal to add a new course or retire an existing one — made at the map level, not the course level | Repository-level change |
| **Snapshot** | The state of the full curriculum map at a specific point in time | Commit / tag |
| **Review** | The process of evaluating a Proposal against coverage scores and curriculum goals before accepting or rejecting it | Merge review |
| **Change Summary** | A plain-language description of what differs between a Proposal and the current Official Record | Diff |
| **Impact View** | How overall coverage scores across the career targets change if a Proposal is accepted | Branch comparison / delta view |
| **Coverage Score** | How well a course builds toward a career target sub-competency, rated at the Know / Understand / Do level | Analysis output |

---

## User Roles

| Role | Who | Can Do |
|---|---|---|
| **Admin** | Chip | Everything — all pages, all proposals, all reviews, curriculum map, career targets, user management |
| **Faculty** | Course owners | Edit their own course pages, create proposals for their own courses, view all pages and the full map |
| **Panel Member** | Industry and faculty panel participants | Edit career target pages, view all course pages and the map, cannot create course proposals |
| **Viewer** | Leadership, guests | Read-only access to all pages and the map in presentation view |

---

## Data Model

### Course

The identity record for a course. Stable fields imported from or matching the registrar. Does not contain content — content lives in the Official Record and Proposals.

```
id
code                    (e.g. GC 3010)
title
credit_hours
level                   (100 / 200 / 300 / 400)
delivery_format         (in-person / hybrid / online)
owner_id                → User
prerequisites           → [Course.id]
official_record_id      → CourseRecord (current accurate version)
created_at
retired                 (boolean — set via Curriculum Proposal)
retired_at
```

### CourseRecord

A full description of a course at a point in time. Every save creates a new record. The Official Record is the one marked `is_official = true`. Proposals contain their own CourseRecord that is not official until the Proposal is accepted.

```
id
course_id               → Course
description             (plain-language summary — what this course actually does)
know_outcomes           [string] — "Students will know that..."
understand_outcomes     [string] — "Students will understand why..."
do_outcomes             [string] — "Students will be able to do... in new contexts"
projects                [Project]
syllabus_text           (raw text — source for AI drafting, not primary analysis input)
is_official             (boolean)
marked_accurate_by      → User
marked_accurate_at      (date)
coverage_scores         [CoverageScore] — AI-generated, stored, versioned
coverage_scored_at
notes                   (internal notes field)
```

### Project

Embedded within CourseRecord. Represents a major assessed deliverable.

```
id
name
description             (what students actually produce)
competency_tags         → [SubCompetency.id] — faculty-selected
```

### Proposal

A proposed change to a single course. Created by the course owner. Sits alongside the Official Record without replacing it until accepted.

```
id
course_id               → Course
title                   (short description of what's being proposed)
proposed_by             → User
created_at
status                  (draft / submitted / under_review / accepted / rejected)
revision_level          (minor / significant / major_rebuild) — assigned at submission
rationale               (why this change is being proposed)
proposed_record         → CourseRecord (is_official = false)
change_summary          (AI-generated plain-language description of what differs)
impact_summary          (AI-generated description of how coverage scores change)
reviewer_notes
reviewed_by             → User
reviewed_at
```

**Revision level definitions (for UI display):**
- **Minor** — small additions, updated examples, new tool references, refreshed project briefs
- **Significant** — restructured learning outcomes, new major project, resequencing of content
- **Major Rebuild** — course is being substantially reconceived; equivalent effort to building a new course

### CurriculumProposal

A proposal to add a new course or retire an existing one. Made and reviewed at the curriculum map level, not on a course page.

```
id
type                    (add / retire)
proposed_by             → User
created_at
status                  (draft / submitted / under_review / accepted / rejected)
course_id               → Course (for retire proposals)
stub_record             → CourseRecord (for add proposals — initial description)
rationale               (what gap this fills or why this course is no longer needed)
expertise_required      (for add — what faculty knowledge this requires)
replaces_course_id      → Course (optional — for retire, what addresses its coverage)
coverage_impact         (AI-generated — how accepting this changes coverage scores)
reviewer_notes
reviewed_by             → User
reviewed_at
```

### CareerTarget

The five defined career destination areas. Co-developed by Chip and the industry/faculty panel. These are the fixed reference frame against which all coverage analysis runs. When a CareerTarget page is revised, coverage analysis reruns across all courses automatically.

```
id
name
short_definition        (one sentence — what this target means in practice)
industry_contexts       [string] — 2-3 examples of where this competency is exercised
know_descriptors        [string] — what practitioners in this area know
understand_descriptors  [string] — what practitioners in this area understand
do_descriptors          [string] — what practitioners in this area can do transferably
sub_competencies        [SubCompetency]
panel_notes             (who contributed, what they validated, when reviewed)
panel_members           [string] — names and affiliations
last_reviewed_at
defensibility_note      (Chip-authored — why graduates are competitive here vs. AI displacement)
```

### SubCompetency

The specific capabilities within a career target. Coverage analysis maps courses against sub-competencies, not just top-level targets.

```
id
career_target_id        → CareerTarget
name
know_descriptor         (what knowing this looks like)
understand_descriptor   (what understanding this looks like)
do_descriptor           (what transferable performance looks like)
display_order
```

### CoverageScore

AI-generated, stored, versioned. One record per course-record × sub-competency pair. Reruns when a CourseRecord or CareerTarget is updated.

```
id
course_record_id        → CourseRecord
sub_competency_id       → SubCompetency
kud_level               (know / understand / do / not_addressed)
confidence              (high / medium / low)
ai_reasoning            (the explanation behind the score — visible on click)
disputed                (boolean — faculty can flag)
dispute_note            (faculty explanation of disagreement)
scored_at
```

### User

```
id
name
email
role                    (admin / faculty / panel_member / viewer)
courses_owned           → [Course.id]
```

---

## Views and Pages

### 1. Course Page

**URL:** `/courses/:id`
**Owner:** Faculty member assigned to the course
**Editable by:** Owner + Admin
**Visible to:** All users

The course page has two modes that are always clearly indicated:

**Official Record mode** — shows the current accurate state. Displays a "last marked accurate" date and the name of who marked it. Faculty can edit and re-mark as accurate; this creates a new CourseRecord and timestamps it.

**Proposal mode** — shows a specific Proposal alongside the Official Record for comparison. A banner identifies which Proposal is being viewed and its current status.

**Page sections:**

*Identity Block (read-only, admin-editable)*
- Course code, title, credit hours, level, delivery format, owner, prerequisites

*Course Description*
- Plain-language summary of what this course actually does
- AI can draft from pasted syllabus text; faculty edit and approve

*Learning Outcomes (KUD format)*
- Three labeled fields: Know / Understand / Do
- Each accepts 3–5 bullet entries
- AI can draft from syllabus; faculty edit and approve
- These are the primary input to coverage analysis

*Key Projects*
- 2–4 project entries
- Each: name, description (what students actually produce), competency tags (selected from SubCompetency list)
- Faculty-selected tags are claims; AI evaluation confirms or disputes

*Syllabus Upload / Paste*
- Stored for reference and AI drafting
- Not the primary analysis input — outcomes and projects are

*Coverage Scores (read-only)*
- Shows AI-generated coverage ratings against each career target and sub-competency
- KUD level displayed per sub-competency with color coding
- Click any cell to see AI reasoning
- Faculty can flag a score as disputed and add a note
- "Rerun Analysis" button (Admin only to prevent gaming)

*Proposals Panel*
- Lists all active Proposals for this course
- Shows status, proposer, revision level, and rationale summary
- "Start a Proposal" button (owner only)
- Clicking a Proposal switches the page to Proposal mode

---

### 2. Career Target Page

**URL:** `/targets/:id`
**Owner:** Chip (Admin)
**Editable by:** Admin + Panel Members
**Visible to:** All users

*Identity Block*
- Target name
- One-sentence definition
- Industry contexts (2–3 examples)
- Defensibility note (Chip-authored)

*Competency Definition (KUD format)*
- Same structure as course outcomes — Know / Understand / Do
- These define what the target means at the program level

*Sub-Competencies*
- List of 3–5 sub-competencies
- Each has its own KUD descriptors
- Reordering available (drag to reorder)
- Adding/removing a sub-competency triggers reanalysis of all courses

*Panel Record*
- Panel member names and affiliations
- Validation notes (what the panel confirmed or revised)
- Last reviewed date

*Courses Mapped Here (read-only)*
- Auto-generated list of all courses with coverage scores against this target
- Sorted by coverage depth (Do → Understand → Know → not addressed)
- Shows both Official Record scores and any active Proposal impact scores
- Surfacing redundancy and gaps without editorializing

---

### 3. Curriculum Map

**URL:** `/map`
**Visible to:** All users
**Editable by:** Admin (for Curriculum Proposals)

The primary visual view. Shows the full curriculum as a navigable diagram.

**Display modes (toggle):**
- **Current** — Official Records only, retired courses excluded
- **Proposed** — Current plus accepted Proposals applied, active Curriculum Proposals shown as pending
- **Comparison** — Current and Proposed side by side

**Visualization options (toggle):**
- **Coverage Map** — courses arranged by career target coverage; color-coded by depth
- **Sequence Map** — courses arranged by level (100→400) with prerequisite connections
- **Sankey View** — courses on left, career targets on right, flow width = coverage depth

**Curriculum Proposal actions (Admin):**
- Drag a course off the map → initiates a Retire Curriculum Proposal
- Click "Add Course" → creates a stub CourseRecord and initiates an Add Curriculum Proposal
- Curriculum Proposals appear as pending overlays on the map until reviewed

**Snapshot controls:**
- "Save Snapshot" — captures the current map state with a label and date
- Snapshots are viewable in the Presentation View

---

### 4. Proposals Review View

**URL:** `/proposals`
**Visible to:** All users
**Actionable by:** Admin (accept / reject), Faculty (view, start new)

- Lists all active Proposals (course-level and curriculum-level) grouped by status
- Each entry shows: course, proposer, revision level, rationale, submission date
- Clicking opens a split view: Official Record on left, Proposal on right, Change Summary below
- Impact View available per Proposal: shows coverage score delta if accepted
- Admin can accept, reject, or request revision with reviewer notes

---

### 5. Resource Summary View

**URL:** `/resources`
**Visible to:** Admin, Viewer
**Generated from:** All accepted Proposals + active Curriculum Proposals

Automatically assembled from proposal data. Not written by hand.

Sections:
- **Courses with accepted revisions** — grouped by revision level (Major Rebuild / Significant / Minor), with rationale notes
- **Proposed new courses** — with gap description, expertise required, and coverage impact
- **Proposed retirements** — with rationale and coverage impact
- **Coverage delta** — overall change in curriculum coverage scores across all career targets if all active proposals are accepted

Export as PDF.

---

### 6. Presentation View

**URL:** `/present`
**Visible to:** All users
**Editable by:** Admin (narrative text blocks)

Clean, read-only view designed for projection or sharing with leadership.

- No editing controls visible
- Narrative text blocks (Admin-authored) frame each section
- Sankey diagram prominent
- Current vs. Proposed coverage comparison
- Snapshot selector — show any saved snapshot
- One-click export as PDF

---

## AI Integration Points

All AI calls use the Claude API (claude-sonnet-4-20250514, max_tokens: 1000 unless specified).

| Where | Trigger | What AI Does | Manning Skill(s) |
|---|---|---|---|
| Course Page | Faculty pastes syllabus, clicks "Draft Outcomes" | Drafts Know / Understand / Do outcomes from syllabus text | D7: Backwards Design · D7: KUD Chart Authoring · D7: Threshold Concept Translation |
| Course Page | Outcomes or projects saved | Runs coverage analysis against all SubCompetencies, stores CoverageScores with KUD level, confidence, and reasoning | D7: Coverage Audit · D7: KUD Chart Authoring · D7: Assessment Validity · D16: Developmental Band Translation · D13: Disciplinary AI Reliability |
| Proposal | Proposal submitted | Generates Change Summary (plain-language diff from Official Record) and Impact Summary (coverage score delta if accepted) | D16: Scope and Sequence · D9: Reflective Practice |
| Curriculum Proposal | Add/Retire submitted | Generates coverage impact statement across all targets | D7: Gap Analysis · D16: Coverage Audit |
| Career Target Page | Target or SubCompetency updated | Triggers reanalysis of all courses against updated target automatically | D7: Competency Unpacking · D13: Learning Boundary Mapping (T4, T5) · D13: Expertise Interrogation (T4, T5) |
| Resource Summary | View loaded | Synthesizes proposal data into plain-language resource narrative | D7: Gap Analysis · D9: Data Interpretation |
| Presentation View | "Generate narrative" clicked | Drafts narrative text blocks for each section; Admin edits and approves | D7: Coverage Audit · D13: Disciplinary AI Reliability |

**Implementation note:** Manning skills are prompt design patterns encoded into system prompts at build time — not runtime API calls or MCP connections. Before building any AI integration point, Claude Code must read the SKILL.md files for each skill listed in that row. The skill files define the reasoning framework; encode their structure into the system prompt rather than copying verbatim.

---



---

## Three-Act Curriculum Structure

The GC curriculum is organized in three acts with distinct purposes, a shared foundational core, and a specialization phase that builds on it. This structure governs both the curriculum architecture and the assessment framework.

**Act One — Foundational**
Primarily 1000-level courses. Students build orientation, vocabulary, tool literacy, and initial exposure across the discipline. Act One is common to all students regardless of intended track. The purpose is to establish the shared foundation that Act Two will build on. Students who skip or underperform in Act One compound that deficit into Act Two — the Foundational Gate exists to catch this early rather than late.

**Act Two — Execution**
Primarily 2000 and 3000-level courses. The common curriculum continues here — students are not yet specializing. The emphasis shifts from knowing to doing: projects become more complex, constraints become more real, and Understand-level outcomes are expected to develop into Do-level capability in the shared competency areas. At the end of Act Two, students formally declare their specialization track. The Execution Gate confirms they are ready to do so.

**Act Three — Specialization**
The final third of the program. Students are in their declared track, building Do-level competency in their chosen career target area. Courses are track-specific or track-relevant. The program ends with the Exit Gate — a capstone performance assessment plus targeted knowledge confirmation. This is the summative evidence of program outcomes.

---

## Assessment Framework

### Philosophy

The assessment system is built on three principles. First, measure at the right grain — Know and Understand are measured by test, Do is measured by performance. Second, measure at the right time — gates exist to inform decisions while there is still time to act, not to document outcomes after the fact. Third, close the loop — measurement that doesn't change anything is not assessment, it's reporting. Every gate produces data that feeds back into curriculum decisions through the Proposals system.

The framework is designed to satisfy external accreditation standards (SACSCOC, ACEJMC) without being designed for them. Build it right for internal purposes and it serves external review automatically.

---

### Three Gates

#### Gate 1 — Foundational Gate

**Timing:** End of Act One (end of 1000-level coursework)
**Instrument:** Common Foundation Knowledge Check
**Stakes:** Diagnostic — not punitive. No student is dismissed for failing to clear this gate. The output is an advising record and a directed course of action.

**What it measures:**
- Know-level competency across the common foundation: print production basics, design fundamentals, digital workflow literacy, industry terminology, brand vocabulary
- Early signal on which career target areas show natural strength or interest
- Whether the student has the base required to succeed in Act Two work

**How it works:**
A structured knowledge assessment — test format — administered at the end of the final 1000-level course or as a standalone assessment event. Items are tied directly to the common foundation sub-competencies defined on the Career Target pages. Results are reviewed by the student's advisor in a structured conversation. Students who are thin in specific areas receive a directed recommendation before Act Two begins.

**What goes in the tool:**
Gate 1 results are recorded as an advising note tied to the student record (which lives in the student information system, not the curriculum tool). The curriculum tool receives aggregate data: what percentage of the cohort cleared each sub-competency threshold. That aggregate feeds the Tier 1 curriculum metric — if 60% of a cohort fails to demonstrate Know-level on a specific sub-competency, that is a curriculum problem, not a student problem.

---

#### Gate 2 — Execution Gate

**Timing:** End of Act Two (end of common curriculum, entry to Act Three)
**Instrument:** Common Foundation Test (full version) + Track Declaration
**Stakes:** Consequential — this gate governs specialization entry. Students who do not clear it do not enter their intended track without a documented advising plan.

**What it measures:**
- Know and Understand level across the full common foundation (same instrument as Gate 1, expanded — enables growth measurement)
- Understand-level competency in the student's intended specialization track
- Readiness for Do-level work in Act Three

**How it works:**
Two components. First, a test — the same common foundation instrument from Gate 1, with additional track-relevant items for the declared specialization. This gives a clean before/after comparison from Gate 1 and confirms the student has developed beyond foundational knowledge into genuine understanding. Second, a structured Track Declaration — a short evidence-based statement in which the student identifies their intended career target, references specific work from Act Two that demonstrates readiness, and articulates what Act Three needs to build. This is not a personal statement. It is an evidence-based document assessed against a rubric.

The combination of test score and Track Declaration reviewed by advisor and department chair creates the documented entry point into Act Three. Students who are thin in track-relevant areas have a clear, evidence-grounded advising conversation before they commit to a specialization.

**What goes in the tool:**
Aggregate Gate 2 data flows into the curriculum tool as Tier 1 metrics. Growth from Gate 1 to Gate 2 on the common foundation items is the primary curriculum effectiveness signal for Act One and Act Two. If students are not growing on specific sub-competencies between Gate 1 and Gate 2, the courses responsible for building those sub-competencies are candidates for a Proposal.

---

#### Gate 3 — Exit Gate

**Timing:** End of Act Three (program exit)
**Instrument:** Capstone Performance Assessment + Track-Specific Knowledge Confirmation
**Stakes:** Summative — this is the program outcome record. Results are documented, attributed to the student's declared track, and contribute to program-level reporting.

**What it measures:**
- Do-level competency in the declared career target track — assessed by performance, not test
- Know and Understand level on track-specific knowledge — assessed by test
- Common foundation growth — the same foundation items from Gates 1 and 2, enabling a full three-point growth curve

**How it works:**
Two components. First, a Capstone Performance Assessment — a structured deliverable produced during the senior year that demonstrates Do-level execution in the student's declared track. This is not a course grade. It is a program-level assessment event, scored against career target performance standards by a rubric, with at least one industry reviewer scoring alongside the faculty reviewer. Inter-rater reliability is documented. Second, a targeted knowledge test — track-specific items plus the common foundation component. This confirms the knowledge base and completes the growth measurement across all three gates.

**Capstone by track:**
Each track has a defined capstone deliverable that requires Do-level execution. Examples: Account Management — a documented client project cycle from brief through delivery with revision evidence; Brand Strategy — a research-grounded brand positioning recommendation with measurement framework; Production & Operations — a production workflow design for a complex multi-vendor project; Creative Generalist — a brand brief executed across three media using AI-assisted workflow with documented creative direction decisions; AI Workflow — a documented and tested AI-augmented workflow for a specific creative or production context.

These deliverable definitions live on the Career Target pages in the tool as Performance Standards — the specific criteria against which the capstone is scored.

**What goes in the tool:**
Aggregate Gate 3 data — percentage of cohort reaching Do level by track, growth curve across all three gates on common foundation items, inter-rater reliability scores — flows into the curriculum tool as Tier 2 metrics. Track-specific Do-level achievement rates feed directly back into coverage analysis: if 40% of Account Management track students are not reaching Do level on a specific sub-competency at exit, the courses responsible for that sub-competency are flagged for review.

---

### Assessment Instruments Summary

| Instrument | Gates | Format | Assessed Against |
|---|---|---|---|
| Common Foundation Knowledge Check | Gate 1 | Test | Common foundation sub-competencies |
| Common Foundation Test (full) | Gates 2 + 3 | Test | Common foundation + track-specific sub-competencies |
| Track Declaration | Gate 2 | Structured document + rubric | Readiness criteria per track |
| Capstone Performance Assessment | Gate 3 | Portfolio artifact + rubric | Career target performance standards |

**Growth measurement:** The common foundation test component runs at all three gates. The delta from Gate 1 to Gate 2 measures Act One and Two effectiveness. The delta from Gate 2 to Gate 3 measures Act Three effectiveness. The full Gate 1 to Gate 3 delta is the program-level growth claim — the most powerful evidence of curriculum effectiveness.

---

### Metrics by Tier

#### Tier 1 — Curriculum-Level Metrics

Aggregate student performance data feeds back into curriculum evaluation. These metrics are the tool's primary feedback mechanism — they turn student outcomes into curriculum decisions.

| Metric | Source | Threshold for concern | Action |
|---|---|---|---|
| % cohort clearing sub-competency at Gate 1 | Gate 1 test results | Below 70% | Flag responsible 1000-level course for review |
| % cohort clearing sub-competency at Gate 2 | Gate 2 test results | Below 75% | Flag responsible Act Two course for Proposal |
| Gate 1 → Gate 2 growth on common foundation | Comparative test scores | Less than 15 percentile points | Flag Act One or Two course sequence for review |
| % capstone assessors agreeing on Do-level rating | Gate 3 inter-rater data | Below 80% | Flag performance standard definition for revision |
| % cohort reaching Do level by track at exit | Gate 3 capstone results | Below 65% | Flag track curriculum for Proposal |

#### Tier 2 — Program-Level Metrics

Reported annually to department leadership and maintained as the official program outcomes record.

| Metric | Source | Reported |
|---|---|---|
| Gate 1 → Gate 2 → Gate 3 growth curve by cohort | Aggregate test scores | Annually |
| % graduating students reaching Do level in declared track | Gate 3 capstone results | Annually |
| % graduating students reaching Know level in common foundation | Gate 3 test results | Annually |
| Track declaration distribution (how many students per track) | Gate 2 records | Annually |
| Assessment loop closure (how many curriculum changes resulted from assessment data) | Proposal records in tool | Annually |

#### Tier 3 — Outcomes Metrics

Placement data tied to the five career targets. Uses existing placement tracking infrastructure — no new data collection required beyond classifying placement by career target.

| Metric | Source | Reported |
|---|---|---|
| % graduates placed in role matching declared track | Existing placement records + career target classification | Annually |
| % graduates placed in any of the five career target areas | Placement records | Annually |
| Time to placement | Existing placement records | Annually |

**Career target classification guide for placement records:** Each job placement is classified to a career target by the department's career services staff using a defined decision tree. Job title and employer type are the primary classifiers. A placement does not need to match the student's declared track to count — landing in any of the five targets is a program success. Mismatches between declared track and actual placement are tracked separately as advising signal.

---

### Assessment Loop Closure

The assessment framework only functions if data changes the curriculum. The loop is closed through the existing Proposals system in the tool:

1. Gate data is reviewed by the curriculum committee at the end of each academic year
2. Sub-competencies below threshold trigger a formal review of the responsible courses
3. Review produces one of three outcomes: continue as is (documented), flag for Proposal, or initiate a Proposal immediately
4. Proposals that originate from assessment data are tagged as assessment-driven in the rationale field
5. The following year's gate data evaluates whether the Proposal addressed the gap

This annual cycle — measure, review, propose, implement, measure again — is the documented evidence that the assessment system is functioning. That documentation, stored in the tool, is what satisfies external review requirements.

---

### Data Model Additions

The following objects and fields are added to the data model to support the assessment framework.

#### PerformanceStandard

Embedded within SubCompetency on each Career Target page. Defines what Do-level actually looks like as a concrete artifact or demonstration — the standard against which the capstone is scored.

```
id
sub_competency_id        → SubCompetency
description              (what a Do-level artifact or demonstration looks like)
evidence_criteria        [string] — specific observable criteria (3–5 bullets)
capstone_prompt          (the specific deliverable prompt for this track's capstone)
rubric_items             [RubricItem] — scored criteria for inter-rater assessment
last_reviewed_at
reviewed_by              [string] — panel members who validated this standard
```

#### RubricItem

Embedded within PerformanceStandard. Each item is scored independently by each reviewer.

```
id
performance_standard_id  → PerformanceStandard
criterion                (what is being assessed)
do_descriptor            (what Do-level performance looks like on this criterion)
understand_descriptor    (what Understand-level looks like)
know_descriptor          (what Know-level looks like)
weight                   (relative importance — percentages summing to 100)
```

#### AssessmentGate

Definition of each gate — what it measures, when it runs, what threshold constitutes clearing it.

```
id
name                     (Foundational / Execution / Exit)
act                      (1 / 2 / 3)
instrument_type          (knowledge_check / test_and_declaration / capstone_and_test)
common_foundation_items  [SubCompetency.id] — which sub-competencies the common test covers
track_specific_items     [SubCompetency.id] — track-specific test items (Gate 2 and 3)
clearing_threshold       (minimum score to clear — stored as percentage)
notes
```

#### CohortGateResult

Aggregate gate results per cohort per gate — stored in the tool for curriculum feedback. Individual student results live in the student information system.

```
id
gate_id                  → AssessmentGate
cohort_year
track_id                 → CareerTarget (null for Gates 1 and 2 common component)
n_students               (cohort size)
pct_cleared              (percentage who cleared the gate)
sub_competency_results   [SubCompetencyResult] — per sub-competency breakdown
prior_gate_result_id     → CohortGateResult (for growth calculation)
growth_delta             (percentile point change from prior gate)
notes
reviewed_at
curriculum_action        (continue / flagged_for_review / proposal_initiated)
```

#### SubCompetencyResult

Embedded within CohortGateResult. Per-sub-competency breakdown of cohort performance.

```
sub_competency_id        → SubCompetency
pct_at_do               
pct_at_understand        
pct_at_know              
pct_not_demonstrated     
below_threshold          (boolean — triggers curriculum review flag)
```

#### PlacementRecord

Placement data by career target — Tier 3 metric. Populated from existing placement tracking.

```
id
graduation_year
declared_track_id        → CareerTarget
placement_target_id      → CareerTarget (null if outside the five targets)
job_title
employer_type
days_to_placement
track_match              (boolean — declared track matches placement target)
notes
```

#### RubricAlignment

Added to Project (embedded in CourseRecord). Maps a course project to the career target sub-competency it assesses, and at what KUD level it is assessed in that course.

```
sub_competency_id        → SubCompetency
assessed_kud_level       (know / understand / do)
rubric_criteria          [string] — how this project is graded against this sub-competency
```

---

### Tool Views Added

**Assessment Analytics View** (`/assessment`)
Admin only. Displays cohort gate results across years, growth curves by cohort, sub-competency breakdown below threshold flagged in red, and assessment loop closure record (what curriculum changes resulted from assessment data). The primary internal accountability dashboard.

**Placement Dashboard** (`/placement`)
Admin only. Tier 3 metrics — placement by career target, track match rate, time to placement trends by year. Populated from PlacementRecord data entered by career services staff.

**Performance Standards** (embedded in Career Target page)
New section on each Career Target page below Sub-Competencies. Panel-editable. Contains the PerformanceStandard definition, RubricItems, and the capstone prompt for that track. This is the document faculty and industry reviewers use to score the Gate 3 capstone assessment.

---

### Implementation Sequence for Assessment Framework

Assessment framework components should be built after the core tool is functional — they depend on having real career target definitions and coverage data in the system. Recommended sequence:

1. **Performance Standards** on Career Target pages (Build 2 extension) — panel develops these alongside sub-competency definitions. Must exist before capstone rubrics can be built.
2. **RubricAlignment** on course project entries (Build 3 extension) — faculty add rubric alignment when populating course pages. Enriches coverage score claims with faculty assessment evidence.
3. **AssessmentGate** definitions (standalone build, post Build 4) — define the three gates once the career target sub-competencies are stable enough to anchor test items.
4. **CohortGateResult** data entry and Analytics View (post first gate administration) — the tool receives aggregate data after the first cohort goes through a gate. Individual student data stays in the student information system.
5. **PlacementRecord** and Placement Dashboard (post first graduating cohort) — Tier 3 data entry begins with the first cohort to graduate after the revised curriculum launches.

---

## Curriculum Visualization

A live interactive visualization is embedded in the HTML version of this spec document and built as a standalone React artifact (`gc-curriculum-viz.jsx`). It renders real GC course data against the five career targets and serves two purposes: a working reference for understanding the current curriculum state, and a demonstration for Claude Code of what the tool's visual layer needs to produce.

**Four views are implemented:**

**Curriculum Flow (Sankey)** — Courses on the left, career targets on the right. Bezier curves connect them; flow width is proportional to coverage depth (Do = widest, Know = narrowest). Courses without spreadsheet data appear faded. Hover any course or target to highlight its connections and dim everything else. The most powerful view for leadership presentations — it makes the logic of the curriculum visible without explanation.

**Coverage Map (Heat Map)** — A course × career target grid. Each cell is color-coded by KUD level: Do (dark green), Understand (olive green), Know (amber), Not addressed (black), No data (darker black with dash). A left-edge stripe color-codes by course level (100→400). Hover rows or columns to isolate. The most analytically useful view for identifying specific gaps.

**Sequence Map (Prerequisite Network)** — Courses arranged in four vertical columns by level (100→400), connected by prerequisite arrows. Node border color represents the course's primary career target. Hover to trace prerequisite chains forward and backward. Reveals sequencing problems invisible in flat lists.

**Gap Analysis** — A structured panel showing per-target coverage scores, percentage ratings, Do-level courses listed explicitly, and red-flag alerts for targets with thin or zero coverage. Also surfaces the missing data warning for courses without learning objectives in the spreadsheet.

**Preliminary KUD assessment** (based on reading learning objectives and projects from `GC_Core_Curriculum.xlsx`):

| Course | Code | Level | Account Mgmt | Brand Strategy | Prod & Ops | Creative Gen | AI Workflow |
|---|---|---|---|---|---|---|---|
| Orientation to Graphic Comm | GC 1010 | 1 | Know | — | Know | — | — |
| Intro to Digital Graphics | GC 1020 | 1 | — | Know | Know | Understand | — |
| Applications of Digital Graphics | GC 1050 | 1 | — | Know | Understand | Understand | Know |
| Screen Printing & Flexography | GC 1040 | 1 | — | — | **Do** | Know | — |
| Graphic Communications II | GC 2070 | 2 | — | — | — | — | — |
| Web Development | GC 2400 | 2 | Know | — | — | Understand | Know |
| Digital Imaging | GC 3400 | 3 | — | — | Know | **Do** | — |
| Ink and Substrates | GC 3460 | 3 | — | — | **Do** | — | — |
| Brand Comm Course | GC 3700 | 3 | — | — | — | — | — |
| Brand Creation & Comm | GC 3710 | 3 | — | — | — | — | — |
| Digital Content & CMS | GC 3720 | 3 | Understand | **Do** | — | Understand | — |
| Brand Comm Elective | GC 3780 | 3 | — | — | — | — | — |
| Junior Seminar | GC 3800 | 3 | Understand | — | — | — | — |
| Package & Specialty Printing | GC 4060 | 4 | Know | — | **Do** | Know | — |
| Advanced Flexography | GC 4070 | 4 | — | — | **Do** | — | Understand |
| Commercial Printing | GC 4400 | 4 | Understand | Understand | **Do** | Understand | Know |
| Course (no data) | GC 4440 | 4 | — | — | — | — | — |
| Course (no data) | GC 4480 | 4 | — | — | — | — | — |
| Senior Seminar | GC 4800 | 4 | Understand | — | Know | — | — |

**Note:** GC 2070, 3700, 3710, 3780, 4440, and 4480 have no learning objectives or projects in the spreadsheet — their coverage is unknown and marked as no data. The three Brand Comm courses (3700, 3710, 3780) in particular likely carry meaningful Brand Strategy and Creative Generalist coverage that is not reflected above.

**What the preliminary data reveals:**

Production & Operations is the most covered target by a wide margin — five courses (GC 1040, 3460, 4060, 4070, 4400) reach Do level. This confirms the curriculum was built around production expertise.

Brand Strategy has one Do-level course (GC 3720) and thin coverage elsewhere. The missing Brand Comm course data may improve this picture significantly.

Account Management reaches Understand level in a few courses but has no Do-level course — students are not building transferable account management skills.

Creative Generalist has one Do-level course (GC 3400, Digital Imaging) which builds photography and video skills. The broader generalist creative identity is present at Know/Understand level across several courses but not synthesized into Do-level transferable capability.

AI Workflow / Orchestrator has essentially zero coverage. GC 4070 touches Understand level through its workflow automation and prepress automation content. No course builds Do-level AI workflow capability. This is the most significant gap and the clearest argument for new curriculum development.

**Implementation note for Claude Code:** The visualization is built in pure React with SVG — no D3 dependency. The Sankey curves are calculated manually as cubic bezier paths. Coverage data is stored as a simple matrix (courseId → [t1, t2, t3, t4, t5] KUD levels). The component is self-contained and the data structure can be directly replaced with live data from the tool's API once the backend is built. See `gc-curriculum-viz.jsx` for the full reference implementation.

---

## Manning Skills Integration

The tool's AI analysis layer is built on Gareth Manning's Education Agent Skills Library — an open-source library of 131 evidence-based pedagogical skills for curriculum design and assessment. Four domains from the library are integrated across the tool's AI integration points.

**Repository:** `github.com/GarethManning/education-agent-skills`

**Implementation rule for Claude Code:** Manning skills are prompt design patterns encoded into system prompts at build time — not runtime API calls or MCP connections. Before building any AI integration point, read the SKILL.md file for each skill listed in that section. Encode the skill's reasoning framework into the stored system prompt. Where two skills are listed for the same integration point, chain them: the output of the first becomes context for the second.

---

### Domain 7 — Curriculum Design & Assessment
*8 skills used of 15*

| Skill | Used In | How |
|---|---|---|
| **Coverage Audit** | AI Analysis, Resource Summary | Primary engine for coverage scoring — maps course outcomes and projects against career target sub-competencies. Also drives gap narrative in Resource Summary. |
| **KUD Chart Authoring** | Course Page, Career Target, AI Analysis | Structures the Know / Understand / Do fields on Course Pages and Career Target pages. Defines the scoring rubric the AI uses when assigning KUD levels to coverage scores. |
| **Competency Unpacking** | Career Target | Used when AI helps panel members draft sub-competency definitions — breaks a high-level target into specific, assessable sub-competencies with distinct KUD descriptors. |
| **Backwards Design** | Course Page | Applied when AI drafts learning outcomes from a syllabus — works backward from career target KUD descriptors rather than extracting what the syllabus says it covers. |
| **Gap Analysis** | Resource Summary, Curriculum Map | Powers gap narrative in Resource Summary. Fed with coverage score delta between current and proposed states — synthesizes which career target areas remain underbuilt after proposed changes. |
| **Learning Progressions** | Sequence Map | Informs Sequence Map view logic — how competencies should develop from 100→400 level courses. Used when evaluating whether a proposed architecture builds depth progressively. |
| **Threshold Concept Translation** | Course Page | Used in AI drafting of course descriptions — identifies the conceptual core of each course rather than defaulting to topic lists. |
| **Assessment Validity** | Course Page, AI Analysis | Referenced when evaluating whether faculty-selected competency tags on projects hold up against the project description — a tag is a claim the AI evaluates. |

---

### Domain 16 — Curriculum Alignment
*4 skills used of 4*

| Skill | Used In | How |
|---|---|---|
| **Coverage Audit** | AI Analysis | Cross-listed with Domain 7. In Domain 16 context, oriented toward program-level alignment — whether the full curriculum builds coherently toward each target across all courses, not just individual course coverage. |
| **KUD Chart Authoring** | Course Page, Career Target | Cross-listed with Domain 7. In Domain 16 context, ensures consistent KUD vocabulary across Course Pages and Career Target pages so that outcomes map meaningfully to descriptors. |
| **Scope and Sequence** | Sequence Map, Proposals | Informs Sequence Map visualization and Impact Summary on Proposals — evaluates whether a proposed change disrupts the sequence for courses that depend on its outcomes. |
| **Developmental Band Translation** | AI Analysis, Sequence Map | Evaluates whether coverage at 100-level vs. 400-level courses reflects appropriate depth progression. Identifies curricula where senior courses produce the same KUD level as freshman courses. |

---

### Domain 13 — AI Literacy
*5 skills used of 7*

| Skill | Used In | How |
|---|---|---|
| **Learning Boundary Mapping** | Career Target (T4, T5) | Required for Creative Generalist and AI Workflow career target pages. Defines where AI reliability breaks down in creative and production contexts — the intellectual core of the `defensibility_note` field on both emerging targets. Panel members should work through this skill's framework when developing sub-competencies. |
| **Disciplinary AI Reliability** | Career Target, AI Analysis | Evaluates where AI is trustworthy vs. unreliable within graphic communications, brand, and print production domains. Used when assigning coverage scores — the AI should be appropriately skeptical about its own confidence when evaluating competencies requiring contextual human judgment. |
| **AI Output Auditing** | Course Page, AI Analysis | Framework behind the faculty dispute mechanism on coverage scores. The dispute note field prompts faculty to articulate which specific aspect of the AI's reasoning is incorrect — not just express disagreement. |
| **Expertise Interrogation** | Career Target (T4, T5) | Used in the panel development process for Creative Generalist and AI Workflow targets — both lacking SOC anchors and requiring expert definition. Surfaces what genuine expert practice actually looks like vs. what practitioners say they do. |
| **Prompt Literacy** | Career Target (T5) | Directly relevant as a sub-competency in the AI Workflow / Orchestrator target. Manning's definition of prompt literacy informs the Know-level descriptor for that sub-competency. |

---

### Domain 9 — Professional Learning & Teacher Development
*2 skills used of 12*

| Skill | Used In | How |
|---|---|---|
| **Data Interpretation** | Course Page, Resource Summary | Framework for how coverage scores are surfaced for faculty — as data points to interpret, not judgments to accept or reject. The language in Coverage Score display and gap narratives should present findings descriptively, with faculty positioned as the interpreter. |
| **Reflective Practice** | Proposals | Informs the rationale field in Proposals. The AI prompt guiding faculty when writing a proposal rationale should follow this skill's framework — connecting the proposed change to a specific observed gap, not just describing what will change. |

---



| Layer | Choice | Reason |
|---|---|---|
| Frontend | React + Tailwind CSS | Component-based, handles complex state across views |
| Storage | Claude artifact persistent storage API (Phase I); expandable to external DB for multi-user | Sufficient for Phase I volume; no infrastructure overhead |
| AI | Anthropic Claude API (claude-sonnet-4-20250514) | Primary analysis and drafting engine |
| Analysis prompt layer | Manning Skills Library (github.com/GarethManning/education-agent-skills) — Domains 7, 16, 13, 9 | Skills encoded into system prompts at build time. Read SKILL.md files before building any AI integration point. |
| Export | React-to-PDF / print CSS | Coverage summary and presentation view |
| Visualization | Recharts (heat map, bar charts) + D3 (Sankey, network graph) | Both available in React artifact environment |

---

## Build Sequence

Each build is independently usable before the next begins. Do not start a build until the previous one has been tested with real data.

### Build 1 — Foundation (Week 1)
- User roles and authentication shell
- Course identity records (CRUD)
- Career target pages (CRUD)
- SubCompetency management within career targets
- Basic navigation between pages
- Persistent storage setup

**Gate:** Chip can create all five career targets with sub-competencies and enter 5–10 courses.

### Build 2 — Course Content (Week 1–2)
- Course description field
- KUD outcome fields (Know / Understand / Do) with AI drafting from syllabus
- Project entries with competency tagging
- Syllabus upload/paste storage
- "Mark as accurate" action with timestamp

**Gate:** Three complete course pages marked as accurate, with outcomes and projects filled in.

### Build 3 — Coverage Analysis (Week 2–3)
- AI coverage analysis on save
- CoverageScore storage and display on course page
- Heat map view (course × sub-competency matrix)
- AI reasoning visible on cell click
- Faculty dispute flag and note

**Before building the analysis prompt:** Read Manning Domain 7 (Coverage Audit, KUD Chart Authoring, Assessment Validity), Domain 16 (Developmental Band Translation), and Domain 13 (Disciplinary AI Reliability) SKILL.md files. Encode their frameworks into the system prompt — do not use generic curriculum analysis prompting.

**Gate:** Coverage scores running accurately against at least two career targets with five courses.

### Build 4 — Proposal System (Week 3–4)
- "Start a Proposal" on course page
- Proposal editor (mirrors course page fields)
- AI-generated Change Summary and Impact Summary
- Proposals panel on course page
- Proposals Review view (Admin)
- Accept / reject with reviewer notes

**Gate:** At least one full proposal cycle completed — created, reviewed, accepted.

### Build 5 — Curriculum Map (Week 4–5)
- Basic curriculum map (Coverage Map view)
- Course cards with status indicators
- Career target grouping
- Add course / Retire course Curriculum Proposals
- Snapshot save and restore

**Gate:** Full department curriculum visible on map with coverage color coding.

### Build 6 — Sankey + Sequence Map (Week 5–6)
- Sankey diagram (courses → career targets)
- Sequence map (prerequisite network)
- Toggle between visualization types
- Current / Proposed / Comparison display modes

**Gate:** Sankey renders cleanly enough for a leadership presentation.

### Build 7 — Resource Summary + Presentation View (Week 6–7)
- Resource Summary view auto-generated from proposals
- PDF export of Resource Summary
- Presentation View (clean, read-only)
- Narrative text blocks (Admin-editable)
- Snapshot selector in Presentation View
- PDF export of Presentation View

**Gate:** A complete presentation can be assembled and exported without leaving the tool.

---

## Key Design Principles

**Faculty authorship, not faculty reaction.** Faculty populate their own course pages. They are not responding to an administrator's analysis of their courses. The tool's political value depends on this.

**The map is always live.** Coverage scores update when course pages are saved and when career targets are revised. The map never shows stale data.

**Proposals sit alongside, never on top of.** An Official Record is never modified by a Proposal until the Proposal is explicitly accepted. Faculty can see exactly what would change before anything changes.

**AI reasons out loud.** Every coverage score has visible reasoning. Faculty can dispute any score. The tool does not present AI output as authoritative fact.

**The resource document writes itself.** The Resource Summary is assembled from proposal data, not authored separately. If the proposals are accurate, the resource request is accurate.

**Leadership sees work, not reports.** The Presentation View shows the actual curriculum tool in a clean skin. Leadership is seeing what faculty built, not a slide deck summarizing what someone else found.

---

*This document is the handoff specification. The HTML version of this plan, with interactive navigation, is the working reference during development.*

---

## Career Target Framework — Preliminary Definitions

Five target areas define where GC graduates are being prepared to land. These definitions seed the Career Target pages in the tool and should be refined by the industry/faculty panel before being used as analysis reference frames. Each entry notes the closest O*NET SOC anchor, where one exists.

The five targets share a substantial common foundation — critical thinking, written and oral communication, systems analysis, and digital tool fluency appear across all of them. The curriculum should reflect this: shared foundation courses serving all five tracks, with a narrow differentiating layer per track.

---

### 1. Account Management

**Definition:** The consultative client-facing role that bridges a brand's marketing intent and the production or creative execution required to realize it. Account managers are credible in both directions — they can have a substantive conversation with a brand director and then turn and translate that conversation accurately for a production team or creative partner.

**Why it's defensible:** Trust, relationship continuity, and organizational navigation are not automatable. Understanding what a client actually needs (as opposed to what they asked for) requires human judgment and accumulated context that AI cannot replicate.

**GC-specific angle:** GC graduates bring domain knowledge of print, packaging, and brand production that most account management programs don't develop. That knowledge is the differentiator — it allows graduates to serve as genuine partners rather than order-takers.

**SOC anchor:** 41-4012.00 — Sales Representatives, Wholesale and Manufacturing, Except Technical and Scientific Products (Bright Outlook). Note: avoid mapping to Advertising Sales Agents (41-3011), which is in slight decline and represents a transactional rather than consultative model.

**Core competency areas:**
- Client needs diagnosis and relationship management
- Proposal development and consultative communication
- Project oversight and timeline management across creative and production workflows
- Results interpretation and reporting to clients
- Domain literacy in print, packaging, and brand production (the GC differentiator)

**Key KUD distinctions:**
- Know: how print and packaging production processes work; what brand standards govern visual consistency; how agency and client organizations are structured
- Understand: why client relationships require ongoing trust investment; why production constraints shape creative possibility; why the account manager's credibility depends on domain knowledge
- Do: manage a client relationship through a full project cycle; translate a brand brief into a production specification; present results in terms that matter to the client

---

### 2. Brand Strategy

**Definition:** The analytical and strategic layer of marketing — understanding consumers, competitors, and market conditions well enough to define where a brand should position itself and how. Brand strategists don't just describe what consumers do; they interpret why and recommend what the brand should do about it.

**Why it's defensible:** AI can process consumer data but cannot make judgment calls about brand voice, cultural resonance, or when a data signal is meaningful versus misleading. Brand strategy requires weighing ambiguous information against business context — which requires human judgment.

**GC-specific angle:** Most brand strategy programs are digital-native and don't develop fluency in how brands translate across print, packaging, and physical touchpoints. GC graduates who understand brand consistency across a full channel mix — not just digital — have a differentiated perspective.

**SOC anchor:** 13-1161.00 — Market Research Analysts and Marketing Specialists (Bright Outlook, much faster than average growth, 87,200 projected openings 2024–2034, $76,950 median wage). Note: 39% of positions require a master's degree — the career target page should define what a strong bachelor's-level entry into this track looks like and what graduate education extends it.

**Core competency areas:**
- Consumer research and insight synthesis
- Competitive and market analysis
- Brand positioning and messaging strategy
- Campaign planning and effectiveness measurement
- Quantitative literacy (data interpretation, statistical thinking)
- Cross-channel brand translation including print and packaging

**Key KUD distinctions:**
- Know: research methodologies (qualitative and quantitative); brand architecture frameworks; competitive analysis tools; statistical concepts
- Understand: why consumer behavior is contextual and not fully predictable; why brand positioning requires trade-offs; why measurement frameworks must align with business objectives
- Do: design and execute a consumer research study; synthesize findings into a strategic recommendation; evaluate campaign performance against defined objectives

---

### 3. Production & Operations

**Definition:** The role that makes creative and brand work actually happen — on time, on spec, and within budget. Production managers design and oversee the workflows, quality systems, vendor relationships, and team coordination that translate a creative brief into a finished physical or digital product.

**Why it's defensible:** Production management requires real-time judgment in complex systems with human teams, physical constraints, and unexpected failures. AI can optimize known workflows, but it cannot manage a vendor relationship under pressure, make a quality judgment on a print proof, or navigate the human dynamics of a production floor.

**GC-specific angle:** GC graduates understand print and packaging production from the inside — the substrate knowledge, color management, press specifications, and finishing considerations that most business graduates lack. That domain depth is what separates a production manager who can lead from one who is dependent on their team to tell them what's possible.

**SOC anchor:** 11-3051.00 — Industrial Production Managers. No Bright Outlook designation, but a stable role with meaningful employment volume. The curriculum should develop the management science layer (quality systems, workflow design, resource management) alongside the domain knowledge layer (print, packaging, materials).

**Core competency areas:**
- Production workflow design and optimization
- Quality control systems and standards enforcement
- Vendor selection, management, and relationship maintenance
- Timeline management under constraint and pressure
- Cost estimation and budget management
- Team coordination and performance management
- Domain knowledge: print production, color management, packaging specifications, materials

**Key KUD distinctions:**
- Know: print and packaging production processes; quality standards and measurement tools; vendor capabilities and limitations; cost structures
- Understand: why quality failures happen and how to design systems that catch them earlier; why timeline management is a people problem as much as a scheduling problem; why vendor relationships require investment
- Do: design a production workflow for a complex multi-component brand project; evaluate a print proof against specification; manage a production schedule across multiple vendors under time pressure

---

### 4. Creative Generalist / AI-Native

**Definition:** A practitioner with broad creative capability across copy, design, photography, video, and print — who uses AI as a force multiplier that makes generalism viable at a professional level. This is not a specialist in any one medium. The value is in aesthetic judgment, conceptual thinking, and the ability to direct AI across disciplines while providing the brand literacy and quality filter that AI cannot supply.

**Why it's defensible:** AI executes but cannot direct itself. Generative tools require a human who knows what good looks like, what the brand requires, and when an output serves the brief versus when it doesn't. That judgment — developed through genuine creative practice across multiple disciplines — is what makes this role viable and irreplaceable.

**GC-specific angle:** This role maps closely to what GC's creative curriculum has always developed — broad exposure across print, design, and production — but repositioned for an AI-native workflow. The bait in GC's historical model was exactly this generalist creative identity. The new curriculum completes the promise rather than redirecting it.

**SOC anchor:** None. This role does not yet have a dedicated SOC classification. It sits at the intersection of Graphic Designers (27-1024), Art Directors (27-1011), and emerging AI practitioner roles that are not yet codified. The Career Target page must be built primarily from panel input rather than seeded from O*NET.

**Core competency areas:**
- Conceptual development and creative ideation across disciplines
- Aesthetic judgment and brand visual literacy
- AI tool direction: prompt design, iteration, quality evaluation, and output refinement
- Cross-medium creative production: copy, design, image, video, print
- Brand standards interpretation and application
- Client brief translation into creative direction

**Key KUD distinctions:**
- Know: how AI generative tools work and where they are reliable versus unreliable; what brand standards govern visual and verbal output; how print production constraints affect digital creative decisions
- Understand: why aesthetic judgment cannot be delegated to AI; why creative iteration requires a human who can evaluate outputs against a brief; why generalism supported by AI is a strategic position rather than a compromise
- Do: take a brand brief from concept through finished output across at least three media (copy, design, and one production format) using AI-assisted workflow; evaluate a set of AI-generated outputs against a brand standard and select, reject, or refine; document a creative workflow that others could replicate

---

### 5. AI Workflow / Orchestrator

**Definition:** The person who designs, builds, and manages the AI-augmented workflows that allow creative and production organizations to scale output without proportionally scaling headcount. This role sits at the intersection of deep domain knowledge (creative, brand, print) and systems thinking about how AI tools can be integrated, sequenced, and quality-controlled across a production workflow.

**Why it's defensible:** This role requires both domain expertise and technical fluency — the combination is rare. An AI workflow designer who doesn't understand creative and production work will build workflows that produce technically correct but creatively wrong outputs. GC graduates who develop this role have a competitive advantage because they bring the domain knowledge that computer science graduates typically lack.

**GC-specific angle:** The orange-zone opportunity. Companies that are transitioning from traditional creative production to AI-augmented workflows need someone who can design the system — not just use the tools. GC graduates who understand print, brand, and packaging production from the inside are uniquely positioned to design workflows for those specific contexts.

**SOC anchor:** None. This role does not yet have a dedicated SOC classification. The closest proxies with Bright Outlook status are Data Scientists (15-2051), Computer Systems Analysts (15-1211), and Management Analysts (13-1111) — none of which capture the creative domain specificity of this role. The Career Target page must be built primarily from panel input. Priority: make this the first panel-developed target given its strategic importance and the absence of competitive programs defining it.

**Core competency areas:**
- AI tool evaluation: understanding capabilities, limitations, and appropriate use cases across generative and analytical AI tools
- Workflow architecture: sequencing human and AI work to maximize quality and efficiency
- Prompt design and documentation: writing, testing, and maintaining prompts that produce consistent outputs
- Quality evaluation frameworks: defining what good output looks like and building review processes to catch failures
- Change management: helping creative and production teams adopt new workflows without losing output quality
- Domain knowledge: deep enough understanding of creative and production work to know where AI belongs and where human judgment is irreplaceable

**Key KUD distinctions:**
- Know: how major AI tools (generative image, copy, video, layout) work and where they fail; what workflow design principles apply to creative production contexts; how to document workflows so they can be maintained and improved
- Understand: why AI tool outputs require domain-expert evaluation; why workflow design is a continuous improvement process, not a one-time build; why change management is the hardest part of AI adoption
- Do: design and document an AI-augmented workflow for a specific creative or production context; evaluate the output of an AI-assisted workflow against a quality standard and identify where the workflow needs revision; train a small team to operate a documented AI workflow

---

## O*NET Data Summary — Employment Context

| Career Target | SOC Code | Growth | Median Wage | Openings (10yr) | Bright Outlook |
|---|---|---|---|---|---|
| Account Management | 41-4012.00 | Faster than avg | ~$65K | High | Yes |
| Brand Strategy | 13-1161.00 | Much faster (7%+) | $76,950 | 87,200 | Yes |
| Production & Operations | 11-3051.00 | Stable | ~$115K | Moderate | No |
| Creative Generalist / AI-Native | No SOC | Emerging | — | — | — |
| AI Workflow / Orchestrator | No SOC | Emerging | — | — | — |

*Note: Creative Generalist and AI Workflow targets require panel-developed definitions. O*NET data does not yet capture these roles. Employment trajectory inference: high, given the rate of AI adoption in creative and production industries.*

---

## Current GC Core Curriculum — Source Data

The following is drawn from `GC_Core_Curriculum.xlsx` (uploaded May 2026). Courses with learning objectives and major projects are marked with data status. This data seeds the visualization and will be migrated into course pages by faculty during the tool rollout.

**Courses with data:**

**GC 1010 — Orientation to Graphic Communications (Level 1)**
Learning objectives: knowledge of GC curriculum and requirements; academic and personal skills for college success; self-reflection on personal development and career goals.
Projects: degreeworks training and course lineup; budget/salary estimate; GC intern employer day participation.

**GC 1020 — Intro to Digital Graphics (Level 1)**
Learning objectives: Adobe CC software skills (Illustrator, Photoshop, InDesign); fundamental layout techniques; industry terminology; branding for self-promotion.
Projects: Logo, Infographic, Photo Retouching, Advertisement, Resume/Business Card, Restaurant Menu, Quizzes.
Skills required: Adobe CC proficiency; layout principles (typography, color theory); industry terminology; self-promotion pieces.

**GC 1050 — Applications of Digital Graphics (Level 1)**
Learning objectives: Adobe CC proficiency (Illustrator, Photoshop, InDesign, Acrobat); design principles, typography, color, branding; printing/finishing considerations; introductory print processes (digital printing, dye sublimation).
Projects: Food Brand Logo/Konica, T-shirt/DTG, Mug/Dye Sublimation, Pillow Pouch, Coaster, Movie Poster, AI Destination Post Card/Konica, Brochure, Magazine Cover, Digital Portfolio.
Note: "AI Destination Post Card" project indicates some AI tool integration already present at 1000 level.

**GC 1040 — Screen Printing & Flexography (Level 1)**
Learning objectives: press operation (screen printing and flexography); press trial data collection and interpretation; dot compensation calculations; press-ready file preparation in Illustrator; print quality evaluation; technical documentation (job tickets, production notes); independent production decisions; printing processes and materials knowledge; industry terminology; design principles in production context; industry history and emerging technologies.
Projects: Screen Printing 1&2, Flexography 1&2, Choice Project, Optimization (Screen/Flexo).
Assessment note: This is the most technically rigorous 1000-level course — Do-level production content in a freshman course is unusual and reflects GC's production-first curriculum identity.

**GC 2400 — Web Development (Level 2)**
Learning objectives: HTML and CSS; web development problem solving; print vs. web design distinctions; coding best practices; client/designer relationship.
Projects: Coding assignments (1–9), Client Site Project, Self Promo Site.
Note: Establishes client relationship skills relevant to Account Management. Technical coding content tangentially relevant to AI Workflow.

**GC 3400 — Digital Imaging (Level 3)**
Learning objectives: digital asset management; image capture; lighting for products and people; ethics and copyright in digital imaging; video storytelling; short-format video production and editing; audio engineering.
Projects: Photography units (DAM, settings, photojournalism, Photoshop for photographers, lighting, critique); Video units (Premiere Pro, editing remix, audio, interview podcast).
Assessment note: This is the clearest Creative Generalist course in the curriculum — photography, video, storytelling, and editing across media. Do-level creative generalist content.

**GC 3460 — Ink and Substrates (Level 3)**
Learning objectives: ink and substrate manufacturing; physical and optical property testing and analysis; print metrics and process optimization; color theory and separation systems; quality control instrumentation; proofing systems.
Projects: Brand Color Report (Pantone color reproduction analysis), Ink Formulation, Substrate Properties Testing, Ink Properties Testing and Lab Report.
Assessment note: Pure production science. No brand, creative, or management content. Do-level Production & Operations.

**GC 3720 — Digital Content & CMS (Level 3, Brand Comm)**
Learning objectives: goal-driven website development with CMS; brand-forward digital content creation; social marketing channel deployment; website conversion techniques; website goal measurement; presentation skills.
Projects: Website Design & Development (WordPress), Client Research (competitive analysis), Website Strategy, Content Strategy, Final Presentation.
Assessment note: Strongest Brand Strategy course in the curriculum with data. Client research, content strategy, measurement, and brand-forward execution — all Do-level brand strategy content.

**GC 3800 — Junior Seminar (Level 3)**
Learning objectives: career paths and opportunities in the industry; professional networking and job searching tools; articulating GC program strengths for job prospecting.
Projects: Course Lineup, C-Suite or Career Center Utilization, LinkedIn, Budget.
Assessment note: Career development course, not discipline-specific. Understand-level Account Management (career paths, networking, professional positioning).

**GC 4060 — Package & Specialty Printing (Level 4)**
Learning objectives: specialty and package printing processes; package design requirements (technical and economic); flexographic workflow; prepress functions; folding carton and corrugated package design; ink/substrate relationship in packaging; color correction; print quality analysis.
Projects: Skill-building assignments, 3-Color Spot Functional Label, 4-Color and Cold Foil Promotional Label, Paperboard Project, Specialty Printing Pieces.
Assessment note: Do-level Production & Operations with packaging specialization. One of the strongest technical production courses.

**GC 4070 — Advanced Flexography (Level 4)**
Learning objectives: FTA FIRST certification (Level 1); test target creation; bump curves and press curve analysis; automated prepress workflows (RIP configurations, trapping, quality control); color management with GMG OpenColor and ICC profiles; complex flexographic print jobs with multi-color, coatings, and specialty effects.
Projects: FIRST Operator Certification, Test Target Creation, Plate/Press/PressSync Curve Creation, Workflow Automation Tickets, Color Management & Proofing, Industry Engagement, Capstone: Press Matching with Custom Profiles.
Assessment note: Do-level Production & Operations. The "Workflow Automation: Tickets" project is the only existing course content that touches AI Workflow territory — automated prepress workflow design is a precursor skill. Understand-level AI Workflow.

**GC 4400 — Commercial Printing (Level 4)**
Learning objectives: graphic design for offset/digital press; variable data and data management for personalized print; typography, copyfitting, and page layout; bindery and finishing; print-to-digital marketing triggers; photographic theories; preflighting; color management; offset and digital press operations; plate and press sheet production.
Projects: Brand Specification Project, Static Brochure Project, Business Card with Finishing Embellishments, Offset Lithographic Press Run, Variable Data Versioned Booklet, Brand Story.
Assessment note: The broadest senior-level course. Touches Account Management (brand specification, integrated marketing), Brand Strategy (brand story, variable data), Production & Operations (Do-level press operation), and Creative Generalist (design, typography). The "Brand Story" project — articulating how marketing collateral fits an integrated campaign driven by brand storytelling — is the closest existing course to brand strategy at Do level.

**GC 4800 — Senior Seminar (Level 4)**
Learning objectives: industry management issues; professional resources; job prospecting and career planning.
Projects: Elevator Speech, Career Reflection, Resume Review, Job Qualification, Presentation, Ethics Assignment, Budget Assignment.
Assessment note: Career capstone course. Understand-level Account Management (industry management, career planning). Not discipline-specific.

**Courses with no data in spreadsheet:**
- GC 2070 — Graphic Communications II (Level 2): Links to Drive folder and syllabus only
- GC 3700 — Brand Comm Course (Level 3): Link to syllabus only
- GC 3710 — Brand Creation & Communication (Level 3): Link to syllabus only
- GC 3780 — Brand Comm Elective (Level 3): Link to Drive folder only
- GC 4440 — Course (Level 4): No data
- GC 4480 — Course (Level 4): No data

**Priority for data entry:** GC 3700, 3710, and 3780 are the three Brand Communications courses — their learning objectives and projects are almost certainly the strongest existing coverage of Brand Strategy and Creative Generalist targets. Getting this data into the tool is the highest-priority data entry task before presenting the coverage analysis to faculty.

