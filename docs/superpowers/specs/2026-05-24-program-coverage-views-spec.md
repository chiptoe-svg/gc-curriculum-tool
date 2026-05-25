# Program-Level Coverage Views — Specification

**One-line:** Four cross-course aggregate views — coverage matrix, scaffolding analysis, prerequisite-gap analysis, advising view — that read confirmed snapshots and surface the program-level picture the per-course tools cannot. Phase 1 of the original vision, deferrable to ship Coverage Matrix first and the other three in sequence.

---

## Background & motivation

CourseCapture produces a snapshot per course. Explore reads a single snapshot and asks "what could this one course do differently?" Neither tool exposes the whole-program picture that motivates the project: *does the curriculum, taken together, prepare students for the careers we claim, and are the prerequisites students actually take sufficient for what each course expects?*

The substrate for these views is now in place:

- Immutable `course_capture_snapshots` for every captured course
- Structured `incoming_expectations` per snapshot (per-skill K/U/D depths the course assumes)
- Verified `competencies` per snapshot with K/U/D depths anchored to evidence

What's missing is the **aggregation layer** that joins snapshots with the career-target framework (`career_targets` + `sub_competencies`) and renders the picture for a curriculum committee — not just an individual instructor.

This spec covers four canonical views in one cohesive surface, with a recommended ship order. The Coverage Matrix is the headline; the rest follow.

## Goals

1. **Aggregate-not-individual focus.** Reading is across *all* captured courses, defaulting to each course's latest non-retired snapshot.
2. **Stable, defensible data.** Every cell in every view traces back to a specific snapshot + the AI scoring that produced its values. Reviewable, disputable, queryable.
3. **Visualization that motivates conversation.** The coverage matrix isn't just a report — it's the artifact a curriculum committee can look at together and say "this is what's thin, here's what to do about it."
4. **Read-only on the substrate.** Program views never write to `course_capture_snapshots` or `course_capture_profiles`. They consume + project.
5. **Incremental release.** Each view ships independently; faculty get value from Coverage Matrix without waiting for Advising.

## Non-goals

- **Not** a curriculum-redesign tool. Surfaces the picture; the redesigning is faculty-committee work informed by the picture.
- **Not** a student-facing recommender. Advising view is for the *advisor*, not the student.
- **Not** real-time. The aggregation step (snapshot × career-target scoring) is a batch job triggered on demand or after a snapshot lands; the views read pre-computed results.
- **Not** dependent on per-student data. Aggregations are over *courses*, not over student transcripts. (Validation work — comparing program output to graduate destinations — is separate, see `2026-05-22-graduate-outcome-validation.md`.)
- **Not** a Tableau-style ad-hoc analytics surface. Four well-defined views that answer specific framework questions, not arbitrary slicing.

---

## The four views

### 1. Coverage Matrix (the headline)

A grid:
- **Rows:** every active GC course that has at least one confirmed snapshot, plus non-GC required + constrained-choice options that have been captured.
- **Columns:** every sub-competency, grouped under its career target.
- **Cells:** fill intensity = depth (0-5), discriminated per K/U/D dimension (hover/expand reveals the three-dimension breakdown).
- **Legend:** the same Mentioned → Mastered scale used everywhere else.

A faculty member opens the matrix and sees the program's coverage shape at a glance. Sparse columns = sub-competencies the program isn't really touching. Dense rows = courses doing heavy curricular work. The visual identity is the same as the heat-map mockup in `vision.html`, now driven by real data.

### 2. Scaffolding Analysis

For each cross-cutting competency (a sub-competency that should develop across multiple courses), this view answers:

- Where is it **introduced** (K1-2 / U0-1 / D0-1)?
- Where is it **practiced** (K3-4 / U2-3 / D2-3)?
- Where is it **assessed / integrated** (K5 / U4-5 / D4-5)?
- Is the order right (intro early in Act 1, practice in Act 2, integration in Act 3)?
- **Where does the scaffold break?** An Act-3 course assuming D=4 that's never even introduced earlier in the program is a brittle scaffold.

Rendered as a per-competency timeline across the 3-Act progression, with "broken scaffold" cards calling out specific problems.

### 3. Prerequisite-Gap Analysis (program-wide)

For *every* captured course, walks its `incoming_expectations` against the captured snapshots of its declared prerequisite courses. Lists:

