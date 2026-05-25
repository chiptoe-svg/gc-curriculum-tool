# Explore Module v1 — Custom and Downstream Targets

**One-line:** A read-only-on-the-snapshot module that compares a confirmed Course Outcome Profile to a target spec (custom instructor-defined goals, or what downstream courses expect from incoming students) and surfaces gap analysis + recommendations. Reads from `course_capture_snapshots`; writes only its own target/session state, never the captured profile.

---

## Background & motivation

CourseCapture produces a *descriptive* snapshot — what the course is, evidence-backed. Explore is *prescriptive*: given that snapshot, what should change, and why. Three "ends" the framework can target, agreed in earlier brainstorming:

1. **Custom** — instructor-defined KUD+ goals. Self-contained, no cross-course dependency. Highest UX value because it drives course-revision conversations.
2. **Downstream** — what later courses (those that list this course as a prereq) expect incoming students to bring. Depends on those courses having been captured.
3. **Career path** — deferred until career-target data has been cleaned up.

This spec covers **custom and downstream only**. Career-path comparison is intentionally out of scope.

The capture-side substrate the module reads from is in place:
- Immutable `course_capture_snapshots` keyed by course
- `incoming_expectations` structured per-skill K/U/D depths on every snapshot
- `verification_summary` providing a quick orientation surface

What Explore adds is the comparator + recommender, surfaced through a separate page that does not modify any capture-side data.

## Goals

1. **Read-only on the snapshot.** Explore reads but never writes the captured profile. All Explore-side data (targets, analyses) lives in its own tables.
2. **Custom target authoring.** Instructor types in plain-language goals; the AI proposes a structured KUD+ target; the instructor confirms or amends. The structured target is persisted, attached to the course.
3. **Downstream target auto-detection.** For courses where downstream courses (those listing this course as a prereq) have themselves been captured, the union of their `incoming_expectations` becomes a target spec automatically.
4. **Comparator output.** Given a snapshot + a target spec, produce per-target-item alignment (covered / partial / underdeveloped / missing) and 2–4 ranked recommendations sized to close the most consequential gaps.
5. **Persistence of analyses.** Each generated analysis is saved so the instructor can revisit without re-running, and so future Explore sessions can show "we explored this against target X on date Y."
6. **Single-mode-per-session UI.** Pick one of custom / downstream when entering Explore. Combined-mode comparisons (a course serves both a custom goal AND downstream needs) are a Phase 2 enhancement.

## Non-goals

- **Not** career-path alignment.
- **Not** snapshot diff (cross-snapshot longitudinal comparison).
- **Not** "what-if scenarios" where the instructor proposes a synthetic change and the system re-scores. Useful but is its own design conversation; v1 reads the existing snapshot as-is.
- **Not** automatic curriculum revision. Explore surfaces recommendations; faculty deliberation and CourseCapture re-runs are how revisions actually happen.
- **Not** combinable target modes in one session.

---

## Data model

### `course_explore_targets` (new table)

Persisted custom targets, attached to a course. Multiple targets per course are allowed (an instructor might have a "Spring 2026 redesign" target and a "Long-term aspirational" target side by side). Each is stamped with the snapshot it was authored against.

```sql
CREATE TABLE course_explore_targets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_code     text NOT NULL REFERENCES courses(code) ON DELETE CASCADE,
  kind            text NOT NULL,                       -- 'custom' | 'downstream'
  spec            jsonb NOT NULL,                      -- TargetSpec JSON shape (see below)
  caption         text,                                -- optional user label
  prose_input     text,                                -- the instructor's original prose (custom only)
  authored_against_snapshot_id  uuid REFERENCES course_capture_snapshots(id) ON DELETE SET NULL,
  retired_at      timestamptz,                          -- soft-delete
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_explore_targets_course ON course_explore_targets (course_code, created_at DESC);
```

### `course_explore_analyses` (new table)

Each comparator run produces a saved analysis. Multiple analyses per (course, target) over time — re-running comparator on a new snapshot creates a new analysis row.

```sql
CREATE TABLE course_explore_analyses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_code     text NOT NULL REFERENCES courses(code) ON DELETE CASCADE,
  snapshot_id     uuid NOT NULL REFERENCES course_capture_snapshots(id) ON DELETE CASCADE,
  target_id       uuid NOT NULL REFERENCES course_explore_targets(id) ON DELETE CASCADE,
  analysis        jsonb NOT NULL,                      -- ExploreAnalysis JSON shape
  model           text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_explore_analyses_course ON course_explore_analyses (course_code, created_at DESC);
```

