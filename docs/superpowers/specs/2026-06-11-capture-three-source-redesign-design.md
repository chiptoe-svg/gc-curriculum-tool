# CourseCapture Step 1 — Three-Source Redesign — Design

**Date:** 2026-06-11
**Status:** Proposed (supersedes the Step-1 surface from `2026-06-11-capture-materials-confirmation-step-design.md` + `…-capture-entry-refinements-design.md`)

---

## Problem

The current Step-1 confirm screen is **two bolted-together UIs**: a thin clean list (catalog row + a flat list of individual materials) and, below it, an inline reveal of the ~1,300-line `MaterialsPanel` — which re-shows the catalog and the materials with entirely different styling and its own action bar. The result:

- **Misrepresents depth.** "Canvas: Syllabus" + "Canvas: Assignments" reads as *"two materials = everything,"* when "Canvas: Assignments" alone is a bundle of 23 graded items and the real corpus (catalog objectives/projects, linked docs, uploads) is much larger.
- **Looks duplicative and unrelated.** The clean summary and the "Manage materials in detail" panel show the same catalog + materials twice, styled differently, so they read as two separate features rather than one.
- **Flat list is the wrong unit.** Individual materials as peers ("Canvas: Syllabus", "Canvas: Assignments", a YouTube row, an upload row, …) doesn't match how a faculty member thinks about *what they're attaching*.

## The reframe (from the operator)

On the first screen you're really doing **three things**, each a single collapsible box that grows when you unroll it:

1. **Attach a syllabus / course info.**
2. **Attach Canvas.**
3. **Import other materials.**

Each box: a one-line summary + its primary action when collapsed; unroll to see **everything inside it** and manage it. Three concise boxes, honest about depth, no separate panel. Then **Continue → the interview.**

---

## Goals

1. Replace the Step-1 flat list **and** the separate `MaterialsPanel` reveal with **one coherent surface of three source-boxes** (Syllabus, Canvas, Other materials), consistently styled.
2. Each box is an **accordion**: collapsed summary (status + count + primary action) → unrolled contents (full list + inline management).
3. **Honest depth** — the collapsed summary conveys what's inside (e.g. "23 items", "synced 20d ago", "3 PDFs · 2 videos"), never a misleading "2 items."
4. **Generalize beyond GC** — the Syllabus box is a *source slot*: synced-from-sheet (free default) **or** attach a file **or** import from Canvas, so non-GC / external users can use the tool without a Google-Sheet tab.
5. Reuse the existing handlers (sheet sync, Canvas import/reimport, upload, scan-linked-docs, per-item ignore, index/backfill); no new ingestion logic.

## Non-goals

- No change to the audit/synthesis logic, the indexing pipeline, or the materials **data model** beyond (possibly) a way to mark which material is "the syllabus" (see Open Questions).
- Not redesigning the interview, review, or any non-capture surface.
- The deep, rarely-used controls (compress, FERPA overrides, digest toggles) can remain reachable but need not all surface on first glance — progressive disclosure still applies *within* a box.

---

## The three boxes

Each box renders collapsed by default as: `▸ <icon> <Title>  ——  <summary/status>  [primary action(s)]`. Clicking the row (or chevron) unrolls it. A box with content shows a count/status; an empty box shows its "add" affordance prominently.

### Box 1 — Syllabus & course info  *(a source slot — choice of three)*

**Purpose:** the course's syllabus / catalog context the auditor reads (today: the `# Course catalog` block — description, prerequisites, learning objectives, major projects, skills).

**Source choices (the novel part):**
- **Synced from the GC curriculum sheet** — the free default. If the course has a synced sheet tab, the box is *already filled*; collapsed shows "synced *X ago*" + **Re-sync**. Unroll shows the catalog fields (read-only; edit in Course Builder).
- **Attach a syllabus** — upload a syllabus document (PDF/DOCX). For courses with no sheet tab (external/other-department users).
- **Import from Canvas** — pull the course's Canvas **syllabus page** specifically (distinct from the Canvas box's assignments/modules/etc.).

**Collapsed summary examples:** `synced 20d ago` · or `Syllabus.pdf attached` · or `from Canvas` · or (empty) `Add a syllabus: [Sync sheet] [Attach] [Import from Canvas]`.

**Unroll:** shows whatever syllabus content is present — the catalog fields and/or the attached/Canvas syllabus text — plus the source actions.

### Box 2 — Canvas

**Purpose:** everything imported from Canvas **except** the syllabus page (assignments, quizzes, modules, pages, discussions, Canvas Files).

**Collapsed summary:** item/material count + readiness, e.g. `23 items · ready` or `not imported yet`. Primary action: **Import from Canvas** (needs the Canvas API token, as today) or **Reimport** when already present (refreshes — and picks up rubrics where they exist).

