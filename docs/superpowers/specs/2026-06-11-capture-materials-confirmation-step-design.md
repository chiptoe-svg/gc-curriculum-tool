# CourseCapture — Materials Confirmation Step (Step 1) — Design

**Date:** 2026-06-11
**Status:** Proposed
**Supersedes:** nothing (refines the 2026-06-10 "goal-first landing" redesign, which over-corrected)

---

## Problem

A faculty member starting CourseCapture on `/capture/<code>` lands on a "goal-first" hero with a
green "Ready to capture — N materials loaded" pill and a **Start the interview** button. The
materials themselves — *what* is loaded and *where each item came from* — are not visible. The only
way to see or change the corpus is to scroll to the bottom of the page and click a small
**⚙ Materials, Canvas import, help & snapshot history** disclosure, inside which the materials
panel is *itself* collapsed by default.

This buries the single most load-bearing pre-flight step. The tool's entire credibility rests on
**evidence-grounded** KUD ratings; if the user can't confirm the corpus the auditor will read,
every downstream rating sits on an unexamined foundation. As the department head put it: a new user
has "no idea what materials it has loaded nor where they came from," and "ensuring that all of the
relevant materials are ingested may be the most important part" of the process. A wizard that pushes
the user straight into the interview has skipped its most important step.

The 2026-06-10 redesign collapsed the materials tray specifically because the panel is **dense**
(token sizes, compress controls, a Canvas-token field, per-item ignore disclosures). The fix must
not simply un-hide that density — that would trade "buried" for "overwhelming." (See
`[[feedback_capture_materials_visibility]]` in auto-memory.)

---

## Goals

1. Make **"confirm your materials"** a visible, deliberate **Step 1** before the interview opens,
   on a genuinely fresh audit.
2. Show, per material, **what it is and where it came from** — filename, a provenance badge
   (Canvas / uploaded / linked doc), and ready/indexing status.
3. Keep that step **clean** — the common task (review + add) is effortless; the dense power
   controls are one click away, not in your face.
4. Make **adding** materials obvious from this step (upload / Canvas import / scan linked docs).
5. Guard the **empty** case (zero materials) without nagging the normal case.

## Non-goals (locked with the operator)

- Not a fuller multi-step wizard (no separate auditor/mode or review steps) — **materials step
  only**, then the existing interview.
- No change to the interview itself, the synthesis, the snapshot model, or the materials **data
  model**. Mutation logic is **reused**, not rebuilt.
- No change to `/courses`, `/view`, or any non-capture surface.

---

## Decisions (all validated interactively)

- **Structure:** explicit **2-step wizard** — Step 1 *Confirm materials* → Step 2 *Interview* — on
  a fresh landing. (Chosen over a promoted-but-skippable single-page section, because confirming the
  corpus deserves a deliberate stop.)
- **Gate:** **soft + empty-guard.** "Continue to interview →" is always available when ≥1 material
  exists (no per-visit friction). With **zero** materials, Continue is replaced by an "Add a
  material to begin" prompt plus a quiet "Start without materials anyway" link.
- **Step 1 view:** **clean review list** + a "⚙ Manage materials in detail" escape hatch to the
  existing dense panel. (Chosen over promoting the full dense panel.)

---

## Architecture

### State — `CaptureClient.tsx`

Today: `isLanding = stage === 'chat' && messages.length === 0`. On landing, the hero + chat-start
render and the rest collapses into the bottom `<details>` disclosure.

Add a landing sub-state:

```ts
const [landingStep, setLandingStep] = useState<'materials' | 'interview'>('materials');
```

- **`isLanding && landingStep === 'materials'`** → render the new `<CaptureMaterialsStep>` *instead*
  of the hero/chat. Nothing else from the landing renders (no bottom gear disclosure).
- **Continue** (`onContinue`) sets `landingStep = 'interview'` → the existing hero + `CaptureChatPanel`
  render exactly as they do today.
- **Not landing** (resuming a saved conversation, `messages.length > 0`; or `stage` is
  `generating`/`review`) → Step 1 never shows. The materials remain reachable from the in-interview
  trays, unchanged. So the gate only appears on a genuinely fresh audit.

Because Step 1 only renders in the fresh-landing case, the bottom `<details>` "⚙ Materials, …"
disclosure that wraps `trays` on landing is **removed from the landing branch** (its materials job
moves into Step 1; Help / Canvas-import-summary / Snapshot-history are folded into Step 1's
secondary area or the interview view — see below). The non-landing rendering of `trays` is
unchanged.

### New component — `app/capture/[code]/CaptureMaterialsStep.tsx`

Presentational + light state. Props:

```ts
interface Props {
  course: CourseCatalogView;
  materials: CaptureMaterial[];
  slug: string;
  onMaterialsChange: (next: CaptureMaterial[]) => void;
  onCourseChange: (next: CourseCatalogView) => void;
  onContinue: () => void;
}
```