### TargetSpec JSON shape

The `spec` field on a target row is a discriminated union:

```jsonc
// kind: 'custom'
{
  "kind": "custom",
  "competencies": [
    {
      "statement": "Students defend a brand color choice to a non-technical client using measurement data and a written rationale",
      "type": "technical" | "foundational",
      "target_depth": { "k": 0-5 or null, "u": 0-5 or null, "d": 0-5 },
      "rationale": "Why this target competency at this depth"
    },
    ...
  ]
}

// kind: 'downstream'
{
  "kind": "downstream",
  "courses": [
    {
      "code": "GC 4060",
      "title": "Brand Strategy",
      "snapshot_id": "...",
      "incoming_expectations": [ /* copied from that snapshot's incoming_expectations */ ]
    },
    ...
  ]
}
```

The downstream spec is essentially a denormalized snapshot of the relevant downstream snapshots at analysis time — included in the spec so the analysis is reproducible even if the downstream snapshots change later.

### ExploreAnalysis JSON shape

The `analysis` field on an analysis row:

```jsonc
{
  "snapshot_id": "...",
  "target_spec_id": "...",
  "generated_at": "ISO timestamp",
  "alignment": [
    {
      "target_statement": "Students defend a brand color choice...",
      "matched_snapshot_competency": "Students articulate color decisions in design rationale",  // null if no match
      "target_depth": { "k": 4, "u": 3, "d": 4 },
      "snapshot_depth": { "k": 4, "u": 2, "d": 3 },  // null if no match
      "status": "covered" | "partial" | "underdeveloped" | "missing",
      "delta_notes": "Snapshot evidence at U=2 (paraphrases rationale) vs. target U=3 (predicts consequences). Gap in articulation depth."
    },
    ...
  ],
  "recommendations": [
    {
      "priority": 1,
      "change": "Add a 25-pt oral defense component to the Brand Color Report rubric, scored on rationale-articulation criteria",
      "impact": "Moves the 'defending color choices' competency from D3/U2 to D4/U3, closing the largest single gap against the custom target.",
      "would_affect": [
        { "competency": "Students articulate color decisions in design rationale", "from_depth": { "k": 4, "u": 2, "d": 3 }, "to_depth": { "k": 4, "u": 3, "d": 4 } }
      ]
    },
    ...
  ],
  "audit_notes": {
    "gaps_addressed_by_recommendations": [...],
    "gaps_not_addressed": [...],
    "strengths_relative_to_target": [...]
  }
}
```

---

## Workflow

### Custom mode

```
Enter Explore at /explore/[code]
  ↓ (snapshot dropdown defaults to latest non-retired)
  ↓
Pick "Custom target"
  ↓
Option A: select existing custom target from this course
Option B: create new custom target
  ↓
For new target: type prose into a text area ("I want students to leave able to...")
  ↓
Click "Draft target" → AI proposes structured KUD+ competencies based on the prose AND the snapshot's existing content (so the target is realistic, not in a vacuum)
  ↓
Instructor reviews proposed target competencies, edits depths/statements inline, removes any unwanted entries, adds any missing
  ↓
Click "Save target" → persists to course_explore_targets
  ↓
Click "Run analysis" → comparator runs against the snapshot
  ↓
Analysis result rendered: per-target-item alignment row + recommendations
```

### Downstream mode

```
Enter Explore at /explore/[code]
  ↓ (snapshot dropdown defaults to latest)
  ↓
Pick "Downstream courses"
  ↓
System detects downstream courses (those with this course in their prereq text)
  ↓
List shown with checkboxes; courses without snapshots are visible but un-checkable (with a hint "capture this course first to include it")
  ↓
Instructor selects which downstream courses to compare against
  ↓
Click "Build target" → the downstream `incoming_expectations` are unioned into a target spec
  ↓
Click "Run analysis" → comparator runs
  ↓
Analysis result rendered with the same shape as custom-mode output
```

---

## Prompts

Two new prompts.

### `explore-draft-target.md`

Used when an instructor types prose into the custom-target authoring panel. Takes the prose + the current snapshot's profile and returns a structured target competency list.

