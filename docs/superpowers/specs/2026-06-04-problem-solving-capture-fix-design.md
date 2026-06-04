# Problem-Solving Capture Fix — Design

> **Status:** design, approved 2026-06-04. Implementation plan to follow in `docs/superpowers/plans/`.
>
> **Origin:** the capture-adequacy audit ([`docs/superpowers/2026-06-04-capture-adequacy-audit.md`](../2026-06-04-capture-adequacy-audit.md)) found that problem-solving — the program-level property the whole KUD+ → coverage → scaffolding stack exists to surface — is the *most under-captured* thing relative to its centrality. This is fix #1 of the audit's recommended sequence.

## One-line

Make the capture of productive-failure / structured-reflection signals honest and reliable: distinguish "we never asked" from "the course has none," stop the scorer from fabricating zeros, require reflection to be evidenced, and surface "no data" as its own state — closing an existing scaffolding-spec requirement.

## Background & the bug

Problem-solving is not stored as a per-course score; it is the emergent product of **depth × productive-failure × structured-reflection**, computed at program scale by the Phase 1B scaffolding analysis. The course capture records the *inputs* in `audit_notes.productive_failure_conditions` (`lib/ai/capture/schema.ts:134-156`): four graded conditions (`generate_then_consolidate`, `open_ended_problems`, `revision_cycles`, `structured_post_mortem`) plus `max_supporting_depth` and `notes`.

The audit confirmed four defects:

1. **"Not probed" is indistinguishable from "absent."** The block is `.nullable().optional()` (schema.ts:153). The two output paths disagree: `capture-synthesis.md:172-182` omits the block when Audit Area 7 wasn't probed (silence = unknown), while `capture-scores.md:213` forces the four enums required, so an unprobed course emits a fabricated all-`absent` block. At scoring, `conditionsScore(null)` returns `0` (`scaffolding.ts:58-62`) and the loader maps both null and missing to a 0 contribution (`scaffolding-queries.ts:127,144`), so an unprobed course renders identically to a genuinely-empty one as `absent · 0.00`. This **violates** the scaffolding spec, which requires "no productive-failure data" to be surfaced as distinct from "absent" (`docs/superpowers/specs/2026-05-25-scaffolding-analysis-design.md:61`).
2. **Problem-solving probing is not enforced.** Readiness (`captureReadinessSchema`, schema.ts:254-259) never gates on Area 7; generation is gated only on `canGenerate` = one assistant turn (`CaptureChatPanel.tsx:329`). A profile can ship having never probed productive failure.
3. **Reflection is unevidenced yet double-counted.** `structured_post_mortem` is a lone present/partial/absent enum (schema.ts:138) with no required citation, but it feeds **both** `conditionsScore` *and* the 0.5–1.0 `reflectionWeight` multiplier (`scaffolding.ts:81-83`). A generic journal mis-rated `partial` inflates the course's problem-solving contribution ~50%. The "generic reflection doesn't count" calibration lives only in `capture-chat-agent.md:596`, not in the prompts that write the stored value.
4. **Course-level grain leaks.** One PF block per snapshot is applied to every sub-competency cell (`scaffolding-queries.ts:144`); the strip renders this per-cell with no disclaimer.

## Decisions (locked during brainstorming)

- **Sentinel = presence.** `null`/absent block ⇒ *not assessed*; a present block ⇒ *assessed* (an `absent` condition then genuinely means "looked, none"). No new boolean field — presence carries it, matching the field's documented intent (schema.ts:149-153).
- **Generation gating = soft nudge + honest record.** Warn when Area 7 wasn't probed; allow generation; record PF as not-assessed (null).
- **Reflection = citation-backed**, schema-enforced.
- **Legacy = reclassify as no-data.** Pre-fix snapshots can't be trusted (the scores path forced all-`absent`), so reclassify all of them to no-data via a deploy-time cutoff.
- **PF grain = course-level disclaimer** now; true per-cluster grain deferred.

## Goals

- A program view that distinguishes "no PF data" from "assessed, none."
- Both prompt paths emit an identical, honest contract (no fabricated blocks).
- Reflection credited only when evidenced.
- A soft nudge that keeps faculty flow while making absence honest.
- No regression to the K/U/D depth substrate (which the audit found sound).

## Non-goals