- Where the prereq course's competencies meet the focal course's expectations ✓
- Where they don't — the focal course expects D=3, the prereq produces D=1 ✕
- Courses that list prereqs which haven't been captured (gaps we can't yet evaluate)

Renders as a sortable table: focal course, expectation, prereq's actual delivery, status chip, optional jump-to-Explore link.

### 4. Advising View

For a student targeting a specific career path:

- The career path's sub-competencies, in priority order
- The course chain that develops them (course → sub-competency → depth) ordered roughly by the 3-Act progression
- Gaps highlighted: sub-competencies no course addresses well
- An "if you can take only one elective for this target, this one moves the needle most" rank

Most useful in advising conversations and in answering "is the program preparing students for X?" — a question employers + accreditation reviewers ask.

---

## Data model

### `snapshot_target_coverage` (new table) — the scoring substrate

The matrix view needs each (snapshot × career-target × sub-competency) cell scored on K/U/D depth. This is the AI scoring step that connects snapshot competencies (discovered, course-specific) to career-target sub-competencies (canonical, program-wide).

```sql
CREATE TABLE snapshot_target_coverage (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id       uuid NOT NULL REFERENCES course_capture_snapshots(id) ON DELETE CASCADE,
  career_target_id  text NOT NULL REFERENCES career_targets(id) ON DELETE CASCADE,
  sub_competency_id text NOT NULL REFERENCES sub_competencies(id) ON DELETE CASCADE,
  k_depth           integer,           -- 0-5, null for foundational/D-only
  u_depth           integer,           -- 0-5, null for foundational/D-only
  d_depth           integer NOT NULL,  -- 0-5; 0 means not present at all
  matched_competency text,             -- which snapshot competency contributed
  evidence_excerpt  text,
  confidence        text NOT NULL,     -- 'high' | 'medium' | 'low'
  rationale         text NOT NULL,
  model             text NOT NULL,
  generated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(snapshot_id, career_target_id, sub_competency_id)
);

CREATE INDEX idx_stc_snapshot ON snapshot_target_coverage (snapshot_id);
CREATE INDEX idx_stc_target ON snapshot_target_coverage (career_target_id);
```

Each row says "this snapshot of this course, against this career target's sub-competency, develops it at K=X, U=Y, D=Z." Computed once per (snapshot, target) pair via an AI scoring pass.

### `scaffolding_analysis` (new table) — derived per-competency

Computed periodically (or on-demand) from snapshot_target_coverage + course act/level metadata. Caches the scaffolding picture for each sub-competency.

```sql
CREATE TABLE scaffolding_analysis (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  career_target_id  text NOT NULL REFERENCES career_targets(id),
  sub_competency_id text NOT NULL REFERENCES sub_competencies(id),
  act_introductions jsonb NOT NULL,    -- { '1': [course_codes], '2': [...], '3': [...] }
  act_practiced     jsonb NOT NULL,
  act_integrated    jsonb NOT NULL,
  brittle_scaffolds jsonb NOT NULL,    -- array of detected break patterns
  generated_at      timestamptz NOT NULL DEFAULT now()
);
```

This table is a denormalized cache — could be a view, but stored for speed since the coverage view will hit it often.

### Existing data this reads

- `course_capture_snapshots` — the snapshots; pick latest non-retired per course
- `course_capture_snapshots.profile.incoming_expectations` — for prereq-gap analysis
- `career_targets` + `sub_competencies` — the canonical career-target framework
- `courses.prerequisites` — the catalog prereq text (parsed for course codes)
- `courses.level` — the academic level (1000, 2000, 3000, 4000) used to infer Act

---

## AI scoring approach

The most important design decision is **how snapshot competencies map to career-target sub-competencies**, since these are described in different vocabularies.

### What we know

- Snapshot competencies are discovered from the course's materials (e.g., "Students prepare production-ready package artwork"). 5-15 per course.
- Career-target sub-competencies are canonical, described per K/U/D level (e.g., "Color Management" under Production & Ops, with knowDescriptor / understandDescriptor / doDescriptor).
- They overlap semantically but rarely with exact word match.

### Approach: per-(snapshot, target) AI scoring

When a snapshot is created (or on-demand refresh), an AI pass runs for each career target:

> Given this course's snapshot competencies + this target's sub-competencies, score how well the course develops each sub-competency on K/U/D depth (0-5). For each sub-competency, identify which snapshot competency contributed (or note "not addressed") and cite the depth + evidence excerpt + confidence.

That's one AI call per (snapshot, target) pair. With 28 courses and 5 targets, that's 140 calls per full program scoring — chunky but bounded.

To reduce cost:
- **Trigger**: don't run on every snapshot save. Run when the user explicitly requests "Refresh program views" or batched once per night.
- **Per-target lazy**: when the user opens the coverage matrix, the missing (snapshot, target) cells are computed on-demand. Cached forever (within scale_version) once computed.
- **Cache key**: `(snapshot_id, career_target_id)`. If either's data changes, invalidate.

### Prompt and JSON Schema

New prompt `program-score-coverage.md`. Returns per-sub-competency K/U/D scores + evidence + confidence + rationale. Schema mirrors `snapshot_target_coverage` shape.

### Limitations to be honest about

- **Career-target data quality.** If sub-competency descriptors are vague, the scoring is vague. The matrix exposes this; the fix is to clean up the targets.
- **Foundational competencies cross-cut differently.** Agency/Curiosity/etc. don't fit per-target neatly; they need their own scoring pass.
- **The matrix shows what the program does, not what the program *should* do.** Whether a sub-competency *should* score D=4 in any course is a different question — the matrix lets faculty see the picture; the framework doesn't impose a target.

---

## UI

A new top-level area at `/program?slug=...`, served independently from the per-course pages.

### Layout

```
┌── HEADER ────────────────────────────────────────────────────────┐
│  GC Program Coverage                                              │
│  Last scored: 12 hours ago · [Refresh program views]              │
└───────────────────────────────────────────────────────────────────┘

┌── COVERAGE MATRIX ───────────────────────────────────────────────┐
│  [tab: All targets | Production & Ops | Brand Strategy | ...]    │
│  ┌─────────────┬───┬───┬───┬───┬───┬───┬───┬───┐                 │
│  │             │SC1│SC2│SC3│SC4│SC5│SC6│SC7│SC8│  …              │
│  │ GC 1010     │ ░ │ ▓ │ ▓ │ ░ │ ░ │   │   │   │                 │
│  │ GC 1020     │ ░ │ ▓ │ █ │ ░ │ ░ │   │   │   │                 │
│  │ GC 3460     │ ░ │ █ │ █ │ █ │ █ │ █ │ ▓ │ ▓ │                 │
│  │ GC 4060     │   │ ▓ │ █ │ █ │ █ │ █ │ █ │ █ │                 │
│  └─────────────┴───┴───┴───┴───┴───┴───┴───┴───┘                 │
│  Click any cell to see the snapshot competency that contributed   │
│  and the evidence excerpt.                                        │
└───────────────────────────────────────────────────────────────────┘

┌── SCAFFOLDING ANALYSIS ──────────────────────────────────────────┐
│  Color Management  [Production & Ops]                             │
│  Act 1: GC 1020 (K1), GC 1040 (K2)                                │
│  Act 2: GC 3030 (K3 U2 D2), GC 3460 (K4 U3 D4)                    │
│  Act 3: GC 4060 (assumes K4 U3 D3), GC 4400 (assumes K5 U4 D4)    │
│  ✓ Scaffolds correctly                                            │
│  ─────                                                            │
│  Production-Ready File Prep                                       │
│  Act 1: (none)                                                    │
│  Act 2: GC 3460 (K4 U2 D4)                                        │
│  Act 3: GC 4400 (assumes K5 D4)                                   │
│  ⚠ Brittle scaffold — never introduced in Act 1                   │
└───────────────────────────────────────────────────────────────────┘

┌── PREREQUISITE GAPS ─────────────────────────────────────────────┐
│  GC 3460 expects:                                                 │
│  • "Thorough CMYK color theory" (K4 U3) → GC 1040 produces K2 U1  │
│    Gap: ⚠ understated prereq                                      │
│  • "Halftones and dot gain" (K3 D2) → GC 1040 produces K3 D2 ✓    │
│  ─────                                                            │
│  GC 4060 expects:                                                 │
│  • ...                                                            │
└───────────────────────────────────────────────────────────────────┘

┌── ADVISING VIEW ─────────────────────────────────────────────────┐
│  Target: [Production & Ops ▾]                                     │
│  Recommended sequence for a student targeting this path:          │
│  Act 1: GC 1010, GC 1020, GC 1040                                 │
│  Act 2: GC 3030, GC 3460                                          │
│  Act 3: GC 4060, GC 4400, GC 4060ap                               │
│  ─────                                                            │
│  Gaps for this target:                                            │
│  • Sub-competency "Vendor Communication" — no captured course      │
│    addresses it above K1                                          │
└───────────────────────────────────────────────────────────────────┘
```

