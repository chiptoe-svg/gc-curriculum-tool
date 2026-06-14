# Abstraction-and-Bridging Audit Condition — Design

**Date:** 2026-06-14
**Status:** approved design (operator brainstorm 2026-06-14), pre-plan
**Origin:** The problem-solving transfer-research review (2026-06-14) identified that the transfer literature (Gick & Holyoak 1980/1983; Gentner, Loewenstein & Thompson 1999/2003; Perkins & Salomon 1989) names **abstraction across surface-varied cases + deliberate bridging to a new context** as *the* active mechanism that makes problem-solving transfer — and CourseCapture's Audit Area 7 doesn't probe it. The four existing conditions (generate-then-consolidate, ill-structured, revision, post-mortem) capture productive failure + reflection; none capture the transfer-conversion step. This adds it. Backing detail + citations live in `docs/problem-solving-deep-dive.html` (transfer section + §9 Claim 2) and `docs/background.html` §4; it was logged in STATE.md Deferred/debt.

## Decisions made in the brainstorm (2026-06-14)

1. **Capture-first MVP.** This increment ships the probe + schema + per-course display so new snapshots carry the condition immediately. The program-level **Scaffolding Analysis aggregation is deferred** (no data to aggregate until snapshots are re-captured; mirrors how Area 7 originally shipped — capture first, scaffolding consumption in stages).
2. **Peer condition in the same block.** `abstraction_bridging` is a sixth graded condition inside `productiveFailureConditionsSchema` (Area 7), not a new sibling block — operationally it is an Area-7 condition; conceptually it is the transfer-conversion step the other conditions set up.
3. **Evidence-citation discipline.** Non-`absent` requires ≥1 resolvable citation, mirroring `structured_post_mortem` (the evidence-above-zero rule).
4. **Back-compat via optional-in-Zod + required-nullable-in-OpenAI.** The Zod parse schema makes the field optional (old `present` blocks lacking the key still parse → read as "not assessed for this condition," never fabricated as `absent`); the OpenAI strict request schema lists it required + nullable so new captures always emit a value or explicit null.

## Context (grounding findings)

- `lib/ai/capture/schema.ts` — `productiveFailureConditionsSchema` (line ~134): four required `productiveFailureConditionEnum` fields (`generate_then_consolidate`, `open_ended_problems`, `revision_cycles`, `structured_post_mortem`) + `structured_post_mortem_evidence` (`.nullable().optional()`) + `max_supporting_depth` + `notes`, with a `superRefine` requiring evidence when `structured_post_mortem !== 'absent'`. The block sits in `captureAuditNotesSchema.productive_failure_conditions` (`.nullable().optional()`) under a documented PRESENCE CONTRACT: null block ⇒ Area 7 not assessed (excluded from rollups), present block ⇒ conditions are real judgments.
- `enum`: `productiveFailureConditionEnum = z.enum(['present','partial','absent'])`.
- `PF_CONTRACT_EPOCH = new Date('2026-06-05T02:50:48Z')` lives in `lib/db/scaffolding-queries.ts:34` (used at L41 to reclassify pre-epoch snapshots to no-data) — this is the **aggregation** layer, deferred here.
- OpenAI strict-mode request schema for the synthesis is maintained in `lib/ai/agent/audit-response-schema.ts` / `lib/ai/analyze/capture-scores.ts` (per CLAUDE.md: every property in `required`; optional ⇒ nullable union).
- Interview prompt: `lib/ai/prompts/capture-chat-agent.md` §7 ("Productive failure and reflection conditions"), probes a–d + the depth signal.
- Synthesis prompt: `lib/ai/prompts/capture-synthesis.md` / `synthesize-course-profile.md` emit the profile incl. the PF block.
- Downstream consumers of the PF block: `lib/ai/analyze/capture-scores.ts`, `lib/program/scaffolding.ts`, `lib/db/scaffolding-queries.ts`, `app/program/scaffolding/ScaffoldingStripClient.tsx`, `app/view/[code]/CapturedView.tsx`, `lib/ai/wiki/update.ts`. **Only `CapturedView.tsx` is touched this increment** (per-course display); the rest are deferred (aggregation) or unaffected (wiki evidence bands).

## Components