- No change to K/U/D depth scoring, `course_emphasis`, `incoming_expectations`, or the citation provenance rules already in place.
- No migration / no new DB column (legacy handled by a code-level cutoff).
- No per-cluster PF grain (disclaimer only).
- No prerequisite/demand-axis work (those are later steps in the audit's sequence).
- No re-capture of existing courses (legacy is reclassified, not re-fired).

## Architecture

### 1. Schema — `lib/ai/capture/schema.ts`

The presence contract is already expressible (`productive_failure_conditions: block | null`); the change is to **enforce reflection evidence** and to document the presence contract authoritatively.

- Add to `productiveFailureConditionsSchema`:
  ```ts
  structured_post_mortem_evidence: z.array(CaptureProfileCitation).optional(),
  ```
- Add a `.superRefine()` on the block: when `structured_post_mortem !== 'absent'`, require `structured_post_mortem_evidence` to be present and non-empty; otherwise it may be omitted. This mirrors the existing `evidence_k/u/d` `.refine()` discipline on competencies (schema.ts:113-124). Desired effect: if the synthesizer cannot cite a real post-mortem artifact, the conservative path is to rate `structured_post_mortem: 'absent'` (no credit), which is correct.
- Update the doc comment on `productive_failure_conditions` (schema.ts:149-153) to state the **authoritative presence contract**: *null/omitted ⇒ Area 7 not assessed ("no data"); a present block ⇒ assessed, conditions are real judgments including a legitimate `absent`.*
- The block stays `.nullable().optional()` (do not make it required).

### 2. Prompts — `lib/ai/prompts/capture-scores.md` + `capture-synthesis.md`

- Both prompts emit the **identical** contract: produce `productive_failure_conditions` **only if Audit Area 7 was actually probed**; otherwise omit it (null). Add an explicit line to `capture-scores.md` (which currently forces the block): *"Never fabricate an all-absent block to satisfy the schema — omit `productive_failure_conditions` entirely when Area 7 was not probed."*
- OpenAI strict-mode encoding: make the **whole** `productive_failure_conditions` value nullable (`type: ['object','null']`) in the JSON schema so the model can legitimately emit null, and audit `required`-vs-`properties` recursively for the new `structured_post_mortem_evidence` field (per the strict-mode discipline in CLAUDE.md and `lib/ai/agent/audit-response-schema.ts` / `lib/ai/analyze/capture-scores.ts`).
- Repeat the structured-vs-generic reflection calibration (currently only `capture-chat-agent.md:596`) in both `capture-scores.md` and `capture-synthesis.md`, tied to the new evidence requirement: a generic "reflect on your learning" prompt with no graded post-mortem artifact ⇒ `structured_post_mortem: 'absent'`.

### 3. Scoring — `lib/program/scaffolding.ts`

Introduce an explicit no-data path so null is never silently scored as 0.

- `conditionsScore` / `snapshotPfContribution`: when a cell's `productiveFailureConditions` is null, the contribution is a **no-data sentinel** (e.g. the function returns `null`), *not* `0`.
- A sub-competency's cumulative PF is computed over **data-bearing snapshots only**. If every contributing snapshot is no-data → `pf_status` resolves to a new **fifth band `no_data`** (extending `PfStatus = 'well_developed' | 'developing' | 'thin' | 'absent' | 'no_data'`, scaffolding.ts:96). `absent` now strictly means "assessed, genuinely none."
- Program-level rollups (unproductive-success / premature-pedagogy / coverage-without-integration) **exclude** `no_data` cells from the diagnostic and instead flag them as "problem-solving not assessed — capture needed." You cannot assert "unproductive success" where PF was never assessed.
- `reflectionWeight` is only consulted for assessed cells (a no-data cell contributes nothing, rather than defaulting to the 0.5 absent-multiplier).

### 4. Legacy reclassification — `lib/db/scaffolding-queries.ts`

- Introduce a module constant `PF_CONTRACT_EPOCH` (a timestamp, set to the deploy moment of this fix in the implementation plan). In the loader, any snapshot with `createdAt < PF_CONTRACT_EPOCH` has its PF treated as **null (no-data)** regardless of the stored block — because pre-fix snapshots may carry a fabricated all-`absent` block that cannot be trusted.
- Post-epoch snapshots use the airtight presence contract directly.
- *(Rationale for a date cutoff over a per-row marker: no field distinguishes pre-fix fabricated-absent from post-fix genuine-absent, and avoiding a DB column keeps this fix self-contained. The alternative — a `pfContractVersion` column populated at snapshot creation — is more robust but heavier; deferred unless the date cutoff proves fragile.)*

### 5. Generation nudge — `app/capture/[code]/CaptureChatPanel.tsx`

- Before invoking generation, inspect the latest `readiness.covered` for the Area-7 topic token (the exact label the agent emits for productive failure — to be pinned in the plan from `capture-chat-agent.md`). If absent, show a **non-blocking** confirmation: *"Problem-solving (productive failure) wasn't probed — the profile will record it as 'not assessed.' Generate anyway?"* with Generate / Keep auditing.
- On confirm: proceed (PF stays null/not-assessed). On cancel: return to chat. No schema or readiness-contract change; purely a client-side read of the existing `readiness` object.

### 6. Strip disclaimer — `app/program/scaffolding/ScaffoldingStripClient.tsx`

- Render the new `no_data` status as a visually distinct state (e.g. a hollow/gray dot + "no PF data" label), separate from `absent`'s red `· 0.00`.
- Add a course-level tooltip/footnote on the PF dot: *"Productive-failure conditions are assessed at the course level and shown against each sub-competency this course contributes to."*

## Data flow

```
capture chat (Area 7 probed?) ──► synthesis/scores prompt
        │                               │
        │ probed ─────────────────► present PF block (+ reflection evidence)
        │ not probed ─────────────► omit block (null)
        ▼
courseCaptureSnapshots (immutable JSON)
        │
        ▼  scaffolding-queries loader
   createdAt < PF_CONTRACT_EPOCH? ──► force no-data
        │
        ▼  scaffolding.ts
   null PF ──► no-data sentinel (excluded from rollups)
   present PF ──► conditionsScore / reflectionWeight as today
        │
        ▼  pf_status ∈ {well_developed, developing, thin, absent, no_data}
        ▼  ScaffoldingStripClient: no_data rendered distinct + grain disclaimer
```

## Error handling / edge cases

- **No prior PF data anywhere** → cells render `no_data`, rollups flag "capture needed," nothing scores a misleading 0.
- **Present block, all conditions `absent`** → assessed-none; scores 0 legitimately; distinct from `no_data`.
- **Reflection `present`/`partial` with no citation** → schema validation fails at synthesis; the model's conservative recovery is to downgrade to `absent` (correct).
- **Legacy snapshot with a present all-`absent` block** → reclassified to `no_data` by the epoch cutoff (not trusted).
- **Area 7 probed but the course genuinely has no productive failure** → present block with `absent` conditions; honest `absent`, not `no_data`.
- **Readiness object missing/legacy on the client** → nudge treats "can't confirm Area 7 was covered" as not-probed and warns (fail-safe toward honesty).

## Testing

- **Unit (`scaffolding.ts`):** null PF → no-data sentinel (not 0); cumulative PF over data-bearing snapshots only; `no_data` band emitted when all contributors are no-data; `absent` still emitted for assessed-none; rollups exclude `no_data`; `reflectionWeight` not applied to no-data cells.
- **Unit (loader, `scaffolding-queries.ts`):** snapshot `createdAt < PF_CONTRACT_EPOCH` → forced no-data even with a present block; `>=` epoch passes the stored block through.
- **Schema (`capture/schema.ts`):** `superRefine` — `structured_post_mortem` non-`absent` without evidence fails; with evidence passes; `absent` without evidence passes; present-all-`absent` block valid; null block valid. Strict-mode `required`/`properties` audit for the nullable block + new field.
- **UI (`ScaffoldingStripClient`):** `no_data` renders distinct from `absent`; grain disclaimer present. Nudge fires when the Area-7 token is absent from `readiness.covered` and not when present (component-level test or documented manual check).

## Success criteria

- A course never probed for problem-solving shows `no_data` (not `absent · 0.00`) in the scaffolding strip, and is excluded from unproductive-success/premature-pedagogy diagnostics with a "capture needed" flag.
- `capture-scores.md` and `capture-synthesis.md` emit the same PF contract; no fabricated all-`absent` blocks appear in new snapshots.
- A new snapshot crediting `structured_post_mortem` above `absent` carries a resolvable citation, or the reflection is rated `absent`.
- Faculty stopping before Area 7 see the nudge and can still generate; the profile records PF honestly.
- The scaffolding-spec requirement at `2026-05-25-scaffolding-analysis-design.md:61` (distinct "no data" state) is satisfied.

## Out of scope (later steps in the audit sequence)

- Position Capture v1 pre-build changes (step 2).
- Evidence-traceability floor coupling depth scores to resolvable citations (step 3).
- Unified demand/coverage layer + persisted prerequisite edges (step 4).

## Related

- [`docs/superpowers/2026-06-04-capture-adequacy-audit.md`](../2026-06-04-capture-adequacy-audit.md) — origin + the full gap analysis.
- [`docs/superpowers/specs/2026-05-25-scaffolding-analysis-design.md`](./2026-05-25-scaffolding-analysis-design.md) — the "no data ≠ absent" requirement this closes.
- `lib/ai/capture/schema.ts`, `lib/ai/prompts/capture-{scores,synthesis,chat-agent}.md`, `lib/program/scaffolding.ts`, `lib/db/scaffolding-queries.ts`, `app/capture/[code]/CaptureChatPanel.tsx`, `app/program/scaffolding/ScaffoldingStripClient.tsx`.