The four sections render in this order on `/program`; each is its own collapsible section. v1 might ship as separate pages (`/program/coverage`, `/program/scaffolding`, `/program/prerequisites`, `/program/advising`) for simpler scoping.

### Refresh-on-demand UX

A "Refresh program views" button at the top runs the AI scoring pass against every (latest-snapshot, career-target) pair that's stale (no row in `snapshot_target_coverage`). Shows progress as it goes (which course, which target currently being scored). Cost-bounded — could be ~140 calls × ~$0.05 = ~$7 for a full refresh of GC's 28 courses × 5 targets.

After the first full pass, refreshes are incremental — only newly snapshotted courses get scored.

---

## API

```
GET  /api/program/coverage?slug=...
        Returns the full coverage matrix data: every (course × sub-competency)
        cell with K/U/D depths + evidence. Pre-computed via
        snapshot_target_coverage table.

POST /api/program/coverage/refresh?slug=...
        Triggers scoring for every (latest-snapshot, target) pair that's
        stale. Streams progress. Idempotent: re-running skips up-to-date
        cells.

POST /api/program/coverage/refresh/[snapshotId]/[targetId]?slug=...
        Score a single (snapshot, target) pair on demand. Used by the
        coverage matrix when a cell is opened and its data is missing.

GET  /api/program/scaffolding?slug=...
        Per-sub-competency timeline view data.

POST /api/program/scaffolding/refresh?slug=...
        Recompute the scaffolding_analysis table from current coverage data.

GET  /api/program/prerequisites?slug=...
        For every captured course, its incoming_expectations checked against
        its declared prereqs' snapshots. Pure read; recomputed on each request.

GET  /api/program/advising?targetId=...&slug=...
        Recommended course sequence for a career target. Pure read.
```

---

## Implementation phasing

The four views are sized differently. Recommended sequence:

### Phase 1A: Coverage Matrix (~3 days)
1. New `snapshot_target_coverage` table + migration
2. Prompt + JSON schema for per-(snapshot, target) scoring
3. Scoring helper + endpoint (with refresh-on-demand semantics)
4. Coverage matrix UI: grid render, cell detail panel, target tabs
5. Smoke test on existing snapshots (GC 3460, GC 3400, others) × all targets

### Phase 1B: Scaffolding Analysis (~1.5 days)
1. `scaffolding_analysis` table (caches derived data)
2. Per-sub-competency aggregation logic (consumes Phase 1A coverage data)
3. Brittle-scaffold detection rule
4. Scaffolding view UI

### Phase 1C: Prerequisite-Gap Analysis (~1.5 days)
1. Reverse-lookup logic for each course's prereqs → captured snapshots
2. Compare incoming_expectations against prereq deliveries (already partially in `getLatestSnapshotByCourse` pattern from CourseCapture)
3. Sortable-table UI with status chips

### Phase 1D: Advising View (~1 day)
1. Per-target course-sequence aggregation
2. Gap detection
3. UI with target picker and recommended sequence

Total: ~7 working days. Ships across 4 commits, each independently useful.

---

## Acceptance criteria

- A faculty member can open `/program?slug=...` and see a 28-course × 25-sub-competency coverage matrix where every cell is depth-colored and traces back to a specific snapshot + evidence excerpt.
- The matrix tabs by career target; each tab is a sub-view of the full grid.
- Clicking any cell reveals: the matched snapshot competency, the evidence excerpt, the K/U/D depths, and a link to view the snapshot.
- The scaffolding section shows each sub-competency's progression across Act 1/2/3, with brittle-scaffold cards calling out specific problems.
- The prereq-gap section is a sortable table of every captured course's incoming_expectations vs. the prereqs' actual deliveries.
- The advising view, given a target, produces a recommended course sequence with gaps highlighted.
- "Refresh program views" runs the AI scoring for missing cells; the operation is idempotent and cost-bounded.

