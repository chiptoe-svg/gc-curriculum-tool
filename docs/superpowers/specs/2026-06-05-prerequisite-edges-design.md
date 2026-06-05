# Persisted Skill-Tagged Prerequisite Edges (Design)

> **Status:** design draft, 2026-06-05 — for review. The course-side ("Q2") half of the audit's step-4 unified demand/coverage layer, built first because it is **independent of partner/position data** (which is ~empty immediately post-PC-v1) and fully testable today.
>
> **Origin:** [`docs/STATE.md`](../../STATE.md) Next-steps "the unified demand/coverage layer + persisted prereq edges — the strategic spine that actually makes Q1 sufficiency and Q2 computable." This spec covers the **persisted prereq edges + the Q2 per-course gap engine**; the Q1 demand→coverage half is a separate, later spec.

## The question this serves

> **Q2.** For any individual course, do the prerequisites students walk in with actually support what the course expects?

## What exists vs. what's missing

**Already built (the comparison engine):**
- `incomingExpectationSchema` (`lib/ai/capture/schema.ts:179`) — what a course expects students to walk in with: `statement` + `expected_depth {k,u,d}` + `evidenced_by` + `confidence`.
- `snapshotTargetCoverage` (`lib/db/schema.ts:421`) — a course snapshot's **attainment** K/U/D per sub-competency, keyed `(snapshotId, careerTargetId, subCompetencyId)`.
- `analyzeCourseGaps` / `analyzeGaps` (`lib/ai/analyze/`) + `PrerequisiteGap` (`lib/domain/types.ts:75`) + `PrerequisiteGapPanel` — the AI narrative analyzer + render component.

**Missing (the strategic spine):** there is **no structured, persisted course→course graph**. Today `courses.prerequisites` is a **free-text string** (`schema.ts:87`) and prior coursework is fed to the analyzer **ad-hoc** as `{courseLabel, syllabus}` blobs. So prereq-gap analysis is a manual one-off — it cannot run **systematically across the program** because the edges aren't first-class data.

This spec adds the missing graph + a deterministic gap engine, and re-points the existing analyzer/panel at it.

## Locked design decisions (from brainstorming, 2026-06-05)

