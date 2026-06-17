# Capture Step 1 — Guided, Canvas-First Source Sequence — Design

**Date:** 2026-06-17
**Status:** Proposed
**Surface:** `app/capture/[code]/CaptureMaterialsStep.tsx` (container) + the three boxes (`boxes/CanvasBox.tsx`, `boxes/SyllabusBox.tsx`, `boxes/OtherMaterialsBox.tsx`) + `CaptureWhyBlurb.tsx`
**Related:** CourseCapture Step-1 three-source redesign (2026-06-11)

---

## Problem

Step 1 ("Confirm materials") shows three source boxes (Syllabus, Canvas, Other)
all at once, equally weighted. There's no sense of order or completeness, and the
top framing paragraph is narrower than the boxes (a `max-w-2xl` cap on
`CaptureWhyBlurb`), so the layout reads slightly ragged. Operators want a
**guided, step-by-step** feel that nudges instructors to surface *everything*
around the course before the interview, while keeping the full controls available.

## Goals

1. **Layout polish** — top paragraph spans the same width as the boxes; a short
   labeled **Instructions** paragraph stresses adding everything around the course
   (more is better) so the AI has full background.
2. **Canvas-first guided sequence** — reorder to Canvas → Syllabus → Other, and
   reveal them one at a time so it reads as a progression, without becoming a
   locked wizard.

## Decisions (locked with operator, 2026-06-17)

1. **Addressed-state-driven gating.** A source that is already *addressed* shows
   its normal "done" controls and unlocks the next automatically. **Addressed =
   imported / synced / explicitly skipped.** So a populated course (or a fresh
   course whose syllabus is already synced from the Google Sheet) shows the full
   reordered view with nothing grayed; the guided Skip/Import affordances appear
   only for sources not yet touched. (NOT "always re-run the guided flow on every
   entry.")
2. **Skip is non-blocking guidance.** Skip means "nothing to add from this
   source"; it unlocks the next box but never blocks **Continue to interview**.
   Continue keeps its existing empty-guard (offers "start without materials
   anyway" only when truly empty).

## Design

### A. Layout (container + blurb)

- **Widen the blurb.** Drop `max-w-2xl` from `CaptureWhyBlurb` (or pass a width
  override) so it matches the box column width. The blurb is shared with the Step-2
  hero, so gate the change behind a prop (e.g. `wide`) rather than changing it
  globally.
- **New Instructions paragraph**, below the existing "Three sources…" line, label
  styled like the other Step-1 mono-caps labels (`INSTRUCTIONS`). Copy (final
  wording in the plan): surface *everything* that surrounds this course — Canvas,
  syllabus, assignment sheets, rubrics, project briefs, slide decks, readings,
  exemplars — because the AI can only reason from what's here, and **more is
  better**: thin input yields a thin record.

### B. Box order

Render **Canvas → Syllabus → Other materials** (currently Syllabus → Canvas →
Other). Pure reorder of the three `<...Box>` elements in `CaptureMaterialsStep`.

### C. Gating state machine (container-owned)

The container computes, per box, an `addressed` boolean and derives a `locked`
boolean; each box receives `locked` (gray + non-interactive) and, when it's the
active fresh step, renders simplified Skip/Import controls.

**`addressed` per source:**
- **Canvas** — has any Canvas-sourced material imported, OR Canvas was skipped this session.
- **Syllabus** — `catalogSyncedAt != null` (synced), OR a syllabus was imported/replaced, OR skipped this session.
- **Other** — has any non-Canvas, non-syllabus material, OR skipped this session.

**`locked` rule (Canvas → Syllabus → Other order):** a box is **locked** iff it is
**not** addressed **and** any box *before it in the order* is not addressed.
Equivalently: a box is interactive when it's already addressed, or every prior box
is addressed. Consequences:
- Canvas is never locked (first in order).
- Syllabus is interactive if synced/addressed (the common fresh case) regardless of Canvas.
- Other unlocks once Canvas **and** Syllabus are addressed.

**Skip state** is **session-local** (React state in the container), not persisted.
On reload, addressed-ness is recomputed from real data; a skipped-but-still-empty
source re-locks until skipped again or its predecessor is addressed. Deliberate
simplification — "addressed = has data" is the durable signal; persisting skip
would need a schema/endpoint and isn't worth it for a guidance affordance.

### D. Per-box controls

Each box gets a **fresh (unaddressed-but-unlocked)** presentation in addition to
its existing **done** presentation. When `locked`, the box is grayed and its
header shows a muted "—" / lock affordance, collapsed.

- **Canvas (fresh):** header `🎨 Canvas — not imported yet` + two buttons:
  **Import** (expands the existing URL/token import form) and **Skip**. Done state
  is the current rich header (imported N items · ready, Reimport, Linked docs).
- **Syllabus (fresh):** header + three buttons: **Use Existing**, **Import**,
  **Skip**. **Use Existing is enabled only if a Canvas-sourced syllabus material
  exists** (Canvas import can carry a "Canvas: Syllabus" item); clicking it adopts
  that as the syllabus source. Done state is the current rich header (synced …,
  Re-sync, Replace syllabus).
- **Other (fresh):** header + **Add files** (existing) and **Skip**. Done state is
  the current rich header (N linked, Add files).

Acting on any box (Import success, Use Existing, sync, add files, **or** Skip)
sets that source `addressed`, which unlocks the next via the `locked` recompute.

### E. Unchanged

- **Material tools** disclosure, the large-corpus token warning, **Continue to
  interview** + its empty-guard, the instructor select, and all existing box
  internals (import form, FERPA include-anyway, per-row controls) are untouched.
- The end state of a fully-addressed course is the current view, reordered
  Canvas-first — "looks much like it looks now."

## What this does NOT do

- No schema change, no new endpoint, no persisted skip state.
- No change to the interview (Step 2) or synthesis.
- No change to box internals beyond adding the fresh-state header/buttons and a
  `locked` prop.

## Testing

- **Container gating unit tests** (`CaptureMaterialsStep` / new): the `locked`
  derivation across the key states — (a) all fresh, syllabus unsynced → only
  Canvas interactive; (b) fresh + syllabus synced (the "unpopulated" screenshot) →
  Canvas + Syllabus interactive, Other locked; (c) skip Canvas → Syllabus stays /
  Other still locked until syllabus addressed; (d) fully populated → nothing
  locked; (e) Skip never disables Continue.
- **Box render tests**: Canvas fresh shows Import/Skip; Syllabus fresh shows Use
  Existing disabled when no Canvas syllabus exists and enabled when it does; Other
  fresh shows Add files/Skip.
- Existing box test suites (`SyllabusBox.test.tsx`, `OtherMaterialsBox.test.tsx`)
  must stay green; update where the `locked`/fresh props change rendered output.

## Risks

- **Box components are large** (`CanvasBox` ~984 lines); the fresh-state additions
  must not disturb the done-state paths. Keep the fresh controls a clearly-separated
  header branch keyed on `locked` / `addressed`.
- **"Use Existing" feasibility** depends on Canvas import tagging a syllabus
  material; if none exists the button is simply disabled — no failure mode.
- **Shared blurb** is used on the Step-2 hero too; the width change must be
  prop-gated so Step 2 is unaffected.
