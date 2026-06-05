# Position Capture v1 — Pre-Build Amendments (Design)

> **Status:** design, approved 2026-06-04. **Amends** [`docs/superpowers/plans/2026-06-04-position-capture-v1.md`](../plans/2026-06-04-position-capture-v1.md) — apply these changes to that plan **before executing it**. (Plans are append-only history; this spec supersedes the affected sections rather than editing them in place.)
>
> **Origin:** the career-level capture audit ([`docs/superpowers/2026-06-04-capture-adequacy-audit.md`](../2026-06-04-capture-adequacy-audit.md)), step 2 of its recommended sequence. Every change here was adversarially verified in that audit.

## Why (one paragraph)

As drafted, Position Capture v1 captures employer demand well but ships it **structurally orphaned** from the coverage matrix, and it **lost the day-one semantics** of the role expectation. Both are cheap to fix in the plan now and expensive to retrofit after the build (renaming live tables, re-deriving mappings with extra AI passes, re-firing employer interviews). This amendment adds the minimum that keeps the career-demand data **commensurable and join-able** with course attainment, without pulling the actual sufficiency scoring forward (that is step 4, the unified demand/coverage layer). The course side already proves the pattern: `snapshot_target_coverage` stores a keyed `subCompetencyId` *and* a free-text `matchedCompetency`; demand should mirror it.

## Scope decision (locked)

- **Seam: specify the shape, don't build it.** PC v1 populates the join key and the spec names the exact demand→matrix seam; the scoring/comparison is built in **step 4**. This keeps PC v1 small while preventing the orphan.
- **Descriptor-edit invalidation bug: folded into this amendment** (it is a present-day correctness bug, independent of PC v1, but small and adjacent).

## Out of scope (→ step 4, unified demand/coverage layer)

- Numeric `k_demand` / `u_demand` / `d_demand` columns on `sub_competencies`.
- The actual demand-vs-attainment **sufficiency** computation and any coverage/scaffolding view that renders it.
- The real Page-5 rating → sub-competency **weighting math** (only the storage contract is locked here).
- Cross-partner dedup, real aggregation function — already PC v1 v2-deferrals; unchanged.

---

## Amendment 1 — Join-key seam on `PositionCompetency` (the load-bearing change)

**Change.** Add a **nullable, structured `sub_competency_id`** (FK to `sub_competencies.id`) to `PositionCompetency`, beside the existing free-text `name` / `description`.

Plan `PositionCompetency` (plan:593) becomes:
```ts
export const PositionCompetency = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(1000),
  // Nullable structured link to a catalog sub-competency, when the synthesizer
  // can confidently map this competency to one. Free-text name/description stay
  // as the human-readable layer; the id is the JOIN KEY for the future
  // demand-vs-attainment comparison. Mirrors snapshot_target_coverage's
  // (subCompetencyId + matchedCompetency) pattern (schema.ts:424,428).
  sub_competency_id: z.string().nullable(),
  required_for_success: KudDepth,
  notes: z.string().max(800).nullable(),
});
```
The JSON schema (plan:643-658) adds `sub_competency_id` to `required` and `properties` as `{ type: ['string','null'] }` (OpenAI strict-mode: present-but-nullable).

**Who populates it.** The synthesis step (`position-synthesis.md`) already receives the target's sub-competency list in context (the plan's `GenerateRatedItemsInput.targetContext.subCompetencies` shows the list is available to the position pipeline). Instruct synthesis to set `sub_competency_id` when a qualifying competency clearly maps to a catalog sub-competency, else null. This is a soft, best-effort key — no hard FK-existence enforcement at parse time (the partner-facing pipeline must not 500 on a fuzzy match); validity is checked when the seam is built in step 4.

**Why now.** This field **does not exist** in the drafted plan and is the join key any demand-vs-attainment comparison needs. Populating it costs one prompt instruction at synthesis time; retrofitting it later means re-running synthesis over every captured position.

---

## Amendment 2 — Key the Page-5 ratings

**Change.** Promote the Page-5 "experiences worth having" `evidence_source` (plan:1154, currently free text ≤300 chars) so each rated item ALSO carries a nullable `sub_competency_id`.

`RatedItemsList` items (plan:1150-1156) become:
```ts
items: z.array(z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(1000),
  evidence_source: z.string().min(1).max(300),     // keep the human-readable source
  sub_competency_id: z.string().nullable(),         // NEW — the mappable key
}))
```
JSON schema (plan:1168-1172): add `sub_competency_id: { type: ['string','null'] }` to `required` + `properties`. The generator already has `targetContext.subCompetencies` in context (plan:1185), so emitting the id per item is cheap.

