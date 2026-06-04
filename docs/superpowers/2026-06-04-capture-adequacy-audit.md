# Capture Adequacy Audit — Course + Career vs. the Vision

> **Date:** 2026-06-04 · **Status:** findings (reference doc; informs the upcoming unified-coverage-layer spec and the Position Capture v1 pre-build changes).
>
> **Method:** two multi-agent audits (ultracode). Each fanned out parallel source-readers (Sonnet) over the vision/background/problem-solving/three-act docs, the capture schemas + prompts, and the integration layer; an Opus synthesis named gaps; an adversarial verification pass refuted weak gaps (refute-by-default); a final report used only confirmed gaps.
> - **Career-level audit:** 17 agents · 6 confirmed / 4 refuted.
> - **Course-level audit:** 18 agents · 8 confirmed / 3 refuted.
>
> This doc is the durable synthesis of both (the raw run outputs were ephemeral). Evidence is file:line-grounded throughout; severities reflect the adversarial pass's honest framing (e.g., "unbuilt Phase 1C prerequisite" is distinguished from "regression in shipped behavior").

---

## TL;DR

The two driving vision questions are only **partially** answerable today, for one root reason that spans both capture engines:

> **Both CourseCapture and the (career) capture strand their KUD+ judgments in free-text / JSONB prose instead of FK-keyed rows in the coverage space.** Course attainment is the exception — it *is* keyed to `sub_competency` IDs and is structurally sound. Everything else (career demand, incoming-expectations, prerequisite edges) is reconstructed by LLM/regex on demand and never persisted as a queryable edge.

| Vision question | Status | Binding constraint |
| --- | --- | --- |
| **Q1 breadth** — is the competency covered? | ✅ computable | — |
| **Q1 sufficiency** — is the depth *enough* for the career? | ❌ uncomputable | catalog `sub_competencies` are prose-only (no numeric demand); career demand is free-text, unkeyed, orphaned from the matrix |
| **Q2** — do prerequisites support what the course expects? | ⚠️ partial | prereq link is free-text (no FK); only one manual, LLM-fuzzy, *downstream* comparison path exists; focal prereq-gap is unbuilt (Phase 1C) |
| **Problem-solving formation** | ⚠️ weakest-captured | productive-failure block optional + ambiguous; reflection unevidenced and double-counted; grain leaks |

**Where problem-solving fits:** it is the emergent, program-level property the whole KUD+ → coverage → scaffolding stack exists to surface (depth × productive-failure × structured-reflection, computed by Phase 1B — never stored as a per-course score). It is also the **most under-captured thing relative to its centrality**, so it gets its own section below.

---

## Course-level verdicts (CourseCapture vs. the vision)

### Q1 — sufficiency of attainment: **SUBSTANTIALLY MET, one evidence-discipline soft spot**

CourseCapture records exactly the KUD+ structure Q1 needs. `captureCompetencySchema` (`lib/ai/capture/schema.ts:95-124`) carries independent `k_depth`/`u_depth`/`d_depth` (0–5), per-dimension `evidence_k/u/d`, rationale, and (v2) source/citations. **Evidence-above-zero is genuinely schema-enforced** via Zod `.refine()` (`k_depth>1`→`evidence_k`, `u_depth>0`→`evidence_u`, `d_depth>0`→`evidence_d`, lines 113–124), and foundationals force `null` K/U (line 110), correctly separating "scored zero" from "not applicable." Grain is right: per-competency, per-dimension, per-snapshot, immutable-versioned, with `inputsMeta` provenance.

**Soft spot:** the refinements require only a non-empty *string*, not a *resolvable citation*. A snapshot with `d_depth=5, evidence_d="students produced excellent work"` passes validation. `k_depth=1` needs no evidence at all (line 114), and the stronger v2 `CaptureProfileCitation` contract (lines 52–77) is `.optional()` on competencies (line 107). So the depth substrate is sound, but the evidence *quality* guarantee is only as strong as synthesizer output + faculty review.