Key constraints in the prompt:
- The proposed target competencies must be *grounded in the snapshot*. The AI does not invent skills that have no plausible connection to what the course currently develops; if the prose asks for something the course can't reasonably support, the target competency includes a note.
- Each proposed competency carries an explicit target depth per K/U/D, using the same depth-scale anchors as the capture system.
- Output is structured JSON via OpenAI strict mode; the schema mirrors the `kind: 'custom'` shape of TargetSpec.

### `explore-compare.md`

Used by the analyze endpoint. Takes a snapshot's profile and a TargetSpec; produces an ExploreAnalysis.

Key constraints:
- Status taxonomy: `covered` (snapshot meets/exceeds target on all dimensions), `partial` (meets some), `underdeveloped` (matched but below target on every relevant dimension), `missing` (no comparable snapshot competency).
- 2–4 recommendations, ordered by impact. Each must (a) name a specific change (add/modify assignment, revise objective, add rubric criterion, surface foundational behavior, etc.), (b) state the expected effect in terms of which competencies and which dimensions move, and (c) prefer changes that close *multiple* gaps rather than one.
- Strict description; never speculation. If the snapshot doesn't have enough evidence to compare on a target item, the analysis says so explicitly.

---

## API

```
GET    /api/explore/[code]/targets?slug=...                  list custom + downstream targets for this course
POST   /api/explore/[code]/targets?slug=...                  create new target (custom prose draft, or downstream auto-build)
GET    /api/explore/[code]/targets/[id]?slug=...             fetch a target's full spec
PATCH  /api/explore/[code]/targets/[id]?slug=...             update spec (edit after draft), update caption, or set retired_at
DELETE /api/explore/[code]/targets/[id]?slug=...             soft-retire

POST   /api/explore/[code]/draft-custom?slug=...             prose + snapshot_id → AI-drafted target spec (not persisted)
POST   /api/explore/[code]/build-downstream?slug=...         { snapshot_id, downstream_codes } → constructed downstream target (not persisted)

GET    /api/explore/[code]/downstream-candidates?slug=...    reverse-lookup courses with this code in their prereqs + their snapshot status

POST   /api/explore/[code]/analyze?slug=...                  { snapshot_id, target_id } → runs comparator, persists analysis
GET    /api/explore/[code]/analyses?slug=...                 list analyses (latest first)
GET    /api/explore/[code]/analyses/[id]?slug=...            fetch a saved analysis
```

---

## UI

A new top-level surface at `/explore/[code]?slug=...`.

Layout:

```
┌── HEADER ──────────────────────────────────────────────────────────────┐
│  GC 3460 — Ink and Substrates                                          │
│  Snapshot: Spring 2026 baseline (May 24)  [change]                     │
└────────────────────────────────────────────────────────────────────────┘

┌── MODE PICKER ─────────────────────────────────────────────────────────┐
│  [● Custom target]  [○ Downstream courses]                             │
└────────────────────────────────────────────────────────────────────────┘

(custom mode)
┌── TARGET ──────────────────────────────────────────────────────────────┐
│  Existing custom targets ▾  (or)  + New custom target                  │
│  ─────────────────────────────────────────────────────────              │
│  [Prose text area]                                                     │
│  [Draft target]                                                        │
│  ─────────────────────────────────────────────────────────              │
│  Proposed target competencies (editable):                              │
│  [card per competency with statement + K/U/D sliders + rationale]      │
│  [Save target] [Discard]                                               │
└────────────────────────────────────────────────────────────────────────┘

┌── ANALYSIS ────────────────────────────────────────────────────────────┐
│  [Run analysis] (enabled once a saved target is selected)              │
│  ─────────────────────────────────────────────────────────              │
│  Alignment (per target item):                                          │
│  ✓ Covered: 4   ◐ Partial: 3   ↓ Underdeveloped: 2   ✕ Missing: 1     │
│  [Rows: target statement, snapshot match, status chip, delta note]     │
│  ─────────────────────────────────────────────────────────              │
│  Top recommendations:                                                  │
│  1. [change] → [impact]                                                │
│  2. [change] → [impact]                                                │
│  3. [change] → [impact]                                                │
└────────────────────────────────────────────────────────────────────────┘
```

(downstream mode swaps the TARGET block for a downstream-courses selection list)

---

## Tasks

### Schema & queries
1. Add `course_explore_targets` and `course_explore_analyses` tables to `lib/db/schema.ts`. Generate + apply migration.
2. Write `lib/db/explore-queries.ts` with target CRUD + analysis CRUD.

