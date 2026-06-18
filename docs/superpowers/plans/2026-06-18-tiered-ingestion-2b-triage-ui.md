# Tiered Ingestion — Increment 2b: Ingest Screen (tier-sorted) + Ingest Action

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Checkbox steps.

> **REVISED 2026-06-18 (operator):** Phase-1 listing/pruning **reuses the existing materials UI** (the Step-1 source boxes) — NOT a new component. The tier-sorted screen built here is a **separate "ingest screen" that comes AFTER the materials step**, and it reads the **live `CaptureMaterial[]`** (current course materials, which now carry `tier`) — NOT the import manifest. It drops the manifest-only `skipped[]` list (unsupported files were never inserted as rows; they're surfaced in the materials UI at import time). Tasks 2–3 below reflect this; the `manifest`-prop framing in earlier drafts is superseded.

**Goal:** The first user-visible depth surface of tiered ingestion: after the (unchanged) materials step, when `COURSECAPTURE_TRIAGE=1`, show a tier-sorted **ingest screen** (high/middle/background) over the live course materials with upgrade/downgrade, ignore, delete — then an **Ingest & continue** button that enqueues the kept rows and advances to the interview. Part of the [tiered-ingestion-triage spec](../specs/2026-06-18-tiered-ingestion-triage-design.md); builds on 2a (tiers persisted on `course_materials`).

**Architecture:** Reuses existing endpoints — `PATCH /materials/[id]` (ignore, +new `tier`), `DELETE /materials/[id]` (delete), `POST /admin/v2-backfill` (Ingest = enqueue all non-ignored). The ingest screen is a new `landingStep === 'ingest'` rendered inside CaptureClient's `'chat'` stage, **after** the materials step and before the interview, reading CaptureClient's live `materials` state. Time estimates are deferred to Increment 4 (omit here). **Note:** until Increment 3, the worker ignores `tier` — Ingest runs the existing full pipeline for every kept row; the screen still records tiers for when Inc 3 lands.

**Tech Stack:** React/Next client components, Tailwind, Vitest + @testing-library/react. Mirror the existing Step-1 box/MaterialsPanel styling.

## UI mockup (the design)

```
STEP 1 OF 2 · TRIAGE MATERIALS ● ── ○
What should we pull in, and how deeply?
  <one-line explainer: High=every detail · Middle=per-slide/section · Background=one summary>

  ┌ HIGH VALUE — full detail ────────────────────────────┐
  │ 📋 Canvas: Syllabus        assignments  [▼][⊘ ignore][🗑]│
  └──────────────────────────────────────────────────────┘
  ┌ MIDDLE — per-slide/section summaries ────────────────┐
  │ 🎨 Week3-deck.pptx          18 slides   [▲][▼][⊘][🗑] │
  └──────────────────────────────────────────────────────┘
  ┌ BACKGROUND — one summary each ───────────────────────┐
  │ 📎 reading.pdf              12 pages    [▲][⊘][🗑]    │
  └──────────────────────────────────────────────────────┘
  ⚠ Skipped (won't be pulled in): lecture.mp4 — unsupported type
  💡 No lecture slides found — add them. [Add slides]      (only when no middle/deck rows)
                                          [ Ingest & continue → ]
```

---

### Task 1: Add `tier` to the per-material PATCH (backend)

**Files:** Modify `app/api/courses/[code]/materials/[id]/route.ts` (PATCH); add `updateMaterialTier` is already in `course-materials-queries.ts` (from 2a). Test: extend the materials route test (find it: `tests/api/...materials*` or `app/capture/[code]/__tests__`).

- [ ] **Step 1:** Write/extend a failing test: `PATCH /materials/[id]` with body `{ tier: 'background' }` updates the row's tier and returns ok; an invalid tier (`{tier:'bogus'}`) → 400.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** In the PATCH handler, accept `tier` ∈ `{'high','middle','background'}`: add `const hasTier = body.tier === 'high' || body.tier === 'middle' || body.tier === 'background';`, include it in the "at least one of" guard, validate (400 on a present-but-invalid `tier`), and call `updateMaterialTier(id, body.tier)`. Keep all existing fields working.
- [ ] **Step 4:** Run → PASS; `pnpm exec tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(triage): PATCH /materials/[id] accepts tier"`

---

### Task 2: TriageStep component

**Files:** Create `app/capture/[code]/TriageStep.tsx`; Test: `app/capture/[code]/__tests__/TriageStep.test.tsx`.

**Props:** `{ courseCode: string; slug: string; manifest: { rows: ManifestRow[]; skipped: SkippedFile[]; decksPresent: boolean }; onIngested: () => void }` (import `ManifestRow`/`SkippedFile` types from `canvas-import/list-import.ts`).

**Behavior (mirror MaterialsPanel row styling + the Step-1 mono-caps section headers):**
- Group `rows` into three tier sections (high / middle / background) in the mockup's order; each section a bordered card with a mono-caps header + plain-language depth descriptor.
- Per row: icon + name + a size descriptor (`{slideCount} slides` / `{pageCount} pages` / kind label) + actions: **▲/▼** move tier (▲ hidden in high, ▼ hidden in background) → `PATCH /materials/[id] {tier}` + move locally; **⊘ ignore** (toggle) → `PATCH {ignored:true|false}` (ignored rows render dimmed, kept in place — reversible); **🗑 delete** → `DELETE /materials/[id]` + remove locally (confirm inline).
- **Skipped list:** render `skipped[]` as a muted "won't be pulled in: name — reason" line.
- **Lecture-slides nudge:** show the positive "add slides" affordance ONLY when no middle/deck row is present (`!decksPresent && no middle rows`); invitational copy, never a deficiency flag. ("Add slides" can route to the existing add-files affordance — wire to the same handler the Other-materials box uses, or a TODO link if that handler isn't in scope here; do NOT block on it.)
- **Ingest & continue:** `POST /admin/v2-backfill { courseCode, slug }` (enqueues all non-ignored), then `onIngested()`. Disable + show a spinner while posting; surface errors inline.
- No time estimate yet (Increment 4) — omit the estimate chips/total.

- [ ] **Step 1:** Write the failing render test: given a manifest with one row per tier + one skipped + `decksPresent:false`, assert three tier sections render with the right rows, the skipped line shows, the nudge shows (no decks), and clicking **Ingest & continue** POSTs to `v2-backfill` (mock `fetch`) and calls `onIngested`. (Mirror an existing component test's setup, e.g. `__tests__/OtherMaterialsBox.test.tsx`.)
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `TriageStep.tsx` per the behavior above, matching repo component conventions (read `MaterialsPanel.tsx` + `boxes/OtherMaterialsBox.tsx` for the fetch/row/confirm patterns and Tailwind classes).
- [ ] **Step 4:** Run → PASS; `pnpm exec tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(triage): TriageStep component (tier sections, move/ignore/delete, ingest)"`

---

### Task 3: Wire the triage step into CaptureClient (flag-gated)

**Files:** Modify `app/capture/[code]/CaptureClient.tsx`, `app/capture/[code]/CaptureMaterialsStep.tsx`, and `app/capture/[code]/boxes/CanvasBox.tsx`. Test: extend CaptureClient/CanvasBox tests if present.

- [ ] **Step 1:** `CanvasBox` — when the import response contains a `manifest` (flag-on shape), surface it upward via a new optional `onManifest?(manifest)` prop instead of only the `imported` count path. (Keep the legacy count path for flag-off.)
- [ ] **Step 2:** Thread `onManifest` from `CanvasBox` → `CaptureMaterialsStep` → `CaptureClient`. In `CaptureClient`, store `const [manifest, setManifest] = useState(null)`; add a `landingStep === 'triage'` value (extend the existing `landingStep` union that currently toggles 'materials'→'interview'). When a manifest arrives, `setManifest(m); setLandingStep('triage')`.
- [ ] **Step 3:** Render: when `isLanding && landingStep === 'triage' && manifest`, render `<TriageStep courseCode slug manifest onIngested={() => setLandingStep('interview')} />` in place of the materials step. (Flag-off behavior is unchanged — no manifest is ever set, so the triage step never shows.)
- [ ] **Step 4:** `pnpm exec tsc --noEmit` clean; run the capture component tests.
- [ ] **Step 5: Commit** — `git commit -m "feat(triage): show triage step after a manifest import (flag-gated)"`

---

### Task 4: Typecheck + suite + STATE.md

- [ ] **Step 1:** `pnpm exec tsc --noEmit` clean.
- [ ] **Step 2:** `pnpm exec vitest run tests app` (or the capture + api dirs) green.
- [ ] **Step 3:** STATE.md: Increment 2b done — triage UI stage (`TriageStep`) + Ingest via `v2-backfill` + `tier` on PATCH; flag-on flow now end-to-end (list → triage → ingest), though depth is still uniform until Increment 3.
- [ ] **Step 4: Commit** — `git commit -m "docs(state): tiered-ingestion 2b (triage UI) done"`

---

## Self-Review notes (controller)

- **Spec coverage:** covers the triage screen + move/ignore/delete/upgrade-downgrade + skipped list + slides nudge + Ingest. Does NOT include tier-aware depth (Inc 3) or time estimates (Inc 4) — both explicitly stubbed/omitted.
- **Working software:** flag-off path untouched (no manifest → no triage step). Flag-on path becomes end-to-end (list → triage → ingest at uniform depth).
- **Honest placeholder note:** Task 2/3 specify the React UI by mockup + responsibilities + which existing components to mirror, not full JSX (matching the repo's component conventions is best done by reading them). The implementer writes the JSX against those patterns; the render test pins behavior. The "Add slides" handler may be a thin link if the existing add-files handler isn't readily reusable — not a blocker.
- **Tracked surfaces:** no new route (reuses PATCH/DELETE/v2-backfill), no schema change. STATE.md update is for the "What's live (flag-gated)" status only.