### Q2 — prerequisite support: **PARTIALLY COMPUTABLE, NOT STRUCTURALLY LINKED**

The data exists but the prereq→course connection is reconstructed at query time, never stored. `courses.prerequisites` is free text (`lib/db/schema.ts:87`, no FK, no and/or logic; only interpreter is a `COURSE_CODE_RE` scrape in `app/api/capture/[code]/snapshots/route.ts:62`). The only persisted linkage is `courseCaptureSnapshots.inputsMeta.prereqSnapshotsUsed` (`schema.ts:356`) — a context-pointer list, not a competency mapping. `incoming_expectations` (`schema.ts:161-173`) has the right shape (statement, `expected_depth{k,u,d}`, `evidenced_by`, confidence) but no canonical ID tying an expectation to a prereq competency.

One genuine structured path exists — `compareSnapshotToTarget` (`lib/ai/analyze/explore-compare.ts:107`) — but it is **downstream-direction**, matches on a free-text `matched_snapshot_competency` (line 47, LLM-fuzzy), and requires manual faculty initiation in Explore. The focal-course Q2 as literally posed is **unbuilt (Phase 1C)**.

### Problem-solving / scaffolding inputs: **THIN, OPTIONAL, UNDER-PROBED — the weakest area**

The `productive_failure_conditions` block (`schema.ts:134-142`) has the right shape (the four conditions + `max_supporting_depth` + notes), but:

1. **"Not probed" collapses into "absent."** The block is `.nullable().optional()` (`schema.ts:153`); the two output paths disagree — `capture-synthesis.md:172-182` omits it when Area 7 wasn't probed (silence = unknown), while `capture-scores.md:213` forces the four enums required (defaults toward `absent`). At scoring, both null and missing map to `conditionsScore` 0 (`scaffolding-queries.ts:127,144`; `scaffolding.ts:58-62`), rendering unprobed as "absent · 0.00." This **directly violates** the scaffolding spec, which mandates a distinct "no data" state (`2026-05-25-scaffolding-analysis-design.md:61`).
2. **Problem-solving probing isn't enforced.** Readiness (`captureReadinessSchema`, `schema.ts:254-259`) never gates on Area 7; generation is gated only on `canGenerate` = one assistant turn (`CaptureChatPanel.tsx:329`). A profile can ship having never probed productive failure.
3. **Reflection is unevidenced and double-counted.** `structured_post_mortem` is a lone present/partial/absent enum (`schema.ts:138`) with no required citation — yet it feeds both `conditionsScore` *and* the 0.5–1.0 `reflectionWeight` multiplier (`scaffolding.ts:81-83`), so a generic journal mis-rated "partial" inflates the course's problem-solving contribution ~50%. The "generic reflection doesn't count" calibration lives only in `capture-chat-agent.md:596`, not in the prompts that write the stored value.
4. **Course-level grain leaks.** The PF block is one object per snapshot, applied to every sub-competency cell (`scaffolding-queries.ts:144`). `depthWeight` is per-cell, so the inflation is bounded to nonzero-depth cells with genuinely weaker real PF exposure — but it still distorts the flagship *unproductive-success* / *premature-pedagogy* diagnostics, rendered per-cell with no disclaimer.

**Refuted (do NOT act on):** (a) "3-Act inferred from `courses.level` misclassifies GC 4060/4400" — there is no `act` field; brittle-scaffold orders by `sequenceIndex`, not acts/levels. (The real residual is level-then-alphabetical sequencing vs. prerequisite-chain order — an acknowledged Stage-2 TODO.) (b) "Forward graph is prose-only" — the downstream graph is built deterministically by inverting parsed prereq edges + structured `incoming_expectations` (`build-downstream/route.ts`). (c) `max_supporting_depth` corruption — the field is currently dead/unused by all analysis code (latent, not active).

