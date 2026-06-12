# Vision-Alignment Review — 2026-06-12

> **What this is:** a full alignment audit of the project against its own published vision and background corpus. Method: read the executive brief + all seven linked docs (background, vision, problem-solving deep-dive, three-act deep-dive, graduate-outcome validation, architecture, faculty guide) via four parallel analysis agents; verified the load-bearing code directly (`lib/ai/capture/schema.ts`, `lib/program/sufficiency.ts`, `lib/program/prereq-gaps.ts`, `lib/program/scaffolding.ts`, `lib/db/program-coverage-queries.ts`, `lib/ai/prompts/shared/depth-scale.md`, `lib/ai/prompts/program-score-coverage.md`, the flag-UI chain); ran an outside-in literature check on the six theoretical positions the framework rests on.
>
> **Action items live at the bottom (§6) as a checklist.** Everything above them is the evidence.

---

## Verdict in one paragraph

The engineering is better than the docs claim in places and worse in others — but the deeper finding is an **inversion**: a measurement-grade analytical apparatus sits on top of a data layer that is ~22% populated on the supply side (≈6 of 27 in-scope courses captured as of 2026-06-11) and ~0% populated on the demand side (`career_target_demand` empty; no target meets the project's own N≥3 triangulation rule). Meanwhile the docs' weakest claims are not about code at all — they're about **validity** (a novel psychometric instrument with zero reliability data, doubly AI-inferred) and **trust mechanisms** (the flag/dispute commitment in the executive brief is dead code). The highest-value next moves are not features: a reliability study, a capture-throughput campaign, and a small doc-honesty pass.

---

## 1. Where reality genuinely matches the vision (verified in code)

- **Evidence discipline is schema-enforced, not just prompted.** `captureCompetencySchema` Zod-refines: foundationals must have `k_depth`/`u_depth` null; `k>1` / `u>0` / `d>0` require evidence excerpts (`lib/ai/capture/schema.ts:109-124`). The literature's "floor justification gate" recommendation is already structurally implemented.
- **Citation provenance is genuinely hardened.** Excerpt-only citations rejected at validation; synthetic IDs (`user_3`) fail regex checks; faculty click through to the actual chunk (`CaptureProfileCitation.superRefine`). Closes a hallucinated-provenance class most LLM tools ignore.
- **Null-discipline is consistent across every engine.** `prereq-gaps.ts` (null-delivered ≠ phantom gap; `basis: measured|mixed|intended|none`), `sufficiency.ts` (`no_demand`/`no_coverage` never collapse to zero), `scaffolding.ts` (PF `no_data` excluded from rollups). Ordinal-MAX, never sum. Matches the documented design exactly.
- **The coverage-scoring prompt is state-of-the-art vs. the LLM-rubric-scoring literature**: anchored rubric + per-sub-competency calibration descriptors, Webb-style match tiers, "when in doubt, choose the weaker," never-above-matched-competency cap, calibrated confidence with named uncertainty (`program-score-coverage.md`). The RULERS-style "locked rubric + evidence-anchored scoring" the literature recommends is what this prompt already is.
- **Also real:** descriptor-change staleness invalidation (`invalidateCoverageForSubCompetency`); snapshot immutability; the intended-never-merged binding rule; the acquiescence-bias guard (syllabus confirmation can't upgrade `claimed`); presence-as-sentinel PF capture; the per-cell `model` column.
- The vision corpus's honest-limitations habit is real — most docs flag their own speculative claims. Preserve it.

## 2. Where the docs claim things the code doesn't do

1. **The flag/dispute mechanism is dead code — and the executive brief leads with it.** Brief, "Trust and governance," first commitment: *"Every AI reading is disputable. A 'Flag' button… Flags persist… Patterns of flagged disagreement update the prompts."* Verified: `FlagDialog` ← `ReasoningExpand` ← `PrerequisiteGapPanel`/`CoverageHeatMap` ← `TargetChainResults` ← **mounted nowhere**; `/api/flag` deleted 2026-06-03; nothing calls `insertPrototypeFlag`; the "flags update prompts" loop never existed. What faculty actually have (editable sliders, `reviewerNote`, stress-test) is arguably better — but it is not what the brief promises. Most exposed claim in the most stakeholder-facing document.
2. **Per-instructor variance: faculty guide vs. matrix.** The guide promises the matrix "shows separate rows per instructor for the same course." `getMatrixData` is `DISTINCT ON (course_code) … ORDER BY created_at DESC` — **newest-snapshot-wins**, one row per course, whichever instructor captured last. The architecture doc describes this honestly; the guide doesn't. Underneath: an unresolved *policy* question (what is the program's claim when two instructors diverge?).
3. **Q1 is structurally half-empty and the docs' tense slides.** Demand side empty, seam flag-off, no target meets N≥3. The brief's "built and awaiting activation" is true, but the through-line section reads as if course→curriculum→career is operating. Today the tool computes Q1 *breadth* over ≈6 captured courses, against demand data that doesn't exist.
4. **"Graduate Outcome Validation" can't validate what its title claims.** KUD↔O*NET alignment shows the tool's language resembles occupational-database language — not student attainment, not causal curriculum impact. Body scopes it correctly ("criterion-relevance check"); title oversells. A hostile accreditor reads the title.
5. **Original-spec drift is large and unacknowledged.** The 2025 spec's Proposal system (Official Record/Proposal dual-mode, Change/Impact summaries, accept/reject), three-mode Curriculum Map (Sankey/sequence), Assessment Gates 1–3, four-role model — all absent; the architecture pivoted to capture-and-explore. Probably the right pivot, but no document says "superseded, here's why," and CLAUDE.md still links the spec as if operative.

## 3. Problems with the underlying logic

- **A. Two-stage AI inference chain, zero reliability data at either stage.** Stage 1: synthesis scores course competencies 0–5×3 from materials+interview. Stage 2: `program-score-coverage` re-scores those onto sub-competencies — AI judgment on top of AI judgment. Literature: trained humans hit only κ≈0.68–0.70 on six-level Bloom judgments; LLMs degrade on fine-grained rubric work and show positivity bias; this scale has 216 combinations per competency. The background doc names "two captures of the same course producing divergent profiles" as the failure signal — **never tested**, despite being nearly free to test. Until then every matrix cell has unknown error bars; "the gap is 2" is not a defensible quantity.
- **B. Course-opportunity scores do student-attainment work downstream.** The background doc is honest that a KUD+ score is a *course-opportunity* score; the prereq engine treats prereq MAX-attainment as "what the student walks in with," and scaffolding treats depth sequences as development arcs. Opportunity ≠ retention; passing ≠ competence. The docs make the distinction; the engines and program-level rhetoric quietly drop it.
- **C. The demand side stays the weakest link even after activation.** Same model scoring both sides → correlated bias that cancels or compounds invisibly in the subtraction. JD-derived demand captures hiring-stage aspiration, not verified day-one requirement. Partner-weighted averaging across heterogeneous employers within a target destroys signal the literature says to keep separated (cluster by role type).
- **D. Adoption physics unsolved — the documented #1 killer of curriculum-mapping initiatives.** Individual instructor value is modest; network value needs ~80% capture; the field's record is "maps produced, findings filed, teaching unchanged" absent a forced action loop. Nothing defines: gap found → who must look → by when → what happens next.
- **E. Smaller notes.** K=1's "delivery evidence" floor is soft (module listing ⇒ non-zero cell feeding program views). `source`/`citations` are *optional* on competencies (backward-compat) — provenance discipline is prompt-enforced, not schema-enforced, for new captures. The 3-Act frame is "proposed, not policy" yet already operationalized in scaffolding diagnostics — it tests the framework's own stipulated course-to-act mapping, not an external property.

## 4. Literature check (outside-in) — one-line verdicts

| Position | Verdict |
| --- | --- |
| KUD (Tomlinson) + UbD compatibility | Sound; the 0–5×3 depth extension is the project's own **unvalidated instrument** |
| Rejecting Bloom for cross-program mapping | Well-supported (empirical κ≈0.68–0.70 even with trained raters; K/U/D's separable D axis is the real added value) |
| Problem-solving as domain-embedded | Supported; but Kapur effect sizes are math/physics-heavy — suggestive warrant for GC, not proof |
| Evidence-discipline rule | Classical construct-validity doctrine applied correctly; the tool's strongest position |
| AI rubric scoring + faculty confirm | Right architecture per the literature; fine-grained reliability is the known hazard; confirm-step rubber-stamping under cognitive load is the known decay mode |
| One ruler for attainment & demand | Architecturally novel and elegant; demand side empirically fragile (aspiration inflation, extraction inconsistency, heterogeneous-employer averaging) |

Key literature recommendations: inter-rater calibration (target α ≥ 0.70 per dimension) before treating scores as quantities; demand as directional signal with per-target confidence labels; ordinal bands in program-level displays; an intervention-trigger workflow so the map drives action.

## 5. Data-volume snapshot (as of 2026-06-11, per STATE.md; DB recount pending)

- Courses in scope (`builds_to_career`): **27** of 46
- Non-retired snapshots: **≈6** distinct courses captured (24 v2 sessions logged)
- `career_target_demand`: **0 rows** (seam dark); submitted position captures: ~0–low single digits
- Career targets: 5; active sub-competencies: ≈30

---

## 6. Action items

Ordered by priority. Each is independently shippable. Check off + date when done; deferrals go to STATE.md Deferred/debt per the update protocol.

### P0 — Honesty debt (days, not weeks)

- [x] **A1. Fix the executive brief's flag claim.** ✅ **2026-06-12 — option (b) built.** Minimal flag mechanism shipped (`faculty_flags` migration 0034, ⚑ on matrix cells + review-panel competencies, drift display, explicit resolve); brief + vision reworded; "patterns update prompts" removed. Spec `2026-06-12-faculty-flag-mechanism-design.md`.
- [x] **A2. Fix the faculty guide's per-instructor-matrix claim** ✅ **2026-06-12 — resolved by implementing per-instructor rows** (A8 decided first): `getMatrixData`/`listStalePairs` now `DISTINCT ON (course_code, instructor_name)`; matrix rows labeled "by [instructor]". The guide's claim is now true as written; architecture doc updated to match.
- [x] **A3. Sweep the dead flag chain** ✅ **2026-06-12** — `ReasoningExpand`/`PrerequisiteGapPanel`/`CoverageHeatMap`/`TargetChainResults` + prototype-flag query fns deleted; `FlagDialog` rewritten as the survivor (roster identity), now actually mounted.
- [x] **A4. Retitle/reframe `graduate-outcome-validation.html`** ✅ **2026-06-12** — retitled "Graduate Outcome Criterion-Relevance Study" (filename unchanged so links survive); header states what the design can/can't establish; new **"Pre-committed criteria — what would count as failure"** section (C1 mapping-reliability gate α≥0.70, C2 discrimination vs matched control SOC set d≥0.5 — the headline falsification test, C3 ≥60% central-competency coverage, + what-failure-does-NOT-license rules; thresholds pending committee confirmation, frozen at data collection). Display-text references updated in brief/background/CLAUDE.md.
- [x] **A5. Add a "superseded" note for the original spec.** ✅ **2026-06-12** — status banner at the top of `gc-curriculum-tool-spec.md` mapping each spec pillar (Proposal system, Curriculum Map/Sankey, Assessment Gates, four roles, panel-editable targets) to what replaced it or its deferred status; CLAUDE.md doc-map line updated. Body untouched (origin history).

### P1 — Validity debt (the single highest-value scientific move)

- [ ] **A6. Run the reliability study.** (i) Re-run v2 synthesis 5× on 2–3 existing transcripts → per-dimension score variance; (ii) re-run `program-score-coverage` 5× on the same (snapshot, target) pairs → cell variance; (iii) have 2–3 faculty independently hand-score one course against `depth-scale.md` → human–AI agreement (Krippendorff's α, target ≥0.70/dimension). Publish results in `docs/`. This is the project's own named falsification test, currently unrun.
- [x] **A7. Display depth bands, not bare integers, at program level** ✅ **2026-06-12** — pure `lib/program/depth-band.ts` (— / L 1–2 / W 3 / H 4–5; null = no-data passes through); `/program` matrix cells default to **Bands** with a Scores: Bands/Exact toggle, band-aware legend explaining *why* (no reliability data yet), and the exact integer + band word in the cell drawer; prereq-gap chips (`/courses/[code]`) show bands with exact values in the tooltip. Display-only — nothing stored changes. Revisit the default once A6 lands.
- [x] **A8. Decide the multi-instructor aggregation policy** ✅ **2026-06-12 — decided with the operator: per-instructor rows.** The matrix shows one row per (course, instructor), each the latest snapshot for that instructor — variance visible, not averaged or timing-dependent. Written into the architecture doc (§per-instructor capture). Program-level capability claims (e.g. the dormant sufficiency engine) still take ordinal-MAX across whatever rows exist, which is the correct "program can deliver" semantics.
- [x] **A9. Make `source` + `citations` required in the v2 synthesis schema variant** ✅ **2026-06-12** — `captureProfileSchemaV2`/`captureCompetencySchemaV2` (Zod): source + citations required on every competency; non-inferred source with zero citations rejected; legacy schema untouched. **Bonus drift fix:** `deriveSourceFlag` (Stage-4's "source is derived mechanically" helper) had zero live consumers — the model was self-reporting provenance. Now wired: `withDerivedCompetencySources` re-derives each competency's `source` from its citation set post-validation, so a "materials" claim with no citations is honestly downgraded to `inferred`.
- [x] **A10. Surface the per-cell `model` in the matrix UI** ✅ **2026-06-12** — `MatrixCoverageCell.model` plumbed through `getMatrixData`; cell drawer shows "Scored by [model]" with a drift-caveat tooltip.

### P2 — Inversion debt (data before engines)

- [ ] **A11. Capture campaign for the 27.** Operator-scheduled capture sessions like advising appointments; target the GC Core 16 first. Track progress in STATE.md. No new analytics surfaces until supply-side coverage materially improves.
- [x] **A12. Run the intended-skills rough pass** ✅ **2026-06-12** — ran `mode:'all-uncaptured'` against prod: **243 intended K/U/D rows across 34 uncaptured courses** (superset of the 27 in-scope; e.g. GC 3720: 18, GC 3700/3710: 12 each; a few catalog-thin courses like ECON 2000/ENSP 2000 yielded 0 — source-side gaps, recorded by `droppedUnknown` counts). Banded `claimed`, never merged into measured attainment; feeds the prereq engine's `intended` basis + `/courses` badges. Cold-start views are non-empty for the A11 campaign.
- [ ] **A13. Demand-side activation gate:** keep `DEMAND_COVERAGE_SEAM` dark until ≥3 *submitted* positions exist for a target; then activate **target-by-target** with a per-target "N positions · confidence" label in the sufficiency panel. Do not average across heterogeneous employer clusters within a target without showing N.

### P3 — Making it matter (the documented failure mode of every mapping initiative)

- [ ] **A14. Define the action loop, one page:** gap threshold → who reviews → how it reaches a committee agenda → what gets re-captured when. Wire `/ask`/wiki to answer "what gaps opened since last review?" Without this, the literature says the most likely outcome of everything above is a beautiful map in a drawer.
- [x] **A15. Rubber-stamp guard on profile confirm:** require at least one substantive faculty edit/annotation (or an explicit per-section "reviewed" act) before "Capture this profile," so confirmation stays an epistemic act under cognitive load. ✅ 2026-06-12 — three-way unlock: (a) any edit made this session (dirty — JSON stringify diff of working vs profile), (b) every "Worth a look" item in the reviewed Set (or none flagged), (c) departmental-context note ≥ 20 non-whitespace chars. Both the sticky-bar "Approve the profile"/"Approve update" button and the form's "Approve & capture" submit are disabled when locked; locked state shows a muted hint ("Locked until reviewed — hover for what counts.") and a `title` tooltip explaining all three unlock paths.
- [x] **A16. K=1 floor visibility** ✅ **2026-06-12** — `isMentionOnly` in `lib/program/depth-band.ts` (K=1, U=0-or-null, D=0; unit-tested incl. the dissociation edges); matrix cells get an italic *"mention only"* badge with explanatory tooltip in both Bands and Exact display, both legends explain it ("exposure, not coverage"), and the cell drawer shows an amber callout naming the K1-only dissociation case.

---

*Produced 2026-06-12 by a multi-agent review session (4 doc/literature agents + direct code verification). DB recount (exact snapshot/position counts) was blocked by tooling during the session — figures in §5 are STATE.md-derived as of 2026-06-11; refresh them when convenient.*
