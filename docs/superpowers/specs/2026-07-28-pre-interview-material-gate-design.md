# Pre-interview material-failure decision gate — Design

**Date:** 2026-07-28
**Status:** Design — pending operator review before the implementation plan.
**Origin:** issue #4 follow-up. The image-PDF + linked-material work surfaced that materials can be missing, failed, FERPA-held, or inaccessible — and today those problems are only shown *after the fact* (the materials-health banner, the AI `IngestionCheckIn` heads-up). Faculty should see them **before** the interview and consciously decide: proceed, or pause and annotate. Aligns with the standing "surface + confirm materials before the interview" principle.

---

## 1. Problem

A CourseCapture interview can start on a materials set that is silently under-evidenced:
- **Extraction failed** — a file couldn't be read (contributes zero content).
- **FERPA-held** — a material was auto-set-aside because PII/emails were detected (`ignored && autoSetAside`), so it's excluded from scoring unless faculty override. (E.g. GC 3620 WK1-Intro, Wk15.)
- **Inaccessible / missing link** — a referenced Drive/YouTube/external resource couldn't be fetched (not shared, no transcript, unsupported).

Today these are surfaced *passively* (a dismissable banner, an AI heads-up during the chat) and are easy to miss. There is no explicit pre-interview decision point where faculty either accept the gaps or act on them, and no place to record *why* a gap is acceptable.

## 2. Goals / Non-Goals

**Goals (Increment 1 — this spec)**
- A **checkpoint on the existing `ingest` landing step**: when any material is flagged, require an explicit choice before the interview starts; when nothing is flagged, pass straight through (no new click).
- Group the flags (extraction-failed / FERPA-held / inaccessible-link), let faculty **optionally note** each, and **override FERPA-held** items inline (reusing the existing include-anyway).
- **One** primary "Continue to interview" action (notes are optional, not a click-per-issue).
- Persist faculty notes per material.

**Non-Goals**
- **Scoring integration** (feeding notes into capture-synthesis) — deferred to **Increment 2** (separate spec/plan). Increment 1 persists + displays notes; it does not change scoring.
- **Low-text/skipped** materials are NOT flagged (weaker signal, noise) — only the three buckets above.
- Re-fetching/repairing inaccessible links from the gate (faculty go to the materials step for that).
- Replacing the AI `IngestionCheckIn` (it stays as its in-chat heads-up).

## 3. Design

### 3.1 Classifier — `flagMaterials`
Pure function, no I/O: `flagMaterials(materials: MaterialLike[]): FlaggedMaterial[]`.
```ts
type FlagKind = 'extraction-failed' | 'ferpa-held' | 'inaccessible-link';
interface FlaggedMaterial { id: string; fileName: string; kind: FlagKind; facultyNote: string | null; }
```
Rules (over non-ignored-EXCEPT-ferpa materials):
- **ferpa-held**: `ignored === true && autoSetAside === true`. (These are ignored, so they're evaluated separately from the "active" set.)
- **extraction-failed**: not ignored, `extractionStatus === 'failed'`, AND `materialProvenance(m) !== 'linked'` (linked breadcrumbs are their own bucket).
- **inaccessible-link**: `materialProvenance(m) === 'linked'` AND (`extractionStatus === 'failed'` OR (`indexingStatus === 'skipped'` && no content)). Reuses `materialProvenance` from `lib/capture/material-display.ts`.
- Everything else → not flagged. Empty array = clean capture = no gate.

### 3.2 Component — `MaterialGate`
Renders **only** when `flagMaterials(...)` is non-empty. Location: the `landingStep === 'ingest'` step in `CaptureClient` (the existing pre-interview checkpoint). Presentational + local state for note edits.
- Flags grouped by `kind` with a short human label per group ("Couldn't read", "Held for FERPA review", "Referenced but not accessible").
- Per item: filename + an **optional** note textarea (prefilled from `facultyNote`).
- FERPA-held items additionally show an **Include anyway** control (reuses the existing include-anyway PATCH: `ignored:false, autoSetAside:false`).
- Actions: primary **Continue to interview**; secondary **Back to materials** (existing `onBack` → `setLandingStep('materials')`).

### 3.3 Wiring in `CaptureClient`
The `ingest` step currently renders `IngestStep` (`onIngested → setLandingStep('interview')`). Change: compute `const flags = flagMaterials(materials)`.
- `flags.length === 0` → behave exactly as today (the ingest step advances normally; **no gate, no extra click**).
- `flags.length > 0` → render `<MaterialGate flags={flags} …/>`. **Continue** handler: `await saveGate(flags)` (batch-PATCH items with edited notes and/or include-anyway), then `setLandingStep('interview')`. On any PATCH failure: keep the gate open, surface an inline error, do NOT advance.

### 3.4 Storage
- New **nullable** column `faculty_note text` on `course_materials` (additive migration; no backfill).
- `PATCH /api/courses/[code]/materials/[id]` extended to accept `{ facultyNote?: string }` (alongside the existing `ignored` / `useDigest` patch fields). `updateMaterialMetadata` (or the route) writes it.
- FERPA override reuses the existing `{ ignored: false }` (+ `autoSetAside:false`) PATCH — no new endpoint.

## 4. Data Flow
`materials` (already fetched in `CaptureClient`) → `flagMaterials` → `MaterialGate` → **Continue** → per changed item `PATCH /materials/[id]` (`facultyNote` and/or `ignored:false`) → refresh local `materials` → `setLandingStep('interview')`.

## 5. Error Handling
- PATCH failure on Continue → gate stays open, inline error, no advance (never lose a note silently, never proceed on a failed save).
- No flags → no gate (silent pass-through).
- A FERPA item overridden to include re-enters the normal pipeline (existing behavior); it simply won't be flagged next open.

## 6. Testing
- **`flagMaterials`** unit: each bucket; empty (clean); a linked breadcrumb classifies as `inaccessible-link` not `extraction-failed`; an active `ok` material is not flagged; a non-auto set-aside (manual ignore) is NOT `ferpa-held`.
- **`MaterialGate`** component: renders groups + labels; note textarea prefilled/edited; FERPA item shows Include-anyway; Continue fires with edited notes; renders nothing on empty.
- **Route**: `PATCH …/materials/[id]` persists `facultyNote`.
- **Regression**: a clean capture (no flags) advances `ingest → interview` with no gate (existing flow unchanged).

## 7. Phasing
1. **Increment 1 (this spec):** migration + PATCH `facultyNote` → `flagMaterials` → `MaterialGate` → wire into the `ingest` step.
2. **Increment 2 (separate spec/plan):** thread `faculty_note` into the capture-synthesis context so the scorer sees faculty's explanation of each gap (it already hedges on inaccessible content — this makes the hedge faculty-informed).

## 8. Notes / Risks
- **Reuses**, not rebuilds: the `ingest` landing step, `materialProvenance`, the include-anyway PATCH, and the already-fetched `materials`. New surface is one classifier + one component + one column + one PATCH field.
- The AI `IngestionCheckIn` stays; the deterministic gate is the reliable pre-interview blocker, the AI heads-up remains an in-chat nicety. Overlap is acceptable (different mechanisms, different moments).