---

## Career-level verdicts (career capture vs. the vision)

> Context: CareerCapture v1 was a **non-functional prototype** (one employer trial failed). The forward build is **Position Capture v1** (drafted plan, not yet built). The audit assessed the plan, not the prototype, as the live target.

### Commensurability: **partial and at risk — same scale, wrong grain, demand axis absent**

- **Scale compatible.** Position Capture v1 emits K/U/D 0–5 against the same `depth-scale.md` rubric the course side uses; unit-for-unit a position competency and a course competency are formally comparable.
- **Grain mismatched (core problem).** The coverage matrix is keyed `(snapshotId, careerTargetId, subCompetencyId)` and scores against catalog `sub_competencies` prose descriptors (`lib/db/schema.ts:18-28`; `lib/ai/analyze/program-score-coverage.ts:83-90`). The planned position profile's `qualifying_competency` names are **free-text with no `sub_competency_id` key** — no crosswalk is designed. Demand and attainment don't join.
- **Demand axis absent from the catalog.** `sub_competencies` carry only prose — **no `k_demand`/`u_demand`/`d_demand` integers**. `scoreSnapshotAgainstTarget()` has no demand parameter (`program-score-coverage.ts:71-91`). Until numeric entry-level demand exists at sub-competency grain, **Q1 sufficiency is uncomputable**; the tool answers coverage *breadth* only.
- **Page-5 Likert mismatch.** The 1–7 importance ratings (`ratedSkills` JSONB) are not K/U/D and route to no sub-competency weight (plan defers, line 2876).

### Integration: **orphaned today, and the forward plan doesn't fix it**

`career_captures` is read only by its own schema/queries, the admin synthesis page, and the partner UI — **no file in the scoring path reads employer demand.** `scoreSnapshotAgainstTarget()` receives course evidence + prose descriptors only. Position Capture v1 re-homes the data (`career_captures`→`position_captures`, adds `career_target_kud_aggregate`) but keeps it on a parallel track: the aggregate is a deterministic Markdown side-by-side read by faculty eyes, never joined into `snapshot_target_coverage`, never used to seed/validate the descriptors or supply numeric demand. **After PC v1, employer demand will be captured well but still orphaned.**

