# Project docs index

All design / plan / vision artifacts for the GC Curriculum Tool.

## Vision

The high-level picture — what the full tool will be, the two questions it answers, illustrative visualizations, and what the prototype shows today vs. the end state.

- [`vision/gc-curriculum-tool-vision.html`](./vision/gc-curriculum-tool-vision.html) — styled web view (live at [chiptoe-svg.github.io/gc-curriculum-tool/docs/superpowers/vision/gc-curriculum-tool-vision.html](https://chiptoe-svg.github.io/gc-curriculum-tool/docs/superpowers/vision/gc-curriculum-tool-vision.html))
- [`vision/gc-curriculum-tool-vision.md`](./vision/gc-curriculum-tool-vision.md) — source markdown

## Specs

Design documents — the architectural rationale and decisions before implementation.

| Date | Doc | Scope |
| ---- | --- | ----- |
| 2026-05-17 | [`specs/2026-05-17-gc-curriculum-tool-v1-design.{md,html}`](./specs/2026-05-17-gc-curriculum-tool-v1-design.md) | Full v1 implementation design (Builds 1–3); the technical anchor. |
| 2026-05-18 | [`specs/2026-05-18-sheet-integration-design.md`](./specs/2026-05-18-sheet-integration-design.md) | Sheet-integration design (snapshot + resync + editable course fields). |
| 2026-05-18 | [`specs/2026-05-18-industry-partner-input-design.md`](./specs/2026-05-18-industry-partner-input-design.md) | Industry Partner Input Tool — magic-link survey + AI synthesis layer feeding career targets. Next build alongside faculty M-trial. |

## Plans

Implementation plans — TDD-style, one plan per increment.

| Date | Plan | Status |
| ---- | ---- | ------ |
| 2026-05-17 | [`plans/2026-05-17-m-trial-prototype.md`](./plans/2026-05-17-m-trial-prototype.md) | ✅ Done. M-trial deployed; flag system, multi-course chain, career-target editor, parallel AI all live. |
| 2026-05-18 | [`plans/2026-05-18-sheet-integration.md`](./plans/2026-05-18-sheet-integration.md) | ✅ Done. 11 tasks completed; courses table mirrors the shared Google Sheet via admin Resync. |
| 2026-05-19 | [`plans/2026-05-19-industry-partner-input-plan-1-foundation.md`](./plans/2026-05-19-industry-partner-input-plan-1-foundation.md) | ✅ Done. Plan 1 of 3 for the industry partner input tool — partners table + CSV import + invite email, magic-link auth, position-submission wizard (20 tasks). |

## Pilot announcements

Public-facing milestone writeups that summarize what shipped and what the pilot looks like.

- [`pilot/2026-05-19-industry-partner-input-pilot.html`](./pilot/2026-05-19-industry-partner-input-pilot.html) — Industry Partner Input v1 pilot writeup (live at [chiptoe-svg.github.io/gc-curriculum-tool/docs/superpowers/pilot/2026-05-19-industry-partner-input-pilot.html](https://chiptoe-svg.github.io/gc-curriculum-tool/docs/superpowers/pilot/2026-05-19-industry-partner-input-pilot.html))

## Increments shipped after the named plans

Smaller follow-ons that didn't get their own plan — captured here for traceability.

- **AI-evaluated scaffolding quality.** New `evaluate-scaffolding` Manning-skill prompt + Zod/JSON schema, runs in parallel with prerequisite-gap analysis in Round 3. Column headers in the heat map color-coded by quality (strong / adequate / brittle / weak / absent). See commit `9bd1a37`.
- **Heat-map UX overhaul.** Question-shaped headings ("How well do these 4 courses build toward X?"), cumulative summary line, true heat gradient (not-addressed = red, not slate), row-group labels (course-being-analyzed / prior coursework), signal-bar confidence icon, "Why?" instead of "Show AI reasoning." See commits `3630514` and `8a2d050`.
- **upstream/downstream rename.** Final rename — `upstreamEvidence` field → `priorCourseworkEvidence` through Zod, JSON schema, AI prompt, type, UI, and all test fixtures. See commit `f000e1a`.

## Current state (as of 2026-05-18)

- **M-trial live** at [`gc-curriculum-tool.vercel.app/preview/<slug>`](https://gc-curriculum-tool.vercel.app/preview/4QcseN0pvlpd35gb). Sheet-backed course picker, AI scoring + scaffolding + gap analysis, in-tool flagging, admin resync.
- **Shared course sheet** at [docs.google.com/spreadsheets/.../12aPhgrIlhDYjKD0...](https://docs.google.com/spreadsheets/d/12aPhgrIlhDYjKD0-Gt97glf1d9fKtwKmL4FwM8iTz7Q/edit) — 28 course tabs + a Feedback tab.
- **Trial period:** roughly the next two weeks from 2026-05-18.

## Next-session pickup

If picking this up fresh:

1. Read the vision doc first — it's the orientation.
2. Then this index + the most recent plan that's still relevant.
3. The pending work the trial will surface lives in three places:
   - **Faculty rollout** (Plan Task 17 in [`plans/2026-05-17-m-trial-prototype.md`](./plans/2026-05-17-m-trial-prototype.md)) is still pending and is the natural M-trial closeout.
   - **Industry Partner Input Tool** — spec written 2026-05-18; the highest-priority parallel build while faculty are in trial. Feeds career targets from the demand side, complementing the supply-side curriculum work. Implementation plan still to write.
   - **Phase 1** (program-wide coverage matrix, per-course views, admin tooling for career-target evolution) is the next curriculum-tool increment. No spec/plan yet — write one after the trial feedback settles.
4. Outstanding small polish items captured in conversation but not in any plan:
   - 4 reconstructed Simple Syllabus URLs (GC 4900ap/bl/or, GC 4990ta) in the sheet need the real URLs pasted in by Chip.
   - "AI Workflow / Orchestrator" career target needs a short description sentence somewhere (vision doc names it but doesn't explain its distinctness from the other four).
   - Course-tab content audit — any sparse tabs in the sheet produce weak analysis.

## Repo conventions

- Specs and plans are created via the `superpowers:brainstorming` and `superpowers:writing-plans` skills.
- Plans get executed via `superpowers:subagent-driven-development` (fresh subagent per task + spec/quality review).
- Each increment lives in its own dated file. Don't edit historical plans/specs; write new ones.
