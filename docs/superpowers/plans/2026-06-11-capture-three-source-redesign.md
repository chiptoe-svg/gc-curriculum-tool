# CourseCapture Step 1 — Three-Source Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the Step-1 flat list + the bolted-on `MaterialsPanel` reveal with one coherent surface of three accordion source-boxes — **Syllabus & course info · Canvas · Other materials** — each honest about depth and managed inline.

**Architecture:** A pure grouping helper buckets materials by provenance. Three box components (collapsed summary → unrolled contents + inline actions) reuse the EXISTING endpoints (no new ingestion). `CaptureMaterialsStep` becomes the three-box host. `MaterialsPanel` is **kept** (handlers/endpoints reused; the component stays available as the deep manager) — only its Step-1 *reveal* is removed.

**Tech Stack:** Next.js 15 client components, TS strict (`noUncheckedIndexedAccess`), Vitest + @testing-library/react, Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-11-capture-three-source-redesign-design.md` (read it + its "Resolved in review" section).

---

## Endpoints the boxes reuse (read `MaterialsPanel.tsx` for exact request shapes)

- **Sync sheet:** `POST /api/courses/[code]/sync-from-sheet?slug=` → `{course:{…,lastSyncedAt}}`.
- **Canvas import/reimport:** `POST /api/courses/[code]/canvas-reextract` (needs a Canvas API token — see MaterialsPanel ~line 647; same token field).
- **Scan linked docs:** `POST /api/courses/[code]/scan-linked-docs?slug=`.
- **Upload file:** the upload handler in MaterialsPanel (~line 1014–1072) — POSTs the file; reuse the same route.
- **Ignore whole material:** `PATCH /api/courses/[code]/materials/[id]?slug=` `{ignored}`.
- **Per-item ignore (Canvas lists):** same PATCH with `{ignoredItems}`.
- **Index pending:** `POST /api/admin/v2-backfill?slug=` `{courseCode, slug}`.
- **Refresh materials:** `fetchCourseMaterials(code, slug)` (already in `lib/capture/fetch-course-materials.ts`).

Provenance + parsing helpers already exist: `materialProvenance`, `materialReadability`, `hasFixablyUnindexed`, `catalogContributionSummary`, `relativeTimeFromNow` (in `lib/capture/material-display.ts`); `parseCanvasBlob`, `isCanvasListMaterial` (in `lib/canvas/parseCanvasBlob`); `classifyCanvas` logic lives in MaterialsPanel (lift if needed).

---

### Task 1: `materialsByBox` grouping + box summaries (pure)

**Files:** Modify `lib/capture/material-display.ts`; Modify its test.

- [ ] **Step 1: failing tests** — append:

```ts
import { materialsByBox, isSyllabusCanvasMaterial } from '@/lib/capture/material-display';

const M = (fileName: string, over: Record<string, unknown> = {}) => ({ id: fileName, fileName, indexingStatus: 'ready', ignored: false, ...over } as never);

describe('isSyllabusCanvasMaterial', () => {
  it('matches only the Canvas syllabus list', () => {
    expect(isSyllabusCanvasMaterial({ fileName: 'Canvas: Syllabus' })).toBe(true);
    expect(isSyllabusCanvasMaterial({ fileName: 'Canvas: Assignments' })).toBe(false);
    expect(isSyllabusCanvasMaterial({ fileName: 'syllabus.pdf' })).toBe(false);
  });
});

describe('materialsByBox', () => {
  const mats = [
    M('Canvas: Syllabus'), M('Canvas: Assignments'), M('Canvas File: rubric.pdf'),
    M('YouTube: Lecture'), M('Drive PDF: Spec'), M('handout.pdf'),
  ];
  it('puts the Canvas syllabus in canvas (not other), and buckets the rest', () => {
    const b = materialsByBox(mats);
    expect(b.canvas.map(m => m.fileName)).toEqual(expect.arrayContaining(['Canvas: Syllabus','Canvas: Assignments','Canvas File: rubric.pdf']));
    expect(b.other.map(m => m.fileName)).toEqual(expect.arrayContaining(['YouTube: Lecture','Drive PDF: Spec','handout.pdf']));
    expect(b.other.some(m => m.fileName.startsWith('Canvas'))).toBe(false);
  });
});
```

- [ ] **Step 2: run → FAIL.** **Step 3: implement** in `material-display.ts`:

```ts
import type { MaterialProvenance } from './material-display'; // (already defined above in this file)

