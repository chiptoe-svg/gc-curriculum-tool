# Capture Step 1 — Guided Canvas-First Reorder (revives the 2026-06-17 spec)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** The materials step (`CaptureMaterialsStep`) walks faculty through **Canvas → Syllabus → Other** with a guided, addressed-state progressive disclosure, an INSTRUCTIONS paragraph, and a full-width framing blurb. Revives [`2026-06-17-capture-step1-guided-sources-design.md`](../specs/2026-06-17-capture-step1-guided-sources-design.md) (spec'd, never built; shelved when 2b chose to reuse the materials UI as-is). **Flag-gated under `COURSECAPTURE_TRIAGE`** — flag off = today's screen byte-for-byte unchanged; flag on = the guided experience (which then flows into the triage/ingest screen built in 2b/3/4).

**Architecture:** All changes live in `CaptureMaterialsStep.tsx` + the three boxes + `CaptureWhyBlurb.tsx`, all behind `isTriageEnabled()`-equivalent gating. Since `CaptureMaterialsStep` is rendered by `CaptureClient` (client), the flag must arrive as the **`triageEnabled` prop** already threaded in (the fix from earlier today) — pass it down to `CaptureMaterialsStep`. Addressed = imported/synced/skipped (per the spec).

---

## Task 1: Reorder + INSTRUCTIONS + full-width blurb + button label (flag-gated, low-risk)

**Files:** `CaptureMaterialsStep.tsx`, `CaptureWhyBlurb.tsx`; thread `triageEnabled` from `CaptureClient` → `CaptureMaterialsStep`. Test: a `CaptureMaterialsStep` render test (or extend an existing one).

- [ ] **Step 1:** Thread `triageEnabled?: boolean` into `CaptureMaterialsStep` props; `CaptureClient` passes its `triageEnabled`.
- [ ] **Step 2:** Write failing tests: when `triageEnabled`, the boxes render in **Canvas → Syllabus → Other** order (assert DOM order), an **INSTRUCTIONS** paragraph is present, and the blurb is full-width (no `max-w-2xl`); when `!triageEnabled`, order is **Syllabus → Canvas → Other** and no INSTRUCTIONS paragraph (unchanged).
- [ ] **Step 3:** Implement:
  - Order the three `<...Box>` elements Canvas-first **only when `triageEnabled`** (else current order).
  - `CaptureWhyBlurb`: add a `wide?: boolean` prop → drop `max-w-2xl` when wide (keep narrow for the Step-2 hero); pass `wide` from the materials step when `triageEnabled`.
  - Add an `INSTRUCTIONS` mono-caps paragraph (copy from the spec: surface everything around the course — Canvas, syllabus, assignment sheets, rubrics, decks, readings — *more is better*; the AI only reasons from what's here) when `triageEnabled`.
  - Button label: when `triageEnabled`, "Continue to interview" → "Continue →" (it now leads to the ingest screen, not the interview).
- [ ] **Step 4:** Run tests → PASS; `pnpm exec tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `feat(capture): guided Canvas-first order + INSTRUCTIONS + wide blurb (flag-gated)`

---

## Task 2: Addressed-state progressive disclosure + per-box fresh controls

**Files:** `CaptureMaterialsStep.tsx` (compute addressed/locked) + `boxes/CanvasBox.tsx`, `boxes/SyllabusBox.tsx`, `boxes/OtherMaterialsBox.tsx` (accept `locked` + render a fresh/locked state). Tests: per-box + container.

Per the spec (§C/§D). Only active when `triageEnabled`.

- [ ] **Step 1:** Container computes per-source `addressed` (Canvas: any Canvas material imported OR skipped-this-session; Syllabus: `catalogSyncedAt != null` OR imported/replaced OR skipped; Other: any non-Canvas/non-syllabus material OR skipped) and `locked` (a box is locked iff not addressed AND any prior box in Canvas→Syllabus→Other order is not addressed). Skip state is session-local React state in the container. Write tests for the `locked` derivation across the spec's key states (all fresh / syllabus-synced / skip-Canvas / fully-populated).
- [ ] **Step 2:** Each box gets a `locked?: boolean` prop → renders grayed + collapsed + non-interactive when locked. When unlocked-but-unaddressed (fresh), render the simplified controls: Canvas `[Import][Skip]`; Syllabus `[Use Existing*][Import][Skip]` (*enabled only if a Canvas-sourced syllabus exists); Other `[Add files][Skip]`. Acting (import/sync/add/skip) marks the source addressed → unlocks the next. Skip is non-blocking (never disables Continue). Done state = the existing rich controls.
- [ ] **Step 3:** Implement; tests per box (fresh shows the simple buttons; locked is non-interactive) + container (skip unlocks next; addressed sources never lock).
- [ ] **Step 4:** tsc clean; suites green.
- [ ] **Step 5: Commit** — `feat(capture): addressed-state progressive disclosure for the guided materials step`

---

## Task 3: Suite + STATE.md
- [ ] tsc clean; `pnpm exec vitest run app/capture tests/api` green.
- [ ] STATE.md: guided Phase-1 reorder built (flag-gated); the 2026-06-17 guided-sources spec is no longer "superseded/shelved" — it's implemented behind `COURSECAPTURE_TRIAGE`. The full flag-on flow is now: guided materials (Canvas→Syllabus→Other, progressive disclosure) → triage/ingest screen → interview.
- [ ] Commit.

---

## Self-Review notes (controller)
- **Flag-gated:** flag off → today's materials screen unchanged (assert in tests). Flag on → guided experience.
- **Prop, not env:** `triageEnabled` is threaded as a prop (CaptureMaterialsStep is client-rendered) — same server-resolved-prop pattern as the CaptureClient fix earlier today; do NOT call `process.env` in client code.
- **Spec fidelity:** addressed = imported/synced/skipped; locked-until-prior-addressed; Skip non-blocking + session-local; Use-Existing enabled only with a Canvas syllabus. The slides nudge is NOT here (it lives on the ingest screen).
- **Task 1 is the low-risk core** (reorder + copy); Task 2 is the bigger progressive-disclosure piece. Each ships independently green.
