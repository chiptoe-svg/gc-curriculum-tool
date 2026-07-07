# Explore — Close the Loop (Adopt a Scenario)

**Date:** 2026-07-07
**Status:** Design approved (brainstorm) — implementation plan not yet written. **Build sequenced after Plan 2** (the thinking-partner agent + UI, which provides the adopt trigger and is where scenarios are surfaced). This spec captures the design now, while the context is fresh.
**Depends on:** the merged Explore domain core (`Scenario` object + `course_explore_scenarios`, `lib/ai/explore/*`) and the Capture draft/snapshot machinery (`course_capture_profiles` = working draft; `course_capture_snapshots` = immutable snapshots; `loadSnapshotAsDraft`).

---

## Problem

Explore lets faculty design a course change and predict its effects (the `Scenario` object). But a scenario is a hypothetical — it never becomes the course. This spec closes the loop: how a scenario becomes the course's next *current version*, with its own learning objectives and required skills, **without** violating the tool's evidence-above-zero rule (a predicted depth is not a measured one).

## The key distinction

"Becomes the new current version with its own learning objectives and required skills" bundles two things that graduate by different paths:

- **Design** — learning objectives + required incoming skills. These are *intent* (decisions), so a scenario authors them directly.
- **Evidenced KUD depths** — these are *evidence* of what students attained. A scenario can never produce them directly; they come only from teaching the course and re-Capturing. The predicted depths are carried forward as **intended targets** — a separate, first-class artifact — so the loop can later test "predicted vs. measured."

## The lifecycle

```
Explore (design a change) → ADOPT → planned draft (baseline + intended targets
  + revised objectives + required skills + the change) → course is taught →
  next Capture re-scores MEASURED depths from evidence + preserves the targets →
  approve → new evidenced snapshot carrying BOTH measured scores and intended targets
```

A scenario "becomes the course" in the **intent** sense on adopt, and in the **evidenced** sense only after it's taught and re-captured.

## The adopt operation

`adoptScenario(scenarioId)` — the mirror of the existing `loadSnapshotAsDraft`, sourced from a `Scenario`. It seeds the course's working draft (`course_capture_profiles`) and hands off to the normal Capture flow. It:

1. **Loads the baseline** — the profile from the scenario's `baselineSnapshotId` (the evidenced version the scenario was explored against) becomes the draft's starting point, so measured `k/u/d` stay at their evidence-backed values.
2. **Sets intended targets** — for each predicted delta (keyed by competency, resolved by statement match), writes `intended_target = delta.to` on that competency. Measured depths untouched.
3. **Updates the design intent** — folds the change into the course's `revised_objectives_draft`, and adds the scenario's `assumesIncoming` as new/updated required incoming skills (`incoming_expectations`).
4. **Records the planned change** — the change-object (activity + rubric criteria) is attached as a note/material so the Capture interview knows the course now includes it.
5. **Stamps provenance** — `adopted_from_scenario_id` on the draft, which flows onto the snapshot when approved.

The result: the draft is "the planned version" — evidenced baseline + intended targets + revised objectives + updated required skills + the planned change. Adopt only ever *reads* the scenario and *seeds design + targets*; it never writes a predicted number into a measured slot. Capture and the evidence-above-zero rule remain the sole authority over measured depths.

## Data model

Three additions, all nullable/optional so every existing snapshot stays valid:

1. **`intended_target` per competency** on `captureCompetencySchema`: `intended_target: { k: number|null, u: number|null, d: number|null } | null`. Set by adopt from the scenario's predicted `to` depths; `null` where there is no target and on all pre-feature snapshots. For foundational competencies (K/U measured `null`), the target's K/U are `null` too (Do-only).
2. **`adopted_from_scenario_id: string | null`** — profile-level provenance; flows draft → snapshot.
3. **Objectives + required skills** reuse the existing `revised_objectives_draft` + `incoming_expectations` profile fields (no new fields).

### Two load-bearing integration points

- **No strict-scorer change.** The AI scorer (`capture-synthesis`) produces *measured* profiles and never emits `intended_target` — adopt writes it as an overlay afterward. So the field is nullable in the **Zod parse** schema but is **NOT** added to the strict OpenAI **request** schema. This avoids the strict-mode surface entirely.
- **The target must survive re-scoring (the reconciliation merge).** When Capture re-scores a seeded draft, the scorer emits fresh competencies with *measured* depths but no targets. The scoring-apply path (e.g. `apply-reconciliation.ts`) must **merge** — take measured depths / evidence / `*_says` from the fresh score, but **preserve** `intended_target` + `adopted_from_scenario_id` from the seeded draft (matched by competency statement, with the normalized-key matcher from the linkage fix). This merge is what makes "target D4 · measured D3" possible after the course is taught, and it is the one non-obvious requirement.

### The guardrail, structurally

`intended_target` is a *different field* from the measured `k_depth/u_depth/d_depth`. Evidence-above-zero governs only the measured depths (unchanged). A target physically cannot occupy a measured slot, so no workflow — approving without evidence, abandoning the adopt — can launder a prediction into an evidenced score. The honesty is enforced by the data model, not by a process.

## v1 scope

**In:**
- `adoptScenario(scenarioId)` operation (seeds the draft per above).
- The three schema additions + the merge-preservation in the scoring-apply path.
- **Display** the intended target alongside the measured score on the capture review card — the calibration portrait shows "target D4 · measured D3" when a target exists (a small addition to the portrait rendering).

**Out (deferred — real, but not v1):**
- The **"Adopt this scenario" UI trigger** — a **Plan 2** surface (the thinking-partner agent/UI is where scenarios live for a faculty member). v1 exposes adopt as an operation (function + route), harness-testable; the button ships with Plan 2.
- The **program-level reconciliation view** — "across the program, which intended targets did we actually hit?" — a later `/program` increment. v1 stores the data that makes it possible.
- **Target lifecycle rules** (clear-when-met / roll-forward across snapshots) — v1 keeps it simple: a target persists as set until a new adopt changes it.

## Build sequencing

#188's build follows **Plan 2** (which provides the adopt trigger and is where scenarios are surfaced). The schema additions + merge-preservation are the foundational pieces and could land earlier if convenient; the design is captured now regardless.

## Success criteria

A scenario can be adopted → the course's next captured snapshot carries the intended targets → after teaching, "predicted vs. measured" is visible on the course — and nothing predicted ever became a measured score (verified by the structural separation of `intended_target` from the measured depths).

## Open questions carried to the plan

- **New competencies introduced by a change.** If a scenario's change implies a genuinely new competency (not just a delta on an existing one), does adopt add it to the draft with a target and no measured score (measured stays `null` / unscored until evidence)? Likely yes; confirm at plan time.
- **Objectives authoring.** How much of `revised_objectives_draft` adopt writes automatically vs. leaves for the faculty to refine in the Capture interview — a UX detail for the plan.
- **Target display in program views** beyond the capture card — deferred with the reconciliation view.
