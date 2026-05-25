# Phase 1B — Scaffolding Analysis Design

**Date:** 2026-05-25
**Status:** Draft for review
**Prerequisites:** Phase 1A Program Coverage Matrix (shipped); productive-failure audit area in CourseCapture (shipped today; data flow once snapshots are re-captured)
**Supersedes:** the Phase 1B sketch in [`2026-05-24-program-coverage-views-spec.md`](./2026-05-24-program-coverage-views-spec.md)

---

## One-line

A program-level view that judges whether each career target's competencies are introduced, practiced, and integrated across the curriculum in the right course-level sequence — including whether productive-failure and reflection scaffolding is placed where the depth progression makes it productive rather than premature.

## Background

The original Phase 1B sketch — "across the full degree plan, judge whether each competency is introduced (K1–2), practiced (K3–4 / U2–3 / D2–3), and brought to integration (U4–5 / D4–5) in the right course-level sequence" — captures only half the picture. It judges whether the depth scaffolding is sequenced correctly. It does not judge whether the *pedagogical scaffolding* needed to produce problem-solving competence is sequenced correctly.

The new audit area in CourseCapture (Audit Area 7, productive-failure and reflection conditions, shipped 2026-05-25) surfaces per-course findings on whether the conditions for problem-solving development are present, partial, or absent. The Scaffolding Analysis is the right place to read those findings across the program and ask whether they're placed productively.

The Background document's §8 ("Problem-solving as a program-level emergent property") establishes the doctrinal position. This spec operationalizes it.

## Two analytical primitives

Phase 1B reads each career target's sub-competencies against the full set of confirmed snapshots and answers two distinct questions per sub-competency.

### Primitive 1 — Depth-sequence scaffolding

The original scaffolding question. For each sub-competency, look at the courses that contribute to it (ordered by program sequence, ideally by Act 1 / 2 / 3 placement) and ask:

- **Introduction phase.** Are there earlier-program courses where the sub-competency is touched at K=1–2 or U=1–2 (the "heard of it / can explain it back" range)?
- **Practice phase.** Are there mid-program courses where the sub-competency is developed at K=3–4 / U=2–3 / D=2–3 (the "uses correctly with reference" range)?
- **Integration phase.** Are there upper-program courses where the sub-competency reaches U=4–5 / D=4–5 (the "adapts to novel cases / performs creatively" range — i.e., the problem-solving facet)?

Findings: `brittle-scaffold` (an upper-division course expects mastery of something never introduced or never practiced), `top-heavy` (introduced and integrated but no practice phase), `coverage-only` (touched everywhere at shallow depth, never reaches integration), `well-scaffolded` (all three phases present in sequence).

### Primitive 2 — Productive-failure and reflection sequencing

The new question this spec adds. For each sub-competency, look at the courses that contribute and ask:

- **Where in the depth progression are productive-failure conditions first introduced?**
- **Are they introduced at a depth where the failure is productive rather than premature?**
- **Is reflection scaffolding present in the upper-division courses where the cumulative pattern should consolidate?**

These questions are answered by reading each contributing snapshot's `audit_notes.productive_failure_conditions` block (the structure shipped today) alongside its K/U/D depth values, and aggregating across the program.

The key design commitment from this spec: **degrees, not thresholds.** The earlier draft of this design suggested a binary minimum ("productive failure introduction is warranted once a competency has reached D=2–3 in some prior course; expecting it at D=0–1 is premature"). That framing is wrong. The literature (Sinha & Kapur 2021; Sinha et al. 2023) does not establish a discrete threshold; it establishes that productive failure works in degrees, with depth as a contribution-weight rather than a gate. Productive failure at low base depth still contributes — every cycle builds dispositional habit — just less per cycle than productive failure at high base depth.

The analysis weights contributions accordingly (see "Scoring" below) rather than gating them at a threshold.

## Data sources

All inputs read-only from existing tables. No new tables, no schema additions.