### Zod schemas
3. Add target-spec and analysis schemas to `lib/ai/explore/schema.ts` (new directory under lib/ai/).

### Prompts
4. Write `lib/ai/prompts/explore-draft-target.md` for the custom target authoring flow.
5. Write `lib/ai/prompts/explore-compare.md` for the comparator.
6. Register both in `lib/ai/prompts/load.ts`.

### Scoring helpers
7. Write `lib/ai/analyze/explore-draft-target.ts` (prose + snapshot → structured target).
8. Write `lib/ai/analyze/explore-compare.ts` (snapshot + target → analysis).

### API endpoints
9. Implement target endpoints (list / create / get / patch / delete) under `/api/explore/[code]/targets/...`.
10. Implement `/draft-custom` and `/build-downstream` (both ephemeral — return data without persisting).
11. Implement `/downstream-candidates` (reverse-lookup courses where `prerequisites` contains this code, joined with their snapshot status).
12. Implement `/analyze` (runs comparator + persists analysis).
13. Implement `/analyses` list + get.

### UI
14. Build `/explore/[code]/page.tsx` server component: slug-gate, load course + snapshots + targets + analyses.
15. Build `ExploreClient` orchestrator: mode picker, snapshot picker, target picker, analysis stage.
16. Build `CustomTargetAuthoring` component: prose input → AI draft → editable competency cards → save.
17. Build `DownstreamPicker` component: list candidate downstream courses with snapshot status chips, checkboxes for selection.
18. Build `AnalysisView` component: alignment summary chips + per-target-item rows + recommendation list.
19. Build snapshot-picker dropdown that defaults to latest and lets the instructor switch.

### Smoke test
20. Walk through custom-mode end-to-end on GC 3460 (which has at least one snapshot from the v1 completion smoke test).
21. Once a second course (e.g., GC 4060) has a snapshot, walk through downstream-mode end-to-end.

---

## Acceptance criteria

- `/explore/GC%203460?slug=...` loads with a snapshot selected (latest by default).
- A new custom target can be authored from prose; the AI-drafted competencies appear with editable depths and rationales.
- Saving the target persists it to `course_explore_targets`; the target appears in the existing-targets dropdown on next visit.
- "Run analysis" produces an alignment view + 2–4 ranked recommendations against the selected snapshot, and persists the analysis row.
- Downstream mode shows the courses whose `prerequisites` contains this course's code, with a chip indicating whether each has a snapshot available.
- The comparator output cleanly distinguishes the four status states (covered / partial / underdeveloped / missing) and recommendations name specific changes (not "consider X" platitudes).
- No write goes near `course_capture_profiles` or `course_capture_snapshots` from anywhere in this module.

---

## Out of scope

- Career-path target mode (deferred until career-target data quality matures).
- Combinable target modes in one session (e.g., "show me alignment against both my custom target AND downstream needs").
- Snapshot-diff comparison (two snapshots, what changed).
- What-if scenarios (synthetic assignment additions, re-scored under hypothetical).
- Exporting recommendations as a syllabus revision draft. The `revised_objectives_draft` on the snapshot continues to be the existing path for that; Explore recommendations may *inform* a future revision draft but don't directly produce one.

---

## Open questions

1. **Should `analyze` regenerate or read-cache?** When the user clicks "Run analysis" on a (snapshot, target) pair that already has a persisted analysis row, do we return the existing row, or re-run? Lean: re-run always but make the cost visible (small "↻ Re-running" indicator). The old analysis row stays persisted; the new one is appended. Faculty can browse the history.

2. **What does the AI draft when the prose is ambiguous?** For "I want students to be better at color theory" the AI has to pick depths and statements. My lean: the AI proposes the highest-confidence plausible interpretation but flags low-confidence items in the rationale field. The instructor edits.

3. **What if the snapshot lacks `incoming_expectations` (legacy)?** Downstream mode requires that field to function. Lean: surface "downstream comparison unavailable — re-run CourseCapture to populate incoming expectations" and gracefully fall back to disabling the mode.

4. **Should retired targets be visible by default in the picker?** Lean: no, hidden behind a toggle. Same pattern as snapshots.

5. **Analysis stale indication.** When the underlying snapshot changes (new snapshot for the course), past analyses against earlier snapshots become "stale" in a sense. Lean: show a "based on snapshot from {date}" line under each analysis but don't automatically invalidate them. Faculty re-run when they want fresh.