---

## Out of scope (Phase 2+ items)

- **Per-student transcripts** — what specific students took and how it lines up. Different data model entirely.
- **Faculty disagreement / dispute pipeline** — flagging cells the faculty disagree with. Useful but doesn't block the v1 surface.
- **Comparison across snapshots** — "how has program coverage shifted over time as we re-captured courses?" Needs longitudinal joining.
- **Export / share** — PDF/CSV export of the matrix. Easy to add later.
- **Embeddings-based matching** — could speed up the per-cell scoring, but adds an offline embedding pipeline. v1 uses direct AI scoring.
- **Cross-program comparison** — comparing GC's coverage matrix to another department's. Multi-tenant work.
- **Foundational competency coverage matrix** — Agency / Attention to Detail / Resilience / Curiosity / Communication thread across every course in different ways. Deserves its own treatment, possibly a 6th view.

---

## Locked-in decisions

These were open questions in the first draft of this spec; the answers are now decided.

1. **AI scoring cost.** Locked to **gpt-5.4** for v1 (default). Token-budget worked math with prompt caching gives **~$4–5 per full refresh** at GC scale (28 courses × 5 targets ≈ 140 calls). The scoring helper must batch calls by target so the ~2,000-token target description caches across 28 calls per target (system prompt caches across all 140). Steady-state cost is much lower — typically ~$0.20 per new snapshot (5 targets × ~$0.04) since most days run incrementally rather than full-refresh. Switching to gpt-5.4-mini is on the table for a future pilot if quality holds up; see Phase 2.
2. **Foundational competency view.** Render as a **separate matrix** rather than folding into the per-target matrix. Different scoring model (D-only), different conceptual frame (program-wide threads, not target-specific). Could share the table schema by treating "Foundational" as a pseudo-target with the five baselines as its sub-competencies — implementation detail to decide at build time.
3. **Career-target descriptor refresh.** When a `sub_competency`'s descriptors are edited, automatically **invalidate** the relevant `snapshot_target_coverage` cells. UI shows a "this row may be stale — refresh recommended" banner per affected course.
4. **Prereq parsing.** Treat all listed prereqs in `courses.prerequisites` as **required (strict reading)** for v1. The freeform "or"/"and" logic isn't parsed; a course listing "GC 1040 or GC 1020" is treated as expecting both. Refining to alternatives is a Phase 2 enhancement once we have evidence it matters.
5. **Auth + write access.** Every slug holder can trigger refreshes for v1, since the framework hasn't introduced role-based access yet. The refresh operation is idempotent (only scores missing/stale cells), so it's not destructive in practice.
6. **Non-GC required courses (v1 treatment).** PSYC 2010 / ACCT 2010 / MKT 3010 / PKSC 1020 etc. are not capturable in this tool and won't appear in the coverage matrix. They're shown in the prereq-gap and advising views as "out of program — not captured" with a placeholder badge. See Phase 2 note below for the longer-term plan to bring them into the system.

## Phase 2 follow-ups (not in v1, captured for sequencing)

- **Non-GC course capture flow.** Long-term, every required course in the degree plan should be capturable — PSYC, ACCT, MKT, PKSC, plus the gen-ed pool. Likely a separate import path (faculty in those departments don't use this tool) — e.g., a public-syllabus-fetch + AI extraction pass that produces a lightweight snapshot without requiring those instructors to run the audit conversation. Until this exists, those courses show as gaps in the matrix and a footnote acknowledges that gap is artificial (not a curriculum problem; an instrumentation problem).
- **gpt-5.4-mini pilot for scoring.** Two-or-three (snapshot, target) cells scored on both models, compare outputs; if mini is defensible, swap the default and save ~70% on scoring cost.
- **Hybrid scoring with confidence routing.** If mini holds up for high-confidence cells but degrades on edge cases, route low-confidence cells to gpt-5.4 for a second pass. Complexity / value trade-off to revisit after the pilot.
- **Prereq "or" / "and" parsing.** A real expression parser over `courses.prerequisites` text so the matrix correctly handles "GC 1040 or GC 1020" as alternatives rather than both required.
- **Role-based access.** When the framework adds users-and-roles, scope the destructive operations (refresh, edit) to specific roles. Today it's all-or-nothing via slug.
