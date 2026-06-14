# `/view` Full Profile + "Apparent Outcomes" Reframe — Design (Piece 1)

**Date:** 2026-06-14
**Status:** approved design (operator brainstorm 2026-06-14), pre-plan
**Origin:** Operator wants (1) the public `/view/[code]` page to show the *entire* course profile (today it renders a curated subset), and (2) the `revised_objectives_draft` field reframed from a "draft objectives to paste into a syllabus" into **"Apparent outcomes"** — *"based on the materials + interview, this is what the course appears to deliver"* — always produced, shown in both the capture review panel and `/view`.

**This is Piece 1 of a two-piece effort.** Piece 2 — a guided faculty-reconciliation review (hybrid stepper + conversational feedback, per-section feedback reconciled into the profile, with evidence-discipline tracking when faculty override a score) — is deferred to its own design. Piece 1 makes the profile fully visible and reframes the anchor; it adds **no** comment/feedback mechanism (that is Piece 2's core).

## Decisions made in the brainstorm (2026-06-14)

1. **Keep the storage field `revised_objectives_draft`.** It is the key inside immutable snapshots (`course_capture_snapshots.profile` JSONB) and in the strict OpenAI JSON schema. Renaming would break reading every existing snapshot and churn the strict schema for no functional gain. The field stays `z.array(z.string()).nullable()`; it is *surfaced* everywhere as "Apparent outcomes." (A clean rename to `apparent_outcomes` can ride along with Piece 2.)
2. **Always produce it.** The synthesis prompt changes from "only when the audit surfaces objective issues" to "always produce a 3–6 item list of what the course appears to deliver." Schema nullability is unchanged (back-compat); the prompt simply always fills it.
3. **Show everything on `/view`** — including `course_emphasis` (graded-points weighting), which carries per-instructor sensitivity. This is a conscious public-visibility decision by the operator ("all of the final profile should represent the faculty view of the course").
4. **Incoming expectations get K/U/D parity on `/view`** — currently statement-only; bring them to the same depth-chip fidelity as outgoing competencies.

## Scope

### A. "Apparent outcomes" reframe

- **`lib/ai/capture/schema.ts`:** no structural change to `revised_objectives_draft` (`z.array(z.string()).nullable()`). Add a doc comment: "Surfaced in the UI as 'Apparent outcomes' — what the course appears to deliver, derived from materials + interview (legacy field key)."
- **`lib/ai/prompts/capture-synthesis.md` (§6 + the output-shape comment near line 115):** reframe the instruction. New intent: *always* emit a CONSOLIDATED 3–6 item list of **what the course appears to deliver**, grounded in the materials + interview evidence (not a syllabus-correction list, not conditional on finding objective issues). Keep the evidence discipline already in the prompt (no aspirational claims). The JSON key stays `revised_objectives_draft`.
- **`app/capture/[code]/ProfileReviewPanel.tsx`:** the `RevisedObjectivesDraft` component (the `PasteReadyList`) is retitled **"Apparent outcomes"** with the framing line *"Based on the materials and interview, this is what the course appears to deliver."* The copy-to-clipboard affordance stays (still useful), but the footnote drops the "draft to paste" framing in favor of the observation framing. Render condition relaxes to show whenever the list is non-empty (already the case).

### B. `/view` renders the full profile (`app/view/[code]/CapturedView.tsx`)

Today `CapturedView` renders: overview, competencies (with K/U/D `DepthChip`s + evidence), incoming_expectations (statement only), verification_summary, audit_notes. Add read-only sections, matching the file's existing section style (mono-plex uppercase `<h2>` label + body), for the currently-omitted fields:

1. **Apparent outcomes** — render `profile.revised_objectives_draft` (skip if null/empty) as a list under the "Apparent outcomes" heading + the framing line.
2. **Incoming expectations — add depths.** Extend the existing incoming section so each entry shows its `expected_depth` K/U/D via the same `DepthChip` treatment used for outgoing competencies (statement + chips). (The `IncomingExpectationShape` in `CapturedView` must carry `expected_depth`.)
3. **Class structure** — render `profile.class_structure` (skip if null). Mirror the rendering already used on the wiki course page / `ClassStructureSection` in the review panel (read-only).
4. **Major projects** — render `profile.major_projects` (skip if null). Mirror the existing read-only rendering.
5. **Course emphasis** — render `profile.course_emphasis` (skip if null/empty): the per-competency graded-points weighting, under a clearly-labelled "Course emphasis (graded weight)" heading.

All new sections follow CapturedView's null/empty-guard pattern (a section is omitted entirely when its field is absent), so legacy/partial profiles degrade gracefully.

### C. Out of scope (Piece 1)

- Any faculty comment / feedback / reconciliation mechanism (that is Piece 2).
- Renaming `revised_objectives_draft` → `apparent_outcomes` (deferred to Piece 2 if wanted).
- `class_structure` / `major_projects` rendering changes anywhere other than `/view` (review panel + wiki already render them).
- Target-page / matrix changes.

## What is explicitly UNCHANGED
- The profile schema shape (field keys, nullability) — so existing immutable snapshots read unchanged.
- The capture pipeline, synthesis structure, snapshot model (only the §6 prompt text + UI rendering change).
- The review panel's edit/flag/reviewerNote behavior.
- The auth model (`/view` stays public read-only).

## Graceful-degradation note
Already-captured snapshots carry `revised_objectives_draft` under the *old* "corrected objectives" semantics; they will display under the new "Apparent outcomes" label until the course is re-captured. Acceptable — the reframe applies to all new captures, and old content is still a reasonable list of outcomes.

## Testing
- **Strict-schema walker test** (`lib/ai/analyze` / capture schema audit) still passes — the field is unchanged.
- **`CapturedView` component tests:** for each new section (apparent outcomes, incoming-with-depths, class structure, major projects, course emphasis) — renders when the field is present; the section is absent when the field is null/empty. Incoming entries show K/U/D chips.
- **Review panel:** the relabeled "Apparent outcomes" block renders with the new title/framing; existing render conditions intact.
- No new AI-output assertion (the prompt reframe is exercised by real captures; the schema gate is unchanged).
