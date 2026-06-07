# Demand → Coverage Sufficiency Seam — Design (2026-06-07)

**Status:** approved (design Q&A 2026-06-07). Build-ahead on branch `audit-remediation-2026-06-07`; migration written-but-not-applied; all new behavior flag-gated (`DEMAND_COVERAGE_SEAM`); nothing surfaced to faculty or run against the live DB until explicit sign-off.

Append-only. Supersede with a new dated file; do not edit.

## Purpose

Close the unstated **Q1-sufficiency seam**: for each career target, compare what employers *demand* (K/U/D depth, from Position Captures) against what the curriculum *delivers* (attainment, from `snapshot_target_coverage`). The difference is the sufficiency signal that answers "how well does the GC curriculum build students toward the careers we claim to prepare them for?"

This is **demand-measurement** (employer-evidenced), kept distinct from **definition-refinement** (`partnerSubmissions → proposedKUDEdits`, which refines what a target *should be*). Only demand-measurement feeds sufficiency.

## Grain & data realities (verified against the code)

- A Position Capture's demand is `profile.qualifying_competencies[]`, each with `required_for_success.{k_depth,u_depth,d_depth}` (nullable ints 0–5) **and a nullable `sub_competency_id`** (captured at interview time). The `sub_competency_id` is the join key to the target's structured `subCompetencies`. Competencies with `sub_competency_id = null` are unmapped employer-named competencies — **excluded** from the sub-competency rollup in v1 (future: surface as "unmapped demand").
- `careerTargetKudAggregate` is a markdown blob keyed by `careerTargetId` — it has **no** per-sub-competency numerics. So demand numerics need a **new table**, not a column add.
- Attainment already lives per `(snapshotId, careerTargetId, subCompetencyId)` in `snapshot_target_coverage` (`kDepth` nullable, `uDepth` nullable, `dDepth` non-null).
- `partners.weight` is an `integer NOT NULL DEFAULT 1` — the per-partner multiplier faculty set to reflect employer importance/representativeness.

## Locked decisions

1. **Demand surface:** `positionCaptures → career_target_demand` (new). `partnerSubmissions/proposedKUDEdits` stays separate.
2. **Demand aggregation (per target, per sub-competency, per dimension):** **partner-weighted average** over contributing positions (decision 2a — weight by `partner.weight` only; a company's influence is whatever weight faculty assign it; no company-normalization in v1):
   ```
   demand_x = Σ(weightᵢ · xᵢ) / Σ(weightᵢ)      x ∈ {k,u,d}
   ```
   over submitted, non-retired, interviewed positions for the target whose `qualifying_competencies` include a competency mapped to that `sub_competency_id` with a non-null depth `xᵢ`. If `Σweight = 0` → fall back to unweighted mean (never divide by zero). Result is **fractional** (numeric/real), preserved (not rounded) so a 3.4-vs-3 shortfall is visible.
3. **Attainment aggregation:** ordinal **MAX** of `snapshot_target_coverage` cells across the current contributing snapshots per `(target, sub-competency)` (same ordinal-MAX discipline as `prereq-gaps`; attainment is "the deepest a course actually reached", which must not be averaged).
4. **No-data discipline (load-bearing — mirrors `prereq-gaps` and the evidence-above-zero rule):**
   - no contributing positions for a dim → `no_demand` (never "0 demand → sufficient").
   - demand present but attainment dim null → `no_coverage` (demanded, but curriculum coverage unmeasured — a *caution*, not a fabricated full gap).
   - both present → `gap = max(0, demand − attainment)`; `gap` if > 0 else `met`.
5. **Metric:** per `(target, sub-competency, dimension)`: `{ demand, attainment, gap, status }` with `status ∈ {met, gap, no_coverage, no_demand}`. Sub-competency rollup status: `gap` if any dim is `gap`; else `no_coverage` if any dim is `no_coverage`; else `met` if any dim is `met`; else `no_demand`.
6. **Storage:** new table `career_target_demand` — PK `(career_target_id, sub_competency_id)`; `k_demand/u_demand/d_demand` `numeric` nullable; `contributing_position_ids` jsonb; `generated_at`. Populated by a demand-rollup function invoked alongside `regenerateAggregate`.
7. **UI:** read-only **sufficiency panel on the per-target page** (`app/admin/synthesis/targets/[targetId]`), behind `DEMAND_COVERAGE_SEAM`. Not on faculty capture surfaces. Shows per-sub-competency demand vs attainment, the gap, and the `no_coverage`/`no_demand` cautions, with an evidence note.
8. **Scope (build-ahead):** migration file written, **not applied** to the live DB; all read/write of `career_target_demand` and the UI panel gated by `DEMAND_COVERAGE_SEAM`; the sufficiency engine is a **pure function** (no DB) with full unit tests against seeded weighted inputs; DB plumbing is thin and mock-tested. Nothing activates until sign-off.

## Components

- `lib/program/sufficiency.ts` — pure engine: `computeSufficiency(demandRows, attainmentRows) → SubCompetencySufficiency[]`. No DB. Fully unit-tested (weighting handled upstream; engine takes already-aggregated demand + attainment, or takes raw position competencies + weights and does the weighted average — TBD in plan; leaning: engine does the weighted-average so it's the tested unit).
- `lib/db/career-target-demand-queries.ts` — `upsertTargetDemand`, `getTargetDemand(targetId)`. Mock-tested.
- demand rollup — `lib/ai/position-capture/demand-rollup.ts` (deterministic, no AI): reads submitted positions + partner weights, computes weighted demand per sub-competency, writes `career_target_demand`. Invoked next to `regenerateAggregate` (gated).
- migration — `drizzle/NNNN_career_target_demand.sql` (additive `CREATE TABLE`), not applied.
- UI — `SufficiencyPanel.tsx` on the per-target page, gated.

## Out of scope (v1)

Unmapped (`sub_competency_id = null`) demand aggregation; AI-assisted competency→sub-competency mapping; company-normalized weighting (decision 2b); writing sufficiency into `snapshot_target_coverage`; any faculty-capture-surface display; activating against the live DB.
