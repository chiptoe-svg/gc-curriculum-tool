# Guided Faculty-Reconciliation Review — Design (Piece 2)

**Date:** 2026-06-14
**Status:** approved design (operator brainstorm 2026-06-14), pre-plan
**Origin:** Piece 2 of the "/view full profile + apparent outcomes" effort (Piece 1 shipped 2026-06-14). The capture profile is AI-drafted; faculty should be able to **reconcile** it into their own view through a guided, interview-continuation pass — leading them through apparent outcomes → incoming expectations → outgoing KUDs, taking conversational feedback per section, and applying it so the final snapshot represents the faculty's view. Must preserve evidence discipline: a faculty-overridden score is **faculty-asserted**, never silently presented as evidenced.

## Decisions made in the brainstorm (2026-06-14)

1. **Placement: a NEW `reconcile` stage BEFORE the existing review panel.** Flow for a new capture: `synthesis → reconcile → review (existing ProfileReviewPanel) → Save Snapshot`. Nothing existing is removed; the panel stays the final verify/approve and receives the reconciled working profile. Re-opening an already-captured profile lands on `review` (today's behavior) with a "Reconcile with the auditor" entry button.
2. **Modality: hybrid stepper + conversational feedback** (chosen earlier). Three steps; each shows the section's items + a per-section natural-language feedback box; the AI proposes concrete edits; faculty accept/tweak/reject.
3. **Feedback granularity: per-section conversational box** (one box per step; faculty reference items freely in prose).
4. **Provenance: reuse `source: 'instructor'`.** A faculty override sets the item's `source` to `'instructor'` → the existing `'claimed'` evidence band. No new enum value, no strict-schema churn.
5. **Audit trail: store the reconciliation transcript** tied to the snapshot (a new nullable `reconciliation_log` JSONB column).
6. **The model PROPOSES; deterministic code APPLIES + flips provenance.** The evidence-discipline guarantee lives in a pure `applyReconciliation`, not in the model's output.

## Section → profile-field mapping

| Step | Profile field | Item shape (relevant) | Has provenance? |
|---|---|---|---|
| Apparent outcomes | `revised_objectives_draft: string[]` | plain strings | No (text list) |
| Incoming expectations | `incoming_expectations[]` | `{ statement, expected_depth:{k,u,d}, source?, citations? }` | Yes |
| Outgoing KUDs | `competencies[]` | `{ statement, k_depth, u_depth, d_depth, type, source?, citations? }` | Yes |

The provenance flip applies only to the two scored sections (incoming + outgoing). Apparent outcomes is a string list — edits are pure text changes (no per-item `source`). Foundational competencies keep K/U `null` (the prompt + apply must not invent K/U for them).

## Components

### 1. Schema + migration
- **`reconciliation_log`** — new nullable JSONB column on `course_capture_snapshots` (additive migration). Shape: `Array<{ section: 'apparent_outcomes'|'incoming'|'outgoing'; feedback: string; proposals: Proposal[]; decisions: Array<{ index: number|null; accepted: boolean }>; at: string }>`. Written at snapshot-save from the client-accumulated transcript; null for snapshots created without a reconcile pass (back-compat).
- **`Proposal`** (Zod + strict OpenAI JSON schema, in `lib/ai/capture/` or alongside the reconcile function):
  ```
  { index: number | null,                 // index into the section's items; null = add
    action: 'keep' | 'modify' | 'remove' | 'add',
    revised: { statement: string | null, k: number | null, u: number | null, d: number | null } | null,
    rationale: string }
  ```
  Strict-mode: every property listed in `required`; optionals are nullable unions. `revised` is null for `keep`/`remove`. For apparent-outcomes, only `revised.statement` is used (k/u/d null).

### 2. AI reconcile function (`reconcile-feedback`)
- New `functionId: 'reconcile-feedback'` in `AI_FUNCTION_IDS` + `DEFAULT_TIERS` (**default** tier — reasoning over feedback + the section, structured output; promote to heavy if quality is poor) + `FUNCTION_LABELS`/`FUNCTION_DESCRIPTIONS`.
- Prompt `lib/ai/prompts/reconcile-feedback.md`: given the section type, its current items (values + provenance), and the faculty's prose feedback, emit `{ proposals: Proposal[] }`. Rules: propose only what the feedback warrants; reference items by their index; the model may reword/restructure, but **a depth change driven by faculty assertion must be proposed as `modify` with the faculty's value — the model never marks anything as evidenced** (provenance is set by the apply step). Keep rationales to one line.
- Route `app/api/capture/[code]/reconcile/route.ts` (POST): faculty Basic Auth + slug; **paid-route cost discipline** — `checkDailyCap()` → 503 when capped, `recordSpend()` after the call (per the F11 pattern). Body: `{ section, items, feedback }`. Returns `{ proposals, telemetry }`.

### 3. Apply + provenance (pure, deterministic — `lib/capture/apply-reconciliation.ts`)
`applyReconciliation(profile, section, acceptedProposals): CaptureProfile` — returns a new profile with the section's array transformed:
- `keep` → item unchanged.
- `modify` at `index` → overwrite the provided `revised` fields (statement / k / u / d). For the two scored sections, set the item's `source = 'instructor'` and **clear `citations`** (the old citations evidenced the old value, not the faculty's assertion) → derives to the `'claimed'` band. Respect foundational K/U `null` (don't set K/U on a foundational competency).
- `remove` at `index` → drop the item.
- `add` → append a new item built from `revised`; scored sections get `source: 'instructor'`, empty citations.
- Apparent outcomes: modify/add/remove operate on the string list (no source).
- Depth values clamped to 0–5; invalid proposals skipped defensively.
This pure function is the load-bearing evidence-discipline guarantee and is unit-tested exhaustively.

### 4. Stepper UI (`app/capture/[code]/ReconciliationStepper.tsx`)
- Three steps (apparent outcomes → incoming → outgoing). Progress indicator; back/next.
- Each step renders the section's current items (statement + depth chips + provenance band where applicable, reusing the existing chip/band components) and a **conversational feedback box**.
- On feedback submit → POST `/reconcile` → render the returned proposals as a **diff list** (per proposal: action + before/after + rationale) with **accept / tweak / reject** controls (+ accept-all / reject-all). "Tweak" lets faculty adjust the proposed value before accepting.
- Accepted proposals call `applyReconciliation` (client-side, pure) to update the working profile; the step re-renders from the updated profile. Faculty can submit more feedback (iterate) or advance.
- Each round appends to the client-held reconciliation transcript.
- After step 3 → **"Continue to review"** transitions to the existing review panel with the reconciled working profile.

### 5. Flow integration (`CaptureClient.tsx`)
- Extend `Stage` to `'chat' | 'generating' | 'reconcile' | 'review'`.
- On synthesis success (currently `setStage('review')`): for a fresh capture, `setStage('reconcile')`. Reconcile "Continue" → `setStage('review')`.
- The working profile lives in `CaptureClient`; the stepper mutates it via `applyReconciliation`; the review panel receives it (today's prop).
- Re-opening an existing captured profile lands on `review` with a "Reconcile with the auditor" button → `setStage('reconcile')`.
- On Save Snapshot, the accumulated `reconciliation_log` is sent with the snapshot and persisted on the row.

## What is explicitly UNCHANGED
- The synthesis pipeline + the **profile schema field set** (reconciliation edits existing fields + flips `source`; no new profile fields). The only schema change is the additive `reconciliation_log` snapshot column.
- The review panel's edit/flag/stress-test/reviewerNote behavior (it just now receives an already-reconciled profile).
- The `CaptureProfileSource` enum (`instructor | materials | inferred`) and `deriveEvidenceBand` mapping.
- The matrix / `/program` / target pages.

## Out of scope (deferred / non-goals)
- Server-side incremental persistence of an in-progress reconcile session (v1 accumulates client-side; a mid-pass reload restarts the reconcile — the synthesized profile is unharmed). A `reconcile_messages`-style store mirroring `capture_messages` is the future enhancement.
- Renaming `revised_objectives_draft` → `apparent_outcomes` (optional rider; deferred to avoid snapshot/schema churn).
- Auto-applying proposals (always faculty-gated) or batch-reconciling multiple courses.
- Reconciling target-page rollups or matrix cells.

## Testing
- **Pure `applyReconciliation`** (the priority): modify flips `source→instructor` + clears citations on incoming/outgoing; add → instructor/empty-citations; remove drops; keep untouched; apparent-outcomes text edits carry no source; foundational competency K/U stays null; depth clamping; bad-index/bad-action skipped.
- **Reconcile function**: strict-schema validation via the fake provider; a few feedback→proposal shapes (a depth-lowering, a removal, an added outcome); confirm the model output never sets provenance (only the apply step does).
- **Route**: cost-cap 503 when capped; records spend on success; auth-gated.
- **Stepper component**: renders 3 steps; feedback submit → proposals render → accept applies to the working profile (depth chip updates, band flips to claimed) → advance → "Continue to review" hands the reconciled profile onward.
- **Snapshot save**: `reconciliation_log` persisted; null when no reconcile pass ran.

## Sequencing (one spec; plan builds engine-first)
1. Migration (`reconciliation_log`) + `Proposal` schema.
2. Pure `applyReconciliation` (+ exhaustive tests) — headless.
3. AI `reconcile-feedback` function + prompt + functionId + cost-capped route.
4. Stepper UI + `CaptureClient` flow integration.
5. Snapshot-save persistence of the log + STATE.md.
