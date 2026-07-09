# Draft / Snapshot Clarity + Version Legibility — Design

**Date:** 2026-07-09
**Status:** Design approved (brainstorm) — implementation plan not yet written.
**Depends on:** the Explore adopt work (`feat/explore-adopt`, #188) — this design references `adoptScenario` and the draft's adopt overlay. Build on top of that branch (or after it merges to `main`).

---

## Problem

The tool has two stores for a course's captured profile, and nothing in the UI makes the distinction legible:

- **Working draft** — `course_capture_profiles`, **one mutable row per course**. What faculty edit in the review panel. Overwritten wholesale on every save (full-document JSONB, no diffs).
- **Snapshots** — `course_capture_snapshots`, **immutable, append-only** point-in-time copies. Created only on an explicit "Save Snapshot"; never edited in place; soft-retired via `retired_at`. Each is a complete standalone copy of the profile.

Faculty see "a thing they edit" and a "Save Snapshot" button but have no mental model of *working copy vs frozen versions*. Two operations **replace the single draft** — `loadSnapshotAsDraft` ("use as draft") and the new **adopt** (#188) — and the second does it with only a bare confirm dialog. Worse: loading/adopting restores a snapshot's **scored profile** but does **not** rewind the live **materials / Canvas** corpus (those are course-level state, independent of snapshots). So a forked draft can carry an old profile scored against a materials set that has since changed — an invisible mismatch.

This design makes the model legible and turns the mismatch into an explicit, specific warning.

## Scope — five surfaces

### 1. Working-draft status strip (capture page)
A persistent strip on `/capture/[code]`:

```
Working draft · edited · last snapshot Jun 15 · forked from "pre-trapping baseline"
```

- Status = the draft's `reviewer_status` (`edited` / `confirmed` / `ai_drafted`).
- "last snapshot {date|never}" from the latest non-retired snapshot.
- "forked from …" appears only when `source_snapshot_id` is set (load/adopt-derived draft), naming the source snapshot's caption/date.

### 2. Inputs-drift banner (capture page)
Shown **only** when the draft's `source_snapshot_id` is set **and** the materials diff is non-empty. A prominent amber banner below the status strip:

> **Materials have changed since the snapshot this draft was forked from.** *(roll-down)*

Roll-down lists specifics from `diffInputsVsSnapshot`:
- **Added** — material present now, absent in the snapshot's frozen list.
- **Removed** — in the snapshot's list, gone/retired now.
- **Changed** — same `id`, delta in `extraction_status` / `size_bytes` / `ignored` (re-indexed, content replaced, ignore flag flipped).
- **Canvas re-imported / docs re-scanned** — course `canvas_imported_at` ≠ the snapshot's `inputsMeta.scanPasses.canvasImportedAt` (and docs equivalent).

Legacy snapshots with an empty/absent `inputsMeta.materials` render "inputs record unavailable for this snapshot" — never a false "everything removed."

### 3. Adopt confirm dialog names what it replaces
The enabled adopt button's `window.confirm` (currently generic) mirrors the load-snapshot dialog and names the target:

> "Adopt this scenario as {code}'s next planned version? This replaces your current working draft{, and unsaved edits will be lost — if the draft is `edited`} (snapshots are not affected)."

(`loadSnapshotAsDraft`'s panel already has an equivalent dialog; adopt gains parity.)

### 4. Course-list row verbs (`/courses`)
Row-click stays the primary action, with a **state-dependent label**; the read/explore/versions actions become explicit right-side verbs.

```
GC 3460  Digital Imaging   [captured]   View Course · Explore Changes · 3 versions →
└─ row click → Edit Course (/capture)

GC 4210  Packaging Design   [not-started]   Explore Changes →
└─ row click → Capture Course (/capture)
```

- **Row click → `/capture/[code]`**, labeled **Capture Course** when no draft exists yet, **Edit Course** once a draft exists.
- **View Course** → `/view/[code]` (read-only current profile). Hidden for `not-started` (nothing to view).
- **Explore Changes** → `/explore/[code]` (replaces the current "💬 Ask" label — the surface is the thinking-partner now, not just Q&A).
- **N versions** → deep-link into the history panel (see 5), shown only when ≥1 snapshot exists.
- **Prereqs** link stays but demotes to a quiet secondary (different concern — the Q2 prerequisite view).

The state keys off the existing per-course status (`not-started / in-audit / ai-drafted / reviewed / captured`) already computed for the row.

### 5. Versions affordance
Reuses the existing inline `SnapshotHistoryPanel` on the capture page **unchanged in function** (expand → verification summary; actions → "use as draft" + retire/restore). This design only:
- adds the **"N versions"** count/link on the `/courses` row, deep-linking to `/capture/[code]?panel=history` (opens the capture page anchored to the history panel).

Read-only rendering of a *past* version is explicitly **out of scope** — "View Course" is current-only.

## Data / schema

One additive migration:

- **`course_capture_profiles.source_snapshot_id text NULL`** — the drift baseline anchor.
  - Set by `loadSnapshotAsDraft` → the loaded snapshot id.
  - Set by `adoptScenario` → `scenario.baselineSnapshotId`.
  - `null` for fresh captures (→ no drift banner; correct, they're built against current materials).
  - Surfaced through `getCaptureProfileByCourse` (and the draft row mapper).

No change to snapshots (they already freeze `inputsMeta.materials` + `inputsMeta.scanPasses`, which is exactly the diff source). No change to the OpenAI strict scorer schema (this is draft-metadata, never scorer output).

## Pure core

- **`diffInputsVsSnapshot(snapshotInputsMeta: InputsMeta, currentMaterials, course) → InputsDrift`** where

```ts
interface InputsDrift {
  available: boolean;                 // false for legacy snapshots w/ no frozen materials
  added: MaterialRef[];
  removed: MaterialRef[];
  changed: Array<{ id; fileName; was; now }>;  // status/size/ignored deltas
  canvasChanged: boolean;
  docsChanged: boolean;
}
```

  - Join on material `id`. `changed` compares `extraction_status` / `size_bytes` / `ignored`.
  - `canvasChanged` = `course.canvasImportedAt !== inputsMeta.scanPasses.canvasImportedAt`; `docsChanged` similarly for `googleDocsScannedAt`.
  - `available:false` when `inputsMeta.materials` is empty/absent (legacy) — callers render the "record unavailable" note.
  - Pure, no I/O; the capture page composes it server-side: draft → `source_snapshot_id` → `getSnapshotById` → `inputsMeta`, vs `listMaterialsByCourse(courseCode)`.

## Known caveats (accepted for v1)

- **`id` is the join key.** A delete-then-re-upload of the same file is a new `id` → reads as *removed + added* (arguably correct — it is a different row).
- **Content-change-without-size-change is invisible.** Size/status deltas catch re-extraction and replacement; an edit to the exact same byte size wouldn't flag. A content hash would close this later — deferred, not needed for v1 (re-extraction usually bumps `extraction_status` anyway).

## Testing approach

- **`diffInputsVsSnapshot`** — unit tests: added/removed/changed, canvas/docs change, legacy `available:false`, no-drift.
- **Inputs-drift banner** — component tests: drift present (roll-down specifics), drift absent (no banner), `source_snapshot_id` null (no banner), legacy snapshot ("record unavailable").
- **Status strip** — component tests: the `edited`/`confirmed` + "forked from" states.
- **Row verbs** — component tests: `not-started` (Capture Course, no View, no versions) vs `captured` (Edit Course + View Course + Explore Changes + N versions).
- **`source_snapshot_id`** — query round-trip test (set by adopt + load-snapshot, read back by `getCaptureProfileByCourse`); migration applied to dev DB.

## Out of scope (YAGNI / deferred)

- Read-only rendering of past versions (`/view?snapshot=<id>`) — decided out; "View Course" is current-only.
- Content-hash change detection — size/status delta is enough for v1.
- A full versions list duplicated on `/courses` — link/count only; one canonical inline panel.
- Auto-snapshot on edit — unchanged; snapshots stay explicit ("Save Snapshot").

## Relationship to adopt (#188)

Adopt already writes the draft from a scenario + baseline snapshot and stamps `adopted_from_scenario_id`. This design adds the `source_snapshot_id` stamp on that same write, gives adopt a replace-naming confirm dialog (item 3), and ensures a freshly-adopted draft whose live materials have moved on since the baseline snapshot shows the drift banner (item 2). Together they close the "planned profile vs current evidence corpus" legibility gap that adopt otherwise leaves implicit.
