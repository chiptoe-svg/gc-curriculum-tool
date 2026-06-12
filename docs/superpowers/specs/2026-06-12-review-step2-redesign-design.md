# Review Screen as Step 2 of 2 — Design

**Date:** 2026-06-12
**Status:** approved (operator evaluation + sketch sign-off in live walkthrough)
**Origin:** Operator: "it is a jumble of information in no particular order. Just a lot!" A full-page render (6,500+ px) confirmed: setup trays lead, presentation blocks occupy 12–42%, the orienting verification question sits at 42%, the editable work at 57–93%, and the Approve button at the very bottom with no signpost. Two visual languages (editorial publication vs. working surface) are interleaved with no cue for what asks for judgment vs. what merely displays output.

## Goal

The review screen becomes an honest **Step 2 of 2**, ordered by the faculty member's verification job, with the exit (Approve) always visible. Presentation blocks become a labeled preview of the output rather than interleaved content. No data-model, route, or synthesis changes — this is layout, ordering, and affordance work on `CaptureClient` (stage frame) and `ProfileReviewPanel` (internal order).

## The order (top to bottom)

1. **Step header** — mirrors Step 1's design language exactly (mono `STEP 2 OF 2 · REVIEW & APPROVE` + progress dots, serif headline `Here's what the auditor concluded.`, one-line sub: check it, adjust it, approve it — nothing is recorded until you approve). Includes the DRAFT status chip and `← Back to the interview`.
2. **"Does this capture your course?"** — the verification summary (course shape, strongest evidence, dimensional patterns, catalog-vs-evidence, foundationals at a glance) moves to position 1 of the content: it is the orienting question.
3. **The work: competency triage** — exactly the existing quick-review zones, unmoved relative to each other: "Worth a look (N)" full cards → "The AI is confident about these (M)" collapsed rows. (Foundationals already live inside the triage; incoming expectations stay in this zone too.)
4. **Audit notes** — the current right rail (prereq gaps, objective misalignments, suggested revisions, revised-objectives draft) becomes a full-width **collapsible** section after the work ("Auditor's margin notes"), collapsed by default.
5. **Departmental context** — the faculty-authored note input, placed after audit notes as part of "before you approve."
6. **Preview the record** — a collapsed disclosure: "What readers will see — the public profile this approval publishes." Contains, unchanged inside: Course Overview (editorial block), Class structure, Major projects, Course emphasis chart. Collapsed by default; the editorial styling stays (it IS the preview of the published page).
7. **Sticky action bar** (bottom of viewport, appears only in the review stage): `⚑/✓ summary chip ("6 worth a look · 5 confident") · Stress-test this profile · Save edits · Approve the profile`. The existing "Done reviewing?" footer card is replaced by this bar. Approve keeps its current semantics + confirmation; stress-test moves here from the top (it's a pre-approval second opinion).

## Removals on the review stage

- The setup trays (`CaptureHelpPanel`, `CanvasImportSummary`, `MaterialsPanel`, `SnapshotHistoryPanel`) do **not** render in the review stage (same treatment the generating stage received 2026-06-12). Snapshot history remains reachable from the chat stage; the materials manager from Step 1.
- The standalone DRAFT banner collapses into the step header's status chip (same words, one place).

## Mechanics

- `CaptureClient`: `stage === 'review'` renders `<ReviewStepFrame>` (new, thin) around `ProfileReviewPanel` — supplies the step header + hides trays. The existing `trays` variable gains `&& stage !== 'review'` (alongside the generating exclusion).
- `ProfileReviewPanel`: section ORDER changes + two new collapsibles (audit notes, preview-the-record) + the sticky bar. Internal components (CompetencyCard, triage logic, SourceBadge, CitationDrawer, StressTestPanel, sliders, flag buttons) are **not** rewritten — they are re-parented. Stress-test results render where they do today (inline on cards/profile); only the trigger button moves into the sticky bar.
- Sticky bar is part of `ProfileReviewPanel` (it owns save/approve state already); `position: sticky bottom-0` with border + bg-card, `z-10`.
- No new routes, no schema, no AI functions. Existing tests must keep passing with selector updates only where section order/labels changed.

## Out of scope (recorded)

Editing the presentation blocks inside the preview (they stay editable exactly as today, just inside the disclosure); any change to triage thresholds; per-section "reviewed" checkmarks (a future progress affordance — the summary chip is v1); mobile-specific layout work.