| Source | What's read |
| --- | --- |
| `course_capture_snapshots` | Per-snapshot K/U/D depth values per competency; the `audit_notes.productive_failure_conditions` block; the `verification_summary` for human-readable framing |
| `snapshot_target_coverage` (Phase 1A) | Per-cell coverage of each career-target sub-competency by each snapshot — depth values, matched competency, confidence |
| `careerTargets` and `subCompetencies` | The target's structure: which sub-competencies exist, their K/U/D descriptors, their dependency relationships |
| `courses` and `courses.prerequisites` | Program-sequence ordering: which courses come before which, by catalog prerequisite structure |

Snapshots taken before 2026-05-25 will not have `productive_failure_conditions` populated (the Zod schema treats it as optional). The analysis must tolerate `undefined` and surface "no productive-failure data" as a distinct state from "absent." Re-captures shipped after the field rolls out will populate it.

## Scoring

Two scores per (career target × sub-competency) cell, plus an aggregate program-level signal.

### Depth-scaffolding score (Primitive 1)

`depth_phases_present`: object with three booleans — `introduction`, `practice`, `integration` — derived from whether any contributing snapshot has K/U/D values in the corresponding ranges.

`scaffolding_status`: one of
- `well_scaffolded` — all three phases present in the right course-sequence order
- `top_heavy` — introduction and integration present, practice missing
- `bottom_heavy` — introduction and practice present, integration missing
- `coverage_only` — present at shallow depth across multiple courses, never reaches integration
- `brittle_scaffold` — integration expected before introduction or practice in the course sequence
- `not_addressed` — no contributing snapshot reaches even K=1

### Productive-failure-sequencing score (Primitive 2)

For each contributing snapshot to this sub-competency, compute a per-snapshot contribution:

```
snapshot_contribution = 
    conditions_score(snapshot.productive_failure_conditions) 
  * depth_weight(snapshot.max_d_for_this_subcomp)
  * reflection_weight(snapshot.productive_failure_conditions.structured_post_mortem)
```

Where:

- `conditions_score` ranges 0–1: count of `present` (weight 1.0) + `partial` (weight 0.5) across the four condition fields (`generate_then_consolidate`, `open_ended_problems`, `revision_cycles`, `structured_post_mortem`), normalized to 0–1. A course with all four present scores 1.0; one with two `partial` and two `absent` scores 0.25.
- `depth_weight` ranges 0–1 and grades the contribution by the depth at which productive failure occurs: D=0 → 0.0, D=1 → 0.15, D=2 → 0.35, D=3 → 0.60, D=4 → 0.85, D=5 → 1.0. Non-linear because lower depths still contribute (degrees, not thresholds), but the upper depths carry disproportionate weight per the cognitive-load-theory account: more domain schema means more learning per failure cycle.
- `reflection_weight` ranges 0.5–1.0: a course with `structured_post_mortem: present` doubles its raw conditions contribution (1.0); `partial` is 0.75; `absent` is 0.5. The asymmetry reflects the Tannenbaum & Cerasoli meta-analysis: reflection isn't optional add-on — it's the mechanism that converts raw struggle into transfer. A productive-failure course without reflection contributes, but at half-effectiveness.

Sum across all contributing snapshots → `cumulative_pf_score` per cell (unbounded but in practice 0–3 or so).

`pf_status`: one of
- `well_developed` (cumulative ≥ 1.5 with at least one upper-depth contributor)
- `developing` (cumulative 0.5–1.5)
- `thin` (cumulative 0.1–0.5)
- `absent` (cumulative < 0.1, including when no snapshots have populated the field)

### Program-level rollups

Per career target:

- **Depth-scaffolding distribution** — count of sub-competencies in each `scaffolding_status` category.
- **Productive-failure capacity** — mean `cumulative_pf_score` across the target's sub-competencies, weighted by sub-competency importance if the target descriptor includes priority signals.
- **Diagnostic combinations** — three named patterns the analysis surfaces:
  - **Unproductive success** — sub-competencies where depth is `well_scaffolded` (the program reaches D=4–5) but `pf_status` is `absent` or `thin` (no productive-failure scaffolding in the contributing courses). This is Kapur's 2016 "unproductive success" pattern at the program scale: the curriculum produces apparent depth but through repetitive familiar-problem practice rather than productive struggle. Graduates can perform on known problems and freeze on novelty. The most consequential program-level finding the analysis is designed to surface.
  - **Premature pedagogy** — sub-competencies where `pf_status` is `well_developed` but depth `scaffolding_status` is `coverage_only` or `bottom_heavy`. The curriculum has the right pedagogical structure but never builds the depth base for the failure to be productive.
  - **Coverage-without-integration** — sub-competencies touched in many courses at shallow depth (1–2) and never brought to U=4–5 or D=4–5. The cumulative pattern shows program breadth but no integration; problem-solving capacity is correspondingly thin even if every course "covers" the competency.

### Sub-competency type — technical vs. horizontal-knowledge interpretation

The Sinha & Kapur (2021) meta-analysis found productive-failure effects strongest for settled-technical-knowledge domains (mathematics, physics, biology) and reversed for domain-general skills. This implies different interpretations of the same scaffolding diagnostic for different parts of the GC curriculum:

- **Settled-technical sub-competencies** (color science, press operation, file preparation, typography fundamentals, production workflow): the productive-failure conditions have the strongest evidence base. A high `cumulative_pf_score` here is a strong positive program signal; the unproductive-success diagnostic is a strong negative signal.
- **Horizontal-knowledge sub-competencies** (brand strategy, creative direction, editorial judgment, account management judgment): the meta-analytic evidence is mixed and some research suggests instruction-first works better than struggle-first for cross-domain conceptual skills. The conditions still matter — open-ended ill-structured problems and structured post-mortem in particular — but a low `cumulative_pf_score` in this zone is a weaker negative signal than in the technical zone.

The analysis surfaces the type-of-sub-competency annotation alongside the diagnostic. The classification is determined by the target's sub-competency descriptor (which may need a `knowledge_type: technical | horizontal | mixed` field added in a future iteration); for v1, the AI narrative-generation prompts can be asked to classify on the fly using the sub-competency K/U/D descriptors as evidence.

## Views

### View 1 — Per-target scaffolding strip

A horizontal scrolling view at `/program/scaffolding?target=<id>`. Each sub-competency is one row; columns are the courses in program-sequence order. Cells show:

- **Background color:** the snapshot's D depth for this sub-competency (the existing Phase 1A color ramp).
- **Top-left badge:** condition score for that course (a colored dot — green/yellow/red — indicating present/partial/absent across the productive-failure conditions).
- **Top-right badge:** reflection indicator (a small "R" if `structured_post_mortem: present`, hollow if `partial`, absent if absent).

Right margin of each row shows the per-sub-competency `scaffolding_status` and `pf_status` chips with their cumulative scores.

### View 2 — Brittle-scaffold list

A read-out at `/program/scaffolding?lens=brittle`. Lists every sub-competency where:

- Integration phase is expected (the target's K/U/D descriptors include D=4–5 or U=4–5 territory) AND
- The course-sequence order shows the integration course running before introduction/practice OR
- The cumulative `pf_status` is `absent` or `thin` while depth `scaffolding_status` is `well_scaffolded` (the depth-without-pedagogy diagnostic flagged above)

Each row is a one-paragraph narrative: which sub-competency, which courses contribute, what's missing, where to add it. The narrative is AI-generated from the underlying scores, surfaced for faculty review.

### View 3 — Course-contribution summary

A read-out at `/program/scaffolding?lens=course-contributions`. For each course (sorted by program-sequence position), shows what role it plays in the program's scaffolding:

- **Domain-depth contributor:** the course brings sub-competencies to D=3 or higher
- **Productive-failure venue:** the course has `generate_then_consolidate` + `open_ended_problems` + `revision_cycles` all present (or 2-of-3 with `partial` on the third)
- **Reflection venue:** the course has `structured_post_mortem: present`
- **Integration venue:** the course brings sub-competencies to D=4 or D=5

A single course can be multiple of these. The view surfaces which courses are doing disproportionate work in each category, and which categories are thinly served across the program.

## AI usage

Phase 1B is mostly aggregation — the scoring rules above are deterministic from the snapshot data and `snapshot_target_coverage` cells already produced by Phase 1A. AI is used in two places:

1. **Narrative generation for View 2 (brittle-scaffold list)** — one short call per flagged sub-competency, ~150 tokens out. Default tier: light (gpt-5.4-mini). The function ID: `program-scaffolding-narrative`.
2. **Aggregate framing across views** — one call per career target to synthesize the per-target headline ("for Brand Strategy, the program reaches integration depth on N of M sub-competencies but only N' of M have productive-failure scaffolding in the contributing courses…"). Default tier: light. Function ID: `program-scaffolding-summary`.

No new AI calls per refresh of the existing matrix data — the heavy AI work is upstream in CourseCapture and in the Phase 1A scorer.

## Out of scope for Phase 1B

- **Prerequisite-gap analysis (Phase 1C)** — distinct view, distinct primitive. Phase 1B answers "does the program develop this competency well?"; Phase 1C answers "does the prior coursework students take actually support what the focal course expects?"
- **Advising view (Phase 1D)** — per-student/per-target sequencing recommendation. Phase 1B feeds it but doesn't deliver it.
- **Cross-snapshot diff** — comparing two snapshots of the same course over time. Phase 2 feature.
- **What-if at program scale** — Explore-style what-if scenarios applied to the full curriculum (rather than one snapshot). Phase 2 feature.

## Implementation notes

- The depth-phase derivation (Primitive 1 status) is pure SQL/TypeScript; no AI call needed once the matrix data exists. Implement as a query that joins `snapshot_target_coverage` with `courses` ordered by prerequisite-chain depth.
- The productive-failure aggregation (Primitive 2) requires reading the `productive_failure_conditions` blob out of each snapshot's profile JSON. Add a denormalized view if performance becomes an issue at scale.
- The `pf_status` thresholds (0.1, 0.5, 1.5) are initial defaults. Tune as real data accumulates. They are not the binary thresholds the early draft proposed — they are descriptive bands over a continuous score that's already weighted by depth degrees.
- View 1 (scaffolding strip) is the load-bearing UI. Views 2 and 3 are derived from it and could be implemented as filters/lenses on the same underlying data.

## Success criteria

After Phase 1B ships and at least 6–10 courses have been re-captured with the productive-failure audit area populating:

- The per-target scaffolding view surfaces at least one previously-invisible structural finding ("competency X is well-scaffolded on depth but has no productive-failure venue between Acts 1 and 3") that maps onto a real faculty concern.
- The brittle-scaffold list identifies at least one sub-competency where the depth progression looks fine but the cumulative `pf_status` is `absent` — and curriculum committee finds the diagnosis defensible enough to discuss.
- The course-contribution summary makes legible which courses are doing the program's problem-solving formation work, surfacing courses that are doing disproportionate (and possibly unrecognized) lifting.

Anti-success: the views produce noise that faculty can't act on, or the productive-failure scores look uniformly high (suggesting the capture probe is too lenient and should be tightened).

---

## Related

- [`2026-05-24-program-coverage-views-spec.md`](./2026-05-24-program-coverage-views-spec.md) — the umbrella spec for Phase 1A–D
- [`../background.html` §8](../../background.html#problem-solving) — the theoretical case for problem-solving as a program-level emergent property
- [`../../lib/ai/prompts/capture-chat.md`](../../../lib/ai/prompts/capture-chat.md) — Audit Area 7 source
- [`../../lib/ai/capture/schema.ts`](../../../lib/ai/capture/schema.ts) — the `productiveFailureConditionsSchema` definition