/** The Canvas syllabus list, distinctly named by the importer. */
export function isSyllabusCanvasMaterial(m: { fileName: string }): boolean {
  return m.fileName.startsWith('Canvas: Syllabus');
}

export interface BoxedMaterials<T> { canvas: T[]; other: T[]; }

/**
 * Bucket materials into the Canvas box (anything Canvas-provenance, incl. the
 * labeled syllabus) and the Other box (uploads + linked docs). The Syllabus box
 * is the GC-sheet catalog (course fields) + attached syllabi — not derived here.
 */
export function materialsByBox<T extends { fileName: string }>(materials: T[]): BoxedMaterials<T> {
  const canvas: T[] = []; const other: T[] = [];
  for (const m of materials) {
    (materialProvenance(m) === 'canvas' ? canvas : other).push(m);
  }
  return { canvas, other };
}
```
(Place after the existing `materialProvenance`. If `MaterialProvenance` self-import is awkward, just call the local `materialProvenance` directly — it's in the same module.)

- [ ] **Step 4: run → PASS. Step 5: commit** `feat(capture): materialsByBox grouping + syllabus-canvas helper`.

---

### Task 2: `SyllabusBox` component (+ extract `CatalogOverview`)

**Files:** Create `app/capture/[code]/CatalogOverview.tsx`; Modify `app/capture/[code]/MaterialsPanel.tsx` (use the extracted component); Create `app/capture/[code]/boxes/SyllabusBox.tsx`; Create the SyllabusBox test.

**First (resolution 5):** extract the existing "Catalog (from the course sheet)" block from `MaterialsPanel.tsx` (the DESCRIPTION / PREREQUISITES / LEARNING OBJECTIVES / MAJOR PROJECTS / REQUIRED INCOMING SKILLS layout) into a reusable presentational `CatalogOverview` component taking `{ course }` (or the catalog fields). Rewire MaterialsPanel to render `<CatalogOverview .../>` (no behavior change — same markup, just lifted). This is the nice overview the operator wants reused.

Behavior (spec Box 1 + resolutions): Box 1 sits at the **top** as the course-overview summary. **Collapsed:** a one-line course summary + sync status + actions. **Unrolled:** the `<CatalogOverview/>` block. An accordion. **Collapsed:** `▸ 📋 Syllabus & course info — <status>` where status = "synced *X ago*" (sheet) / "Syllabus.pdf attached" / "add a syllabus". Right side: **Re-sync** (when sheet) + **Attach** + (if no syllabus anywhere) a hint to import from Canvas. **A differ-warning** ("⚠ a different syllabus is also attached — review") when both the sheet catalog AND an attached/Canvas syllabus are present. **Unrolled:** the catalog fields (`catalogContributionSummary` expanded to the actual description/objectives/projects/skills, read-only — "edit in Course Builder"), plus a note "(a Canvas syllabus is also available — see Canvas)" when `isSyllabusCanvasMaterial` is present in the materials.

Props: `{ course, catalogSyncedAt, materials, slug, onCourseChange, onMaterialsChange }`. Re-sync → `sync-from-sheet` (reuse the handler pattern from the current `CaptureMaterialsStep.resync`). Attach → upload (reuse the upload route; a syllabus upload is just an uploaded material). Test: collapsed status reflects sheet/attached/empty; unroll shows objectives; Re-sync POSTs sync-from-sheet; differ-warning shows when both sources present. Mock `fetch` + `fetchCourseMaterials`.

- [ ] Write failing test → implement → pass → `pnpm exec tsc --noEmit` clean → commit `feat(capture): SyllabusBox (sheet/attach, differ-warning)`.

---

### Task 3: `CanvasBox` component

**Files:** Create `app/capture/[code]/boxes/CanvasBox.tsx`; Create its test.

Behavior (spec Box 2): accordion over `materialsByBox(materials).canvas`. **Collapsed:** `▸ 🎨 Canvas — <N items · readiness>` (sum of parsed items across Canvas-list materials + file count; readiness = worst-of the materials). Right side: **Import from Canvas** (empty) / **Reimport** (present) — both open a small Canvas-token field + POST `canvas-reextract` (reuse MaterialsPanel's reextract handler shape ~line 630–679); plus **Index now** when `hasFixablyUnindexed(canvas)`. **Unrolled:** the Canvas materials, the syllabus one labeled "(syllabus)"; Canvas-list materials show their `parseCanvasBlob` items each with a **per-item ignore** checkbox (`PATCH …/materials/[id] {ignoredItems}`); Canvas Files show as rows with ignore (`{ignored}`) + readiness. Index-now → `v2-backfill` then `fetchCourseMaterials` → `onMaterialsChange`.

Props: `{ course, materials, slug, onMaterialsChange }`. Test: collapsed shows item count + readiness; unroll lists items; toggling an item PATCHes ignoredItems; Import opens token field + POSTs canvas-reextract; Index now POSTs v2-backfill. Mock fetch + fetchCourseMaterials.

- [ ] Write failing test → implement → pass → tsc clean → commit `feat(capture): CanvasBox (grouped items, per-item ignore, import/index)`.

---

### Task 4: `OtherMaterialsBox` component

**Files:** Create `app/capture/[code]/boxes/OtherMaterialsBox.tsx`; Create its test.

Behavior (spec Box 3): accordion over `materialsByBox(materials).other`. **Collapsed:** `▸ 📎 Other materials — <counts by type>` (e.g. "2 uploads · 3 linked"). Right side: **Add file** (upload route) + **Scan linked docs** (`scan-linked-docs`). **Unrolled:** rows (provenance badge, readability + Index-now, source ↗, ignore). Props `{ course, materials, slug, onMaterialsChange }`. Test: collapsed counts; unroll rows; Add triggers upload; Scan POSTs scan-linked-docs; ignore PATCHes. Mock fetch + fetchCourseMaterials.

- [ ] Write failing test → implement → pass → tsc clean → commit `feat(capture): OtherMaterialsBox (uploads + linked, add/scan)`.

---

### Task 5: Assemble — `CaptureMaterialsStep` becomes the three boxes

**Files:** Modify `app/capture/[code]/CaptureMaterialsStep.tsx`; Modify its test.

Replace the body with: the step header/intent, then `<SyllabusBox/>`, `<CanvasBox/>`, `<OtherMaterialsBox/>` (in that order — Canvas prominent per the operator), a small aggregate footer ("1 active · 1 ignored · ~Xk tok"), and the Continue gate (Continue always available; the empty-guard becomes "no materials *and* no synced syllabus → start-anyway"). **Remove** the old flat list, the `showDetail`/`MaterialsPanel` reveal, the standalone catalog row, and the old per-row unroll (now inside CanvasBox). Keep the `catalogSyncedAt`/`onContinue`/`onMaterialsChange`/`onCourseChange` props. `MaterialsPanel` import is dropped from this file — **the component itself is kept** (resolution 4/6) and stays reachable as the deep **Materials manager** (its own surface, e.g. linked from Course Builder; that wiring can be a follow-up — do NOT delete MaterialsPanel). Update the component test to assert the three box headers render and Continue calls `onContinue`.

- [ ] Write/adjust test → implement → pass → `pnpm exec tsc --noEmit` clean (whole repo) → commit `feat(capture): Step 1 = three source-boxes (Syllabus/Canvas/Other)`.

---

### Task 6: Full suite + tsc + STATE.md

- [ ] `pnpm test` green; `pnpm exec tsc --noEmit` 0 errors.
- [ ] STATE.md: flip the capture entry to the three-box redesign (per spec "STATE.md updates" + resolutions); note `MaterialsPanel` kept (deep manager / Course Builder); Deferred/debt for any open item. Commit.

---

## Self-Review

**Spec coverage:** three boxes → Tasks 2/3/4 + assembly Task 5; honest depth (item counts) → Tasks 1/3; syllabus default-sheet + attach + differ-warning → Task 2 (resolution 1); Canvas syllabus in Canvas box, labeled → Tasks 1 (`isSyllabusCanvasMaterial`) + 3 (resolution 2/3); no schema change → grouping/inference only (resolution 3); keep MaterialsPanel → Task 5 keeps the component, drops only the reveal (resolution 4); reuse endpoints → endpoint map up top.

**Placeholders:** box tasks reference exact endpoints + existing handlers (named with line hints) rather than reprinting ~1,300 lines of MaterialsPanel — the implementer reads that file for request shapes. Pure helper (Task 1) is full code.

**Type consistency:** `materialsByBox`/`isSyllabusCanvasMaterial` (Task 1) consumed by Tasks 3/5. Box props all take `{course, materials, slug, onMaterialsChange}` (+ SyllabusBox also `catalogSyncedAt, onCourseChange`) — matching the host in Task 5. Reuses already-shipped `material-display` + `fetch-course-materials` helpers.
