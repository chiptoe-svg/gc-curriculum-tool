# CourseCapture Entry Refinements — Design

**Date:** 2026-06-11
**Status:** Proposed
**Builds on:** `2026-06-11-capture-materials-confirmation-step-design.md` (the Step 1 gate, now live)

---

## Problem

A live walkthrough of the just-shipped Step 1 materials gate surfaced four concrete problems, all in the CourseCapture entry experience:

1. **The header is over-stuffed and partly meaningless.** It reads `CourseCapture · v1` with a right-side nav of `Guide ↗ · Program · Settings · 💬 Ask · Explore → · Feedback`. The version tag is inaccurate; `Settings` is a developer AI-tier knob; `Program`/`Ask` are cross-surface; and — most telling — there is **no "Course List" link**, the one navigation a faculty member actually needs.

2. **Step 1 omits the Google Sheet catalog source.** "Here's what the auditor will read" lists only `courseMaterials`, but the auditor's at-rest context (`audit-agent.ts`) also includes a `# Course catalog` block built from the course's description / prerequisites / learning objectives / major projects / skills — all synced from the **GC curriculum Google Sheet**. That source is invisible on the confirm screen.

3. **`pending` materials are shown as if the auditor will read them — but it can't.** A material is only readable once `indexing_status = 'ready'` (embedded in the vector store). `pending` means imported-but-not-indexed; the retrieval tools can't see it. Step 1 shows a neutral grey "pending" with no explanation and no way to fix it. (A backlog of un-indexed setup-era materials made this visible; that data has now been backfilled, but the UI must stay honest going forward — including for materials that genuinely *can't* be indexed: unshared Google Docs, caption-less YouTube, ignored syllabi.)

4. **Canvas-list materials can't be unrolled.** A row like "Canvas: Assignments" is a *bundle* of many items (the individual assignments). On Step 1 you can't see what's inside it, so you can't tell what was actually pulled from Canvas. (The dense detail panel already has this disclosure; Step 1 doesn't.)

---

## Goals

1. **Trim the capture header** to what's useful at this juncture: **Course List · Guide ↗ · Feedback**. Drop the `· v1` tag, `Program`, `Settings`, `💬 Ask`, and `Explore →`.
2. **Add a GC-curriculum-sheet catalog source** to Step 1 — a distinct row with a "GC curriculum sheet" badge, a "synced *X ago*" timestamp, and a **Re-sync** button that re-pulls the course's Sheet tab in place.
3. **Make material status honest + actionable** — `pending`/`failed` read as "not readable yet" with the reason where known; an **Index now** action runs the indexing backfill for the course's materials. Canvas import/update stays reachable in the flow.
4. **Unroll Canvas-list materials** on Step 1 — expand a "Canvas: Assignments"-type row to see the item titles it pulled in (reusing the existing parser).

## Non-goals

- No change to the audit/synthesis logic, the materials data model, or the indexing pipeline itself.
- Not rebuilding the dense `MaterialsPanel` — Step 1 reuses it for deep management; these changes are additive to the Step-1 surface (plus the header).
- Not auto-fixing unindexable sources (unshared Docs, caption-less YouTube) — those are source-side; we only *surface* them clearly.

---

## Design

### 1. Header trim — `app/capture/[code]/page.tsx`

Replace the header's left label `CourseCapture · v1` with just **`CourseCapture`** (keep the `{code} — {title}` line below it). Replace the right-side nav cluster with exactly three links:

- **Course List** → `Link` to `/courses?slug=${slug}` (the faculty roster). *New — currently missing.*
- **Guide ↗** → unchanged (external how-to).
- **Feedback** → unchanged (`<FeedbackLink />`).

Remove the `Program`, `Settings`, and `💬 Ask` `Link`s and the `Explore →` `Link`. (They remain reachable at their own URLs / the faculty hub.) This is a pure JSX edit — no logic, no new deps.

### 2. Catalog source row — Step 1

Thread the catalog's last-sync time to the step: `page.tsx` already loads the full `course` row (which has `lastSyncedAt`). Pass a new prop `catalogSyncedAt: string | null` (ISO string) through `CaptureClient` → `CaptureMaterialsStep` (do **not** widen `CourseCatalogView`, which is shared with `MaterialsPanel`).

Render a **catalog source row** at the top of the Step-1 list, visually distinct from file rows (e.g. a 📋 icon instead of 📄):
- Label: **GC curriculum catalog**
- Badge: **GC curriculum sheet** (a fourth provenance-style badge, distinct styling)
- A one-line contribution summary from a new pure helper `catalogContributionSummary(course)` → e.g. *"description · 5 learning objectives · prerequisites · 2 major projects · skills"* (only non-empty fields; "no catalog details synced yet" when all empty).
- A **synced *X ago*** relative timestamp from `catalogSyncedAt` (reuse a relative-time formatter; null → "not synced yet").
- A **Re-sync** button → `POST /api/courses/[code]/sync-from-sheet?slug=` (exists; returns the updated course). On success, update the step's `course` (via `onCourseChange`) and re-render the summary + bump the timestamp; on 404 (no sheet tab — e.g. Specialty courses) show a quiet inline "no sheet tab for this course"; on other error a quiet failure note. Disabled + "Re-syncing…" while in flight.

The catalog row is **intrinsic** — no remove/ignore control. It is always shown (even in the materials-empty state), so the empty-guard no longer reads as "the auditor has nothing."

### 3. Honest + actionable material status — Step 1

Extend the status presentation:
- A new pure helper `materialReadability(m)` → `{ readable: boolean; label: string; reason?: string }`:
  - `ready` → `{ readable: true, label: 'ready' }`
  - `indexing` → `{ readable: false, label: 'indexing…' }`
  - `pending` → `{ readable: false, label: 'not indexed yet' }`
  - `failed` → `{ readable: false, label: "couldn't be read", reason: 'extraction failed' }`
  - `skipped` → `{ readable: false, label: 'not readable', reason: <from setAsideReason if present, else 'no extractable content (e.g. unshared doc / no captions)'> }`
- Each row shows the label; non-readable rows render in a muted/attention treatment (not the same as `ignored`-dimmed) and show the reason inline when present.
- **Index now action:** when the course has ≥1 material that is `pending` or `failed` (i.e. fixably-unindexed), show an **Index now** button in the step's action row. It `POST`s `/api/admin/v2-backfill?slug=` `{ courseCode, slug }` (the faculty page is already behind the same Basic Auth the route requires; `checkAdminAuth` accepts the slug). While running: "Indexing…", disabled; on completion, refresh the materials (re-fetch via the existing materials-refetch path / `router.refresh()`), so rows flip to `ready`. Materials that *can't* be indexed stay non-readable with their reason — that's the honest outcome.
  - **Note (acceptable for the single-user LAN model):** reusing the admin `v2-backfill` route from a faculty surface is a slight layering shortcut; faculty and admin share one Basic Auth tier here, so it's fine. A dedicated faculty-tier `POST /api/courses/[code]/index-materials` is a possible later refactor (Deferred).
- **Canvas stays an option:** the existing "+ Add a material" reveal already exposes *Import from Canvas* and *re-extract*. Make the primary control read **"+ Add or import materials"** so Canvas import/update is discoverable from Step 1 (no new endpoint — it opens the existing `MaterialsPanel`).

### 4. Canvas-list unroll — Step 1

For a row whose `fileName` is a Canvas **list** material (`isCanvasListMaterial(fileName)` from `@/lib/canvas/parseCanvasBlob`), add an expand chevron. Expanding parses `material.extractedText` with `parseCanvasBlob()` and lists the item titles (e.g. each assignment), with a count (e.g. "12 items"). Items in `material.ignoredItems` render struck-through (consistent with the detail panel). Reuse the existing `parseCanvasBlob` + `isCanvasListMaterial`; no new parsing. Requires `extractedText` on the Step's `CaptureMaterial` (already present on the materials view).

---

## New / changed units

- **`app/capture/[code]/page.tsx`** — header JSX trim; pass `catalogSyncedAt={course.lastSyncedAt?.toISOString() ?? null}`.
- **`app/capture/[code]/CaptureClient.tsx`** — accept + forward `catalogSyncedAt` to `CaptureMaterialsStep`.
- **`lib/capture/material-display.ts`** — add `catalogContributionSummary(course)`, `materialReadability(m)`, and a `relativeTimeFromNow(iso)` helper (or reuse one if present). Pure, unit-tested.
- **`app/capture/[code]/CaptureMaterialsStep.tsx`** — catalog row (+ Re-sync), status via `materialReadability`, Index-now action, Canvas unroll, relabeled primary button.
- Tests: helper units (`catalogContributionSummary`, `materialReadability`); component tests (catalog row renders + Re-sync calls the endpoint; pending row shows "not indexed yet" + Index-now appears and calls v2-backfill; Canvas-list row unrolls to item titles).

---

## Testing

- **`catalogContributionSummary`** — non-empty field selection; all-empty → "no catalog details synced yet".
- **`materialReadability`** — each status → correct readable/label/reason.
- **Component (testing-library, MaterialsPanel mocked):** catalog row present with badge + summary; Re-sync button issues the sync POST and reflects the returned course; a `pending` material shows "not indexed yet" and an **Index now** button that POSTs v2-backfill; a Canvas-list material expands to show parsed item titles; a course with no fixably-unindexed materials shows no Index-now button.
- Full suite + `tsc` clean.

---

## STATE.md updates on commit

- What's live / Active arc: capture header trimmed to **Course List · Guide · Feedback**; Step 1 now shows the **GC curriculum sheet** catalog source (badge + synced-time + Re-sync), honest **readability** status (pending/failed = "not readable yet" + reason) with an **Index now** backfill action, and **Canvas-list unroll**.
- One-time op already done (record it): backfilled the setup-era indexing backlog — `ready` 72→89; ~11 remain `pending` because they're genuinely unindexable (ignored syllabi, unshared Google Docs, caption-less YouTube) — source-side, not a pipeline bug.
- Deferred/debt: a dedicated faculty-tier `index-materials` route (vs. reusing admin `v2-backfill`); auto-marking unindexable `pending` materials as `skipped` so they stop reading as "pending".
- No schema/data-model change. New reuse of `POST /api/admin/v2-backfill` + `POST /api/courses/[code]/sync-from-sheet` from the capture UI.