Renders:
- **Header:** "Step 1 of 2 · Confirm materials" with a 2-dot progress indicator.
- **Intent line:** "Here's what the auditor will read. Add anything missing before you start."
- **Clean list** — one row per material:
  - 📄 `fileName`
  - **provenance badge** from `materialProvenance(m)` → `Canvas` / `uploaded` / `linked doc`
  - **ready-status** via the existing status indicator (reuse the dot/label already in
    `MaterialsPanel`: `ready` ✓ / `indexing…` pulse / `failed` / `skipped`)
  - a small ↗ link to `blobUrl` for linked/Canvas-file rows (reuse existing behavior)
  - Materials flagged `ignored` / `autoSetAside` render dimmed with their existing treatment.
- **Primary action:** **+ Add a material** — reveals the existing `<MaterialsPanel>` inline,
  expanded (upload / Import from Canvas / Scan linked docs all live there).
- **Escape hatch:** **⚙ Manage materials in detail** — same reveal target (the full `MaterialsPanel`,
  expanded), framed for the power controls (token sizes, compress, per-item ignore, Canvas token).
- **Gate:**
  - `materials.length >= 1` → **Continue to interview →** (enabled).
  - `materials.length === 0` → an "Add a material to begin" empty state with the add controls, plus
    a quiet **Start without materials anyway** link that calls `onContinue`.
- **Secondary (optional, low-emphasis):** the existing `CaptureHelpPanel` link and
  `SnapshotHistoryPanel` can sit below as collapsed affordances, or move into the interview view —
  implementer's call; they are not load-bearing for Step 1.

### Reuse — mutations stay in `MaterialsPanel`

The add/upload/index/Canvas-reextract/scan/ignore/compress logic is **not** re-implemented. Step 1
reveals the existing `MaterialsPanel` inline for all mutations (single source of truth).
`MaterialsPanel` gains one optional prop:

```ts
initiallyExpanded?: boolean; // default false — preserves current collapsed-by-default behavior elsewhere
```

Step 1 mounts `MaterialsPanel` with `initiallyExpanded` when the user opts into add/manage. As
materials change, `onMaterialsChange` already flows back up to `CaptureClient` state, so the clean
list re-renders live (new uploads appear, indexing status updates on refetch).

### New pure helper — `materialProvenance`

```ts
// lib/capture/material-provenance.ts
export type MaterialProvenance = 'canvas' | 'uploaded' | 'linked';
export function materialProvenance(m: {
  blobUrl: string; mimeType: string; /* + whatever the canvas predicates read */
}): MaterialProvenance;
```

Built on the existing `isCanvasMaterial` / `isCanvasFileMaterial` predicates and `blobUrl` scheme
(http(s) off-server link → `linked`; internal blob path → `uploaded`; Canvas-derived → `canvas`).
Pure and unit-tested. (If the existing predicates live privately in `MaterialsPanel.tsx`, lift the
minimal logic into this helper and have both call it — DRY.)

---

## Data flow

`page.tsx` already loads `materials` and passes them to `CaptureClient`. No new fetch. Step 1 reads
the same `materials` array, derives provenance + status per row presentationally, and delegates all
writes to `MaterialsPanel` (which already owns the upload/index/refetch round-trips). Continue is
pure client state (`landingStep`), no persistence — refreshing the page returns to Step 1 on a fresh
audit, which is correct (re-confirm before starting).

---

## Edge cases

- **Indexing in progress:** rows show "indexing…" (existing pulse); Continue is still allowed —
  indexing completes in the background and the auditor reads materials once ready. (Optional nicety:
  a one-line "1 material still indexing — it'll be ready shortly" note; not required.)
- **Zero materials:** empty-guard (above).
- **All materials ignored / set-aside:** treated as non-empty for the gate (rows exist); the dimmed
  treatment signals they won't be read. Not special-cased further.
- **Resuming / prior snapshot exists but `messages.length===0`:** still a fresh audit → Step 1 shows
  (confirming the corpus before a new audit is correct even when a prior snapshot exists).

---

## Testing

- **`materialProvenance`** — unit tests: Canvas-list material → `canvas`; Canvas **File** →
  `canvas`; local upload (internal `blobUrl`) → `uploaded`; off-server http(s) link (Drive/YouTube/
  Google Doc) → `linked`.
- **Gate logic** — a pure predicate (e.g. `canContinue(materialsCount)` / the empty-guard branch)
  unit-tested: ≥1 → continue enabled; 0 → empty state with "start anyway".
- **Render** — light test that on fresh landing (`messages: []`) `CaptureMaterialsStep` renders and
  the interview chat does not; after `onContinue`, the interview renders; and that resuming
  (`messages.length>0`) never shows Step 1.
- Full suite + `tsc` clean.

---

## STATE.md updates on commit

- "What's live" / Active arc: capture landing now opens on a **Step 1 materials-confirmation** gate
  (provenance + add + soft empty-guard) before the interview; refines the 2026-06-10 goal-first
  landing.
- No schema / route / env / AI-function change → only the "What's live" + Active-arc notes.
- Deferred/debt: note the optional "still-indexing" banner and the Help/Snapshot-history placement
  as deferred polish if not built.