**Refuted (do NOT act on):** treating "profile competencies not keyed to sub-competency IDs" as a *decide-now critical blocker* (it's deferred-with-rationale and blocks nothing v1 attempts — the real move is an *additive* nullable FK seam); "foundational null-vs-zero not enforced demand-side" (no foundational discriminator exists to attach a rule to; v2 note); "SOC-code / O*NET validation missing" (no O*NET integration exists; unbuilt spec work).

---

## The through-line — one root cause, one strategic fix

Every major gap is the same shape: **a KUD+ judgment that should be an FK-keyed row in the coverage space is instead free-text / JSONB reconstructed on demand.**

- Course attainment → keyed to `sub_competency` IDs ✅ (the one part that works).
- Career demand → free-text, no key, no numeric demand, orphaned ❌.
- `incoming_expectations` (Q2) → JSONB, no canonical link to prereq competencies ❌.
- Prerequisite edges → free-text `courses.prerequisites`, regex-scraped ❌.
- Productive-failure / reflection → optional block, ambiguous "no data," course-level grain ❌.

**Recommended strategic spine: a unified target-coverage layer.** One canonical `sub_competency_id` key; numeric per-dimension *demand* on `sub_competencies` (entry-level/day-one anchored); promoted derived rows for course attainment, career demand, and incoming-expectation→prereq alignment — in **one migration**. Then breadth, Q1 sufficiency, and Q2 all read from one queryable layer instead of three reconstruction paths. The course side already proves the pattern; the work is promoting the other judgments into it. *(This is the subject of the follow-on brainstorm/spec.)*

---

## Prioritized fixes (combined)

### Critical
- **PF data-presence sentinel + unified output shape.** Add a `not_probed`/`probed` marker; make `capture-synthesis.md` and `capture-scores.md` emit identical structures; teach the scaffolding scorer + strip a "no data" state distinct from `absent`. Closes the spec violation (`2026-05-25-...:61`).
- **Numeric demand at sub-competency grain + a canonical join key.** Add `k_demand`/`u_demand`/`d_demand` (K/U nullable, `d_demand` required) to `sub_competencies`, entry-level-anchored; this is what unlocks Q1 sufficiency. Pair with a canonical `sub_competency_id` on promoted demand/attainment rows. *(Strategic spine.)*

### Important
- **Gate generation on Area 7 having been probed** (even to record "all absent"), or add a required probe-coverage map to readiness.
- **Citation-backed evidence floor.** Tie above-threshold depths (e.g., `d_depth≥3`) *and* any `structured_post_mortem` above `absent` to ≥1 resolvable `CaptureProfileCitation`; repeat the generic-vs-structured reflection calibration in synthesis/scores prompts. One mechanism fixes the Q1 soft spot + the reflection multiplier.
- **Persisted prerequisite edge + automated Q2 pass.** Parse `courses.prerequisites` (and/or logic) into a `course_prerequisites` table with FKs; persist per-competency `incoming_expectation → prereq competency` alignment; run a focal-prereq comparison on snapshot confirmation, emitting "prereq not captured — cannot evaluate" where missing (reuse the `skipped[]` pattern from `build-downstream`).
- **Position Capture v1 pre-build changes** (cheap now, expensive later): add a nullable structured `sub_competency_id` FK to each qualifying competency; persist Page-5 ratings keyed to `sub_competency_id` (defer the math, not the contract); re-anchor `required_for_success` to "day-one entry level" (restore the semantics lost in the `expected_on_day_1`→`required_for_success` rename) and keep `trajectory` out of the scored KUD; add a schema-level evidence/confidence discipline to demand; *design* (not necessarily build) the demand→matrix seam.
- **PF grain disclaimer.** Course-level disclaimer on the PF dot in the strip, or move toward per-cluster PF annotation.
- **Descriptor-edit invalidation** (career-audit find, present-day bug): editing a `sub_competency` descriptor must mark dependent `snapshot_target_coverage` rows stale + trigger re-score (`app/api/targets/[id]/sub-competencies/[scId]/route.ts` currently doesn't).

### Minor
- Server-derive `max_supporting_depth` from validated D-depths, or mark it informational-only.
- Add industry-context to the per-position aggregate; optionally a single-source/multi-source cue (do **not** invent an N≥3 "validated" badge — no such rule exists).

---

## Suggested sequencing

1. **Problem-solving capture fix** (Critical PF sentinel + Important gates 3/4) — most program-important, mostly self-contained, closes a spec violation.
2. **Position Capture v1 pre-build tweaks** — before that build starts.
3. **Unified coverage/demand layer + persisted prereq edges** — the strategic spine; one shared migration; unlocks Q1 sufficiency and Q2. *(Brainstorm/spec next.)*

## Evidence file index
`lib/ai/capture/schema.ts` · `lib/ai/prompts/capture-{scores,synthesis,chat-agent}.md` · `lib/ai/prompts/shared/depth-scale.md` · `lib/db/schema.ts` · `lib/db/scaffolding-queries.ts` · `lib/program/scaffolding.ts` · `lib/ai/analyze/explore-compare.ts` · `lib/ai/analyze/program-score-coverage.ts` · `lib/ai/employer-capture/schema.ts` · `app/api/capture/[code]/snapshots/route.ts` · `app/program/scaffolding/ScaffoldingStripClient.tsx` · `app/api/targets/[id]/sub-competencies/[scId]/route.ts` · `docs/superpowers/specs/2026-05-25-scaffolding-analysis-design.md` · `docs/superpowers/plans/2026-06-04-position-capture-v1.md`.