### 1. Schema — `lib/ai/capture/schema.ts`
Add to `productiveFailureConditionsSchema`:
```
abstraction_bridging: productiveFailureConditionEnum.optional(),
abstraction_bridging_evidence: z.array(CaptureProfileCitation).nullable().optional(),
```
Extend the existing `superRefine` (alongside the `structured_post_mortem` check): when `abstraction_bridging` is **defined and !== 'absent'**, require ≥1 citation in `abstraction_bridging_evidence` (same message shape as the post-mortem rule). The refine only fires when the field is present, so old snapshots (field absent) are untouched. Update the block's doc comment to describe the new condition + its optional-for-back-compat status.

### 2. Synthesis request/response (OpenAI strict) — `lib/ai/agent/audit-response-schema.ts` / `lib/ai/analyze/capture-scores.ts`
Add `abstraction_bridging` (enum, **required + nullable**) and `abstraction_bridging_evidence` (array, **required + nullable**) to the strict request schema for the PF-conditions object, so new captures always emit a value or explicit null. Audit `required` vs `properties` recursively per the strict-mode discipline.

### 3. Interview prompt — `lib/ai/prompts/capture-chat-agent.md` §7
Add probe **(e) Abstraction-and-bridging**: *Does the course require students to abstract a principle across multiple surface-varied cases and apply it to a genuinely new context?* Include the explicit distinction from (b): **(b)** asks whether the *problem* is open-ended/ill-structured; **(e)** asks whether students must reason *across multiple varied cases* (comparison → schema) and *bridge the principle to a new context*. A single rich case is not abstraction-and-bridging; repeated drills of the same surface form are not either. Add it to the §7 "what to surface" summary.

### 4. Synthesis prompt — `lib/ai/prompts/capture-synthesis.md` (and/or `synthesize-course-profile.md`)
Instruct the model to emit `abstraction_bridging` (present/partial/absent) + `abstraction_bridging_evidence` for the PF block, with the same evidence discipline as `structured_post_mortem` (non-absent must cite a graded artifact; otherwise `absent`).

### 5. Per-course display — `app/view/[code]/CapturedView.tsx`
Render `abstraction_bridging` alongside the four existing conditions in the productive-failure section. Handle the **not-assessed** state (field missing/null on older snapshots) — omit or grey it, consistent with the existing block-level no-data treatment; never show a missing field as `absent`.

### 6. Testing
- **Schema** (`tests/...` near the existing capture-schema tests): an old `present` block *without* `abstraction_bridging` parses successfully; a new block with `abstraction_bridging: 'present'` and no evidence **fails** the refine; with one citation **passes**; `abstraction_bridging: 'absent'` needs no evidence; `'partial'` requires evidence.
- **Strict request schema**: a test asserting `abstraction_bridging` (+ evidence) is in `required` and nullable (mirror the existing audit-response-schema test pattern).
- **Display**: a CapturedView render test showing the condition when present and not crashing when the field is absent (back-compat).

## Data flow
Interview (Area 7 probe e) → synthesis emits `abstraction_bridging` + evidence into the immutable snapshot's `productive_failure_conditions` block → CapturedView displays it. No DB migration (it's a JSON profile field). Snapshots created before this ships simply lack the key → read as not-assessed for this condition.

## Out of scope (deferred fast-follow / non-goals)
- **Program-level aggregation** — `lib/program/scaffolding.ts` rollup, an `ABSTRACTION_BRIDGING_EPOCH` gate in `scaffolding-queries.ts`, and the `ScaffoldingStripClient` 5th-condition row + rollups. (Deferred until snapshots carry the field; its own increment.)
- **`lib/ai/wiki/update.ts`** — the wiki's evidence-band logic is unaffected by the new condition; untouched.
- **Re-capturing existing courses** to populate the field — an operator action, not code.
- Renaming `productive_failure_conditions` to reflect that it now includes a transfer condition — cosmetic, not worth the churn.

## Testing summary
Full suite stays green; new schema + strict-schema + display tests pass; `pnpm exec tsc --noEmit` clean. No DB migration. A manual capture smoke (interview a course, confirm the new probe appears and the synthesized snapshot carries `abstraction_bridging` + evidence) is the deploy-time check.