1. **Edge source: LLM-seed from the existing free-text `courses.prerequisites` (+ the course's incoming-expectation statements), then faculty confirm/edit.** Bootstraps from data already captured; faculty own the final graph.
2. **Skill-tagged edges.** An edge records *which sub-competency* a focal course relies on a prereq for, plus the depth it needs incoming. This makes the core gap **deterministic arithmetic**, not an AI guess.
3. **Edges are DIRECT (immediate prereq only); transitivity is DERIVED by traversal, never authored.** GC 3460 lists GC 2070; GC 2070 lists GC 1040; the chain `3460→2070→1040` is computed, never hand-listed.
4. **Ordinal-MAX aggregation — no sum, no additive weight, no double-counting** (see Invariants). This is the load-bearing correctness guarantee.
5. **Program-wide rollup/visualization is DEFERRED** — it is an additive, read-only layer over this engine (see Scope).

## Data model

New table `prerequisite_edges` — one row per `(focalCourse, prereqCourse, subCompetency)` the focal course relies on (surrogate `id` PK so the skill-tag rows can hang off a `(focal, prereq)` pair; a unique constraint enforces no duplicates):

```ts
export const prerequisiteEdges = pgTable('prerequisite_edges', {
  id: uuid('id').primaryKey().defaultRandom(),
  focalCourseCode: text('focal_course_code').notNull().references(() => courses.code, { onDelete: 'cascade' }),
  prereqCourseCode: text('prereq_course_code').notNull().references(() => courses.code, { onDelete: 'cascade' }),
  subCompetencyId: text('sub_competency_id').notNull().references(() => subCompetencies.id, { onDelete: 'cascade' }),
  // Depth the FOCAL course relies on students walking in WITH (incoming), per dimension.
  // Nullable per-dimension; at least one must be non-null (a tag with all-null depths is meaningless).
  expectedK: integer('expected_k'),
  expectedU: integer('expected_u'),
  expectedD: integer('expected_d'),
  source: text('source').notNull(),            // 'llm_seed' | 'faculty'
  confidence: text('confidence').notNull(),    // 'high' | 'medium' | 'low'  (faculty edits → 'high')
  confirmed: boolean('confirmed').notNull().default(false),
  rationale: text('rationale').notNull().default(''),  // why this dependency; seed evidence from prose/expectations
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  uniq: unique('uq_prerequisite_edges_focal_prereq_subcomp').on(t.focalCourseCode, t.prereqCourseCode, t.subCompetencyId),
  focalIdx: index('idx_prerequisite_edges_focal').on(t.focalCourseCode),
  prereqIdx: index('idx_prerequisite_edges_prereq').on(t.prereqCourseCode),
}));
```

- The **structural edge** (`focal → prereq`) is just the distinct set of `(focalCourseCode, prereqCourseCode)` pairs; the skill-tag rows hang off it.
- **Self-reference guard:** `focalCourseCode !== prereqCourseCode` is enforced at write time (a course can't be its own prereq).
- **Acyclicity** is a graph-level invariant (not a single-row CHECK): faculty edits and traversal detect cycles and report them rather than persisting/looping (see Invariants).
- Migration: `0030_*` (next after 0029).

## Seeding — `prereq-edge-seed` AI function

A new default-tier AI function (module under `lib/ai/analyze/`, registered in `lib/ai/function-settings.ts`): for a focal course, reads (a) its free-text `courses.prerequisites`, (b) its `incomingExpectationSchema` statements, (c) the catalog sub-competencies. It proposes skill-tagged edges:
1. Extract the **direct** prereq course codes mentioned in the prose (validate each against `courses.code`; drop unmatched).
2. For each prereq, propose which `sub_competency_id`s + `expected_{k,u,d}` the focal course relies on it for, grounded in the incoming-expectation statements + catalog sub-competencies.

Output rows persist as `source='llm_seed'`, `confirmed=false`, with a `rationale` quoting the evidence. Strict-mode JSON schema (every property in `required`; nullable depths as `['integer','null']`), Zod-validated, with a recursive required===properties walker test (per the project's strict-mode discipline).

## Faculty confirm/edit surface

An admin view (per focal course, under the existing course/admin surfaces, slug-gated like the other admin routes) listing the seeded edges grouped by prereq course, showing the skill tags + expected depths. Faculty can:
- Confirm an edge (`confirmed=true`, `source='faculty'`, `confidence='high'`).
- Edit `expected_{k,u,d}`, add/remove skill tags, add a prereq the prose missed, delete a wrong edge.
- An edit that would create a **cycle** is rejected with a clear message (the only structural validation faculty can hit).

## Gap computation — `computePrereqGaps(focalCourseCode)`

Pure/deterministic, **direct edges only, MAX aggregation**:

For each sub-competency *X* the focal course relies on (across its confirmed direct edges):
- `needed(X)` per dimension = **MAX** over edges-for-*X* of `expected_{k,u,d}` (the focal's incoming need; max keeps it consistent if multiple edges tag *X*).
- `delivered(X)` per dimension = **MAX** over `{prereq courses tagged for X}` of that prereq course's **measured attainment** of *X* — read from the prereq course's **latest** `snapshotTargetCoverage` row for *(X's target, X)*. (A sub-competency belongs to exactly one target, so the lookup is unambiguous.)
- `gap(X)` per dimension = `max(0, needed − delivered)`.
- **Status** per *X*: `met` (gap 0 on all relied dims), `gap` (≥1 dim short), or `unmeasured` (the prereq course has no snapshot/coverage row for *X* — we have not measured it, so we assert no gap, only "not yet measured", mirroring the evidence-ladder honesty rule).

The function reads **only direct edges' measured attainment** — it does **not** traverse the chain. A prereq's snapshot already reflects what its students demonstrably attained regardless of where they first learned it, so the direct check is sufficient for the gap number. Chain traversal (to diagnose *where* a missing skill should have originated) belongs to the deferred program-wide layer.

The result feeds: (a) the existing `PrerequisiteGapPanel` for the per-course view, and (b) optionally the existing `analyzeCourseGaps` for a human-readable narrative — now driven by **persisted edges** instead of hand-fed `priorCoursework` blobs.

## No-double-counting invariants (explicit; enforced by tests)

The concern: a course reachable both directly and transitively, or a skill delivered by two prereqs, must not inflate any count or weight.

1. **Ordinal depths → MAX, never SUM.** A K/U/D depth is a level (0–5), not an additive quantity. Both `needed` and `delivered` use MAX. "Delivered twice" collapses to one value. There is no SUM and no additive weight anywhere in the core computation. **This is the root guarantee.**
2. **Unique constraint** `(focal, prereq, sub_competency)` prevents literal duplicate rows; the seeder upserts idempotently.
3. **Diamond dependency** (GC 1040 reached both directly from GC 3460 and via GC 2070): harmless. The per-course gap reads only **direct** edges' attainment, and MAX makes a redundant direct edge's contribution count once (it can only raise the max to a value already present).
4. **Traversal** (deferred chain/program view) uses a **visited-set** DAG walk + a **cycle guard** — bad data introducing a cycle is detected and reported, never infinite-looped or double-summed.
5. **Program-wide aggregation** (deferred) counts **per focal course**, not per edge ("N courses have an unmet incoming need for *X*").
6. **Edges are unweighted in v1.** If an importance weight is ever added, it attaches to the focal course's *need* for *X*, not summed across prereq edges.

**Required regression tests:** a diamond-dependency test, a duplicate-skill-tag test (same *X* from two prereqs), and a redundant direct+transitive test — each asserting the gap result is MAX-based and **stable whether or not the redundant edge is present**.

## What this reuses vs. adds

- **Reuses:** `incomingExpectationSchema`, `snapshotTargetCoverage` (attainment per sub-comp), `analyzeCourseGaps`/`PrerequisiteGap`, `PrerequisiteGapPanel`, the slug-gated admin route pattern, the strict-mode JSON-schema discipline + walker-test pattern.
- **Adds:** the `prerequisite_edges` table + migration `0030`, the `prereq-edge-seed` AI function (+ prompt, + function-settings registration, + `PromptName` union entry), the faculty confirm/edit admin UI, the deterministic `computePrereqGaps(courseCode)`, and a per-course gap view wired to it.

## Scope

**In v1 (single focal course):** the data model + migration, the LLM seeder, the faculty confirm/edit UI, `computePrereqGaps`, and a per-course gap view. The whole loop works for one course at a time.

**Deferred (additive, read-only — does NOT change this engine):**
- Program-wide all-courses graph **visualization** + aggregation rollup (runs `computePrereqGaps` across all courses + chain traversal for diagnostics). `computePrereqGaps` is intentionally a clean per-course function the program view can `map` over.
- Chain-level diagnostics ("trace a gap back to its origin course") — traversal over the same direct edges.
- Auto-re-seed on syllabus/prereq-text change.
- Edge importance weighting.

## Open decisions (resolved)

- **Edge source** → LLM-seed + faculty-confirm (locked).
- **Edge richness** → skill-tagged (locked).
- **Transitivity** → direct-only, derived by traversal (locked).
- **Aggregation** → ordinal MAX, no double-count (locked).
- **`unmeasured` status** → assert "not yet measured", not a gap, when the prereq course has no attainment data for *X* (locked, mirrors evidence-ladder honesty).
- **Program-wide** → deferred, additive (locked).

## Success criteria

- A focal course's free-text prerequisites are seeded into structured, skill-tagged, direct edges that faculty can confirm/edit.
- `computePrereqGaps(courseCode)` returns per-sub-competency `needed`/`delivered`/`gap`/`status`, reading only direct edges and prereq-course attainment, using MAX aggregation.
- Listing a prerequisite redundantly (direct + transitive, or the same skill via two prereqs) provably changes no gap result — covered by the three regression tests.
- A cycle introduced by a faculty edit is rejected with a clear message; the traversal (deferred) never infinite-loops.
- The existing `PrerequisiteGapPanel` renders the per-course result, now driven by persisted edges rather than hand-fed prior coursework.
- No partner/position data is required for any of the above (course-side only).

## Related

- [`docs/STATE.md`](../../STATE.md) — Next-steps (step 4 spine); update on build with the new table, AI function (count 19→20), migration 0030, route, and a "spec'd → shipped" flip.
- [`docs/superpowers/specs/2026-06-04-position-capture-v1-prebuild-amendments.md`](./2026-06-04-position-capture-v1-prebuild-amendments.md) — the Q1 demand half (separate, later spec); shares the "keyed to `sub_competency_id`" + ordinal-depth framing.
- Reused symbols: `lib/ai/capture/schema.ts` (`incomingExpectationSchema`), `lib/db/schema.ts` (`snapshotTargetCoverage`, `courses.prerequisites`), `lib/ai/analyze/` (`analyzeCourseGaps`, `gap-analyze.ts`), `lib/domain/types.ts` (`PrerequisiteGap`), `PrerequisiteGapPanel`.