**Defer the math, lock the contract.** PC v1 does NOT compute rating → sub-competency weight (that's a separate design, PC v2 / step 4). It only **persists the key** so v2 needn't re-derive the mapping with an extra AI pass.

---

## Amendment 3 — Anchor `required_for_success` to day-one entry level

**Problem.** The `expected_on_day_1` → `required_for_success` rename (plan:598 lineage) stripped the day-one semantics from the field name, and `position-synthesis.md` frames K/U/D only as "REQUIREMENT for the role." With a sibling `trajectory{year_1, year_2_to_3}` block (plan:615) and no instruction to keep trajectory out of the scored KUD, the model can drift toward professional-mastery depths — and then every program fails the comparison; or toward awareness depths — and weak programs pass.

**Change (prompt + doc-comment only; no schema change):**
- In `position-synthesis.md` and the `required_for_success` doc comment, anchor the K/U/D explicitly to **"what a new hire is expected to do on day one, at entry level"** — not eventual mastery.
- Instruct synthesis to keep `trajectory{year_1, year_2_to_3}` content **out of** the `required_for_success` scoring; trajectory is captured separately and is never the comparand.
- Calibrate: typical entry roles land near the depth-scale **D3** band ("performs independently in familiar conditions", `depth-scale.md`), not D5. Include a one-line calibration example.

---

## Amendment 4 — Demand-side evidence / confidence discipline

**Problem.** Course-side scoring hard-gates evidence at validate time (`captureCompetencySchema` refines: `k_depth>1`→`evidence_k`, etc.; and `incomingExpectationSchema` carries `evidenced_by: array.min(1)` + `confidence`). PC v1's `required_for_success` (`KudDepth`) has **only** k/u/d + a free-text `rationale` — no evidence array, no confidence, no schema backstop — so a single vague endorsement ("good communicators") can mint a non-zero D and pass validation. Asymmetric conservatism (supply hard-gated, demand soft-gated) biases any eventual comparison.

**Change.** Extend `KudDepth` (plan:586) to mirror the course side's `incomingExpectationSchema` discipline:
```ts
export const KudDepth = z.object({
  k_depth: z.number().int().min(0).max(5).nullable(),
  u_depth: z.number().int().min(0).max(5).nullable(),
  d_depth: z.number().int().min(0).max(5).nullable(),
  rationale: z.string().min(1).max(800),
  // NEW — what the partner actually said that evidences these depths.
  evidenced_by: z.array(z.string()).nullable(),       // transcript references / quotes
  confidence: z.enum(['high', 'medium', 'low']),      // how clearly the interview evidenced it
}).superRefine((kud, ctx) => {
  // Any depth above a floor must point at something the partner said.
  const aboveFloor = (kud.k_depth ?? 0) > 1 || (kud.u_depth ?? 0) > 0 || (kud.d_depth ?? 0) > 0;
  if (aboveFloor && (!kud.evidenced_by || kud.evidenced_by.length === 0)) {
    ctx.addIssue({ code: 'custom', path: ['evidenced_by'],
      message: 'above-floor demand depth requires evidenced_by — a vague endorsement with no concrete signal should be scored at the floor.' });
  }
});
```
JSON schema (plan:647): add `evidenced_by: { type: ['array','null'], items: { type: 'string' } }` and `confidence: { type: 'string', enum: ['high','medium','low'] }` to `required` + `properties` (strict-mode). `position-synthesis.md` gains the calibration: a vague "good communicators" → K=1, not D=3; confidence reflects evidence clarity, not enthusiasm.

> This is the same discipline we just shipped for course-side structured-reflection (a citation required above `absent`); the demand side should be no looser than the supply side, or the eventual gap comparison is systematically skewed.

---

## Amendment 5 — Specify the demand→matrix seam (design only; built in step 4)

The seam is **named here so PC v1's data shape anticipates it**, but PC v1 builds none of the scoring.

**Specified shape.** When step 4 wires demand into the coverage layer, it will add — keyed by `sub_competency_id` — a per-(target × sub-competency) demand record carrying numeric `k/u/d_demand` (entry-level) derived from the `position_captures` aggregate, against which the existing `snapshot_target_coverage` attainment depths are differenced. The seam can land as either:
- **(a)** new nullable `demand_*` columns + a `demand_source` on `snapshot_target_coverage` (co-located with attainment), or
- **(b)** a `demand` context slot added to `ScoreCoverageInput` (`lib/ai/analyze/program-score-coverage.ts:71-91`, which today has **no** demand parameter) that the scorer reads.

PC v1's only obligation toward this seam: **populate `sub_competency_id` on qualifying competencies (Amendment 1) and on Page-5 ratings (Amendment 2)** so the aggregate can key into the catalog. No demand columns, no scorer change, no view in PC v1.

**Plan note to add (PC v1 §"Scope cut for v1"):** "Demand is captured keyed to `sub_competency_id` but is NOT yet compared against course attainment; the demand→`snapshot_target_coverage` seam is specified in the pre-build amendments and built in the unified-coverage-layer increment (audit step 4)."

---

## Amendment 6 — Fix descriptor-edit invalidation (folded-in bug)

**Present-day bug** (independent of PC v1). `PATCH /api/targets/[id]/sub-competencies/[scId]` (`route.ts`) updates the descriptor, writes a `prototypeTargetEdits` audit row, bumps `updatedAt`, and calls `clearTargetCache()` — but it **never** invalidates or re-scores the dependent `snapshot_target_coverage` cells. Because `listStalePairs()` treats a (snapshot × target) pair as permanently "scored" once any cell exists (and `force=true` is unimplemented), a descriptor edit silently leaves every coverage cell scored against the **old** prose. The only existing re-score path is the manual per-pair POST at `app/api/program/coverage/refresh/[snapshotId]/[targetId]/route.ts`.

**Change.** On a PATCH that changes `knowDescriptor` / `understandDescriptor` / `doDescriptor` **or** `name` (anything the scorer reads), mark the dependent coverage cells stale so they are recomputed:
- **Recommended mechanism:** delete the `snapshot_target_coverage` rows for that `(careerTargetId, subCompetencyId)` (and the `coverage_scores` rows if the M-trial table is still read) inside the same transaction as the descriptor update. They are derived data; deleting them makes `listStalePairs()` see the pair as needing re-score, and the coverage view/refresh recomputes on next load. (Alternative: add a `stale boolean` to the cells and have the loader/refresh honor it — preserves the old value until re-score but needs a column + a migration, so prefer delete for v1.)
- A pure-coverage edit (only `name` changed, descriptors untouched) still warrants invalidation because the scorer prompt includes the sub-competency name.
- Test: a descriptor PATCH removes the dependent coverage cells (or flags them), and a subsequent coverage load re-scores them.

**Scope note.** This is a small, self-contained task; it can ship independently of the PC v1 build. It is folded into this amendment because the audit surfaced it alongside the demand-seam work and both touch the coverage layer.

---

## Net effect on the PC v1 plan

When PC v1 is eventually executed, its plan should be read **with these six amendments applied**: schema migration `0029` (which renames CC v1's tables) additionally introduces `sub_competency_id` on position competencies and rated items and the `evidenced_by`/`confidence` fields on `required_for_success`; `position-synthesis.md` carries the day-one anchor + demand-evidence calibration + the sub-competency-id mapping instruction; the descriptor-edit route gains coverage-cell invalidation. None of this builds the sufficiency comparison — that is the unified demand/coverage layer (step 4), which now has a defined join key and a named seam to build against.

## Success criteria

- A produced `PositionProfile` carries a (nullable) `sub_competency_id` on each qualifying competency and on each Page-5 rated item.
- `required_for_success` depths above the floor carry `evidenced_by`; a vague endorsement is scored at the floor, not inflated.
- `position-synthesis.md` anchors required_for_success to day-one entry level and excludes trajectory content from the scored KUD.
- Editing a sub-competency descriptor invalidates and re-scores its dependent coverage cells.
- The PC v1 plan's scope-cut section records that demand is captured keyed but not yet compared, with the seam specified.

## Related

- [`docs/superpowers/2026-06-04-capture-adequacy-audit.md`](../2026-06-04-capture-adequacy-audit.md) — origin + the adversarial verification of each change.
- [`docs/superpowers/plans/2026-06-04-position-capture-v1.md`](../plans/2026-06-04-position-capture-v1.md) — the plan these amend.
- Supply-side patterns referenced: `lib/db/schema.ts` (`snapshotTargetCoverage` keyed id + matched text), `lib/ai/capture/schema.ts` (`incomingExpectationSchema` evidenced_by + confidence; `captureCompetencySchema` evidence refines), `lib/ai/analyze/program-score-coverage.ts` (`ScoreCoverageInput`, no demand slot today).