**Unroll:** the Canvas materials, grouped by kind (Assignments → its items, Modules, Quizzes, Files…). Canvas-list materials show their parsed items (reusing `parseCanvasBlob`) with **per-item ignore** toggles; Canvas Files show as rows with ignore + status. Per-material readiness ("ready" / "not indexed yet") with **Index now** where fixable.

### Box 3 — Other materials

**Purpose:** uploads and linked/referenced materials — uploaded PDFs/DOCX, YouTube transcripts, Drive PDFs, Google Docs/Slides/Sheets.

**Collapsed summary:** count by type, e.g. `2 uploads · 3 linked docs` or `none yet`. Primary actions: **Add file** (upload) and **Scan linked docs** (pull YouTube/Drive/Google referenced inside existing materials).

**Unroll:** the rows, each with provenance badge, readiness/Index-now, source ↗ link, and ignore.

---

## Data mapping (no new ingestion)

Every existing material maps to a box by its filename-prefix provenance (already computed):
- `Canvas: Syllabus` → **Box 1** (the Canvas syllabus, when used as the syllabus source) — or, if a sheet/upload is the chosen syllabus, it can live under **Box 2** as a Canvas item. (See Open Questions.)
- Other `Canvas:` / `Canvas File:` → **Box 2**.
- `Google Doc:`/`Slides:`/`Sheet:`/`Drive PDF:`/`YouTube:` → **Box 3** (linked).
- Plain uploads → **Box 3** (uploaded).
- The GC-sheet catalog (course.description/objectives/projects/skills) → **Box 1** content.

The "aggregate truth" line (active/ignored/token estimate) can sit at the panel footer or per box.

---

## Implementation approach

This consolidates the thin Step-1 panel and the `MaterialsPanel` reveal into one component (`CaptureMaterialsStep` grows into the three-box surface; the separate inline `MaterialsPanel` reveal on this screen is removed). **Reuse, don't rewrite, the logic:** the upload / Canvas-reextract / scan-linked-docs / ignore / setIgnoredItems / index handlers already exist in `MaterialsPanel`. Extract the load-bearing handlers (or the whole material-mutation logic) into a hook/module both can share, and build the three-box presentation on top. `MaterialsPanel` may remain as the dedicated full manager reachable elsewhere (e.g. Course Builder), but it is no longer the Step-1 escape hatch.

Given the size, the build will be a multi-task plan: (1) a `materialsByBox` grouping helper (pure, tested); (2) shared mutation hook extracted from `MaterialsPanel`; (3) the Syllabus box (3-source slot); (4) the Canvas box (grouped items + per-item ignore + index); (5) the Other box (uploads + linked + scan); (6) wire into the step, remove the old reveal; (7) suite + STATE.md.

---

## Open questions (to resolve in spec review)

1. **Syllabus slot vs. material.** Is "the syllabus" a single logical slot (one source wins) or can a course have a sheet catalog *and* an attached syllabus *and* a Canvas syllabus simultaneously? Proposal: **show all present sources in Box 1, with the sheet as the free default**; don't force exclusivity — but mark which is "the syllabus" only if needed. Needs a call on whether to add a `course_materials.role = 'syllabus'` marker or infer it (Canvas: Syllabus filename + an "is syllabus" flag on uploads).
2. **Where the Canvas syllabus page lives** — Box 1 (as a syllabus source) or Box 2 (as a Canvas item), or both (shown in Box 1 when it's the syllabus, still counted in Canvas). Proposal: surface it in **Box 1** when present; keep it out of Box 2's count to avoid double-listing.
3. **Reimport scope** — does "Reimport Canvas" refresh everything (syllabus + assignments + …) in one call, or per-box? Proposal: one Canvas import refreshes all Canvas-sourced materials (existing behavior); Box 1 just *surfaces* the syllabus slice.

---

## Testing

- Pure `materialsByBox(materials)` grouping (canvas/other/syllabus) — unit-tested across provenance types.
- Each box component: collapsed summary reflects contents; unroll shows the right items; primary actions call the right endpoints (mocked).
- Per-item ignore in the Canvas box calls `setIgnoredItems`; Index-now calls v2-backfill; Re-sync calls sync-from-sheet; upload/scan reach the existing handlers.
- Full suite + `tsc` clean.

---

## STATE.md updates on commit

- Active arc / What's live: Step 1 redesigned into **three source-boxes** (Syllabus [sheet/attach/Canvas] · Canvas · Other materials), each an accordion with honest depth + inline management; the separate `MaterialsPanel` reveal on the capture screen is retired (panel may live on in Course Builder).
- Deferred/debt: anything from the Open Questions deferred; the `MaterialsPanel`'s remaining home; whether a `syllabus` role marker was added.
