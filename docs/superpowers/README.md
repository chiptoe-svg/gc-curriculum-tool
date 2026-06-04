# Project docs index

All design / plan / vision artifacts for the GC Curriculum Tool.

## Top-level documents

These four are linked from the GH Pages root at [chiptoe-svg.github.io/gc-curriculum-tool/docs/](https://chiptoe-svg.github.io/gc-curriculum-tool/docs/):

- **Documents hub** — [`../index.html`](../index.html). Reading-order index for everything below.
- **Vision** — the high-level picture: the two questions, what it produces, the 3-Act program structure, end state, illustrative visualizations.
  - [`vision/gc-curriculum-tool-vision.html`](./vision/gc-curriculum-tool-vision.html) — styled web view
  - [`vision/gc-curriculum-tool-vision.md`](./vision/gc-curriculum-tool-vision.md) — source markdown
- **Background** — academic companion to the Vision. Theoretical justification for KUD+ (Backward Design, Constructive Alignment, Bloom's relationship), the depth-scale extension and evidence rule, foundational competency treatment, course- and career-path implementation.
  - [`../background.html`](../background.html)
- **Validation** — proposal for empirical validation against external occupational data using a dataset of 268 Clemson GC graduates.
  - [`../graduate-outcome-validation.html`](../graduate-outcome-validation.html)
- **Faculty guide** — practical walkthrough of CourseCapture and Explore, written for the faculty member using the tool. Linked from the headers of `/capture/<code>` and `/explore/<code>` so users can jump from the app to the instructions.
  - [`../using-coursecapture-and-explore.html`](../using-coursecapture-and-explore.html)

## Specs

Design documents — the architectural rationale and decisions before implementation.

| Date | Doc | Scope |
| ---- | --- | ----- |
| 2026-05-17 | [`specs/2026-05-17-gc-curriculum-tool-v1-design.{md,html}`](./specs/2026-05-17-gc-curriculum-tool-v1-design.md) | Full v1 implementation design (Builds 1–3); the technical anchor. |
| 2026-05-18 | [`specs/2026-05-18-sheet-integration-design.md`](./specs/2026-05-18-sheet-integration-design.md) | Sheet-integration design. Superseded — sheet sync retired; courses now seeded via catalog script. |
| 2026-05-18 | [`specs/2026-05-18-industry-partner-input-design.md`](./specs/2026-05-18-industry-partner-input-design.md) | Industry Partner Input Tool — magic-link survey + AI synthesis layer feeding career targets. |
| 2026-05-19 | [`specs/2026-05-19-m-trial-dual-analysis-modes-design.md`](./specs/2026-05-19-m-trial-dual-analysis-modes-design.md) | M-trial: split the single Analyze button into two tabs (career-target alignment vs. prereqs feeding a course). |
| 2026-05-19 | [`specs/2026-05-19-faculty-assignment-intake-design.md`](./specs/2026-05-19-faculty-assignment-intake-design.md) | Faculty upload real assignment files (PDF/DOCX); AI distills them into an editable course profile. |
| 2026-05-23 | [`specs/2026-05-23-kud-depth-scales-design.md`](./specs/2026-05-23-kud-depth-scales-design.md) | KUD+ depth-scale design: per-dimension 0–5 with student-side anchors, evidence-required rule, foundational-only-D treatment. |
| 2026-05-24 | [`specs/2026-05-24-coursecapture-completion-spec.md`](./specs/2026-05-24-coursecapture-completion-spec.md) | CourseCapture v1: snapshot system, incoming_expectations, verification summary, voice input. |
| 2026-05-24 | [`specs/2026-05-24-explore-module-spec.md`](./specs/2026-05-24-explore-module-spec.md) | Explore module v1: custom + downstream target modes, what-if scenarios. |
| 2026-05-24 | [`specs/2026-05-24-program-coverage-views-spec.md`](./specs/2026-05-24-program-coverage-views-spec.md) | Program-level coverage views (Phase 1 of the original vision); Phase 1A (Coverage Matrix) is the first deliverable. |

## Plans

Implementation plans — TDD-style, one plan per increment.

| Date | Plan | Status |
| ---- | ---- | ------ |
| 2026-05-17 | [`plans/2026-05-17-m-trial-prototype.md`](./plans/2026-05-17-m-trial-prototype.md) | ✅ Done. M-trial deployed; flag system, multi-course chain, career-target editor, parallel AI all live. |
| 2026-05-18 | [`plans/2026-05-18-sheet-integration.md`](./plans/2026-05-18-sheet-integration.md) | ✅ Done, then superseded. Courses now seeded from a catalog script (`pnpm db:seed-courses`); the resync route returns 410. |
| 2026-05-19 | [`plans/2026-05-19-industry-partner-input-plan-1-foundation.md`](./plans/2026-05-19-industry-partner-input-plan-1-foundation.md) | ✅ Done. Partners table + CSV import + invite email, magic-link auth, position-submission wizard (20 tasks). |
| 2026-05-19 | [`plans/2026-05-19-industry-partner-input-plan-3-synthesis.md`](./plans/2026-05-19-industry-partner-input-plan-3-synthesis.md) | ✅ Done. AI synthesis layer + per-target faculty dashboard (14 tasks). |
| 2026-05-19 | [`plans/2026-05-19-m-trial-dual-analysis-modes.md`](./plans/2026-05-19-m-trial-dual-analysis-modes.md) | ✅ Done. Career-target alignment + prereqs tabs live (15 tasks). |
| 2026-05-20 | [`plans/2026-05-20-faculty-assignment-intake-plan-1-upload-extraction.md`](./plans/2026-05-20-faculty-assignment-intake-plan-1-upload-extraction.md) | ✅ Done. Schema (`course_materials`, `course_profiles`, `course_profile_runs`), Vercel Blob upload, DOCX/PDF extraction, per-course page Materials zone. |
| 2026-05-20 | [`plans/2026-05-20-faculty-assignment-intake-plan-2-analysis-profile.md`](./plans/2026-05-20-faculty-assignment-intake-plan-2-analysis-profile.md) | ✅ Done. Per-file AI analysis, synthesis, profile persistence, read-only profile display + run history. |
| 2026-05-20 | [`plans/2026-05-20-faculty-assignment-intake-plan-3-editor-integration.md`](./plans/2026-05-20-faculty-assignment-intake-plan-3-editor-integration.md) | ✅ Done (checkboxes not marked, but all deliverables shipped). `CourseProfileEditor`, `resolveCourseContext`, `listCoursesWithStatus`, courses index page, profile PATCH route all exist. |
| 2026-05-21 | [`plans/2026-05-21-course-builder.md`](./plans/2026-05-21-course-builder.md) | ✅ Done. 5-stage Course Builder workflow live: `builder_status` on courses, `course_kuds`/`course_kud_runs` tables, KUD generation pipeline, 4-tab UI (Info/Materials/Profile/KUDs), approval gate in CourseSelector. |
| 2026-05-22 | [`plans/2026-05-22-conversational-kud.md`](./plans/2026-05-22-conversational-kud.md) | ✅ Done. Conversational KUD-chat agent (Phase 2 design precursor). |
| 2026-05-22 | [`plans/2026-05-22-graduate-data-collection.md`](./plans/2026-05-22-graduate-data-collection.md) | Planning artifact for graduate-outcome validation dataset. |
| 2026-05-22 | [`plans/2026-05-22-graduate-outcome-validation.md`](./plans/2026-05-22-graduate-outcome-validation.md) | Planning artifact for the validation proposal published at [`graduate-outcome-validation.html`](../graduate-outcome-validation.html). |
| 2026-05-22 | [`plans/2026-05-22-phase2-agent-design.md`](./plans/2026-05-22-phase2-agent-design.md) | Phase 2 conversational-agent design decisions (materials auditor + KUD chat); blocked on nanoclaw API contract. |
| 2026-05-23 | [`plans/2026-05-23-coursecapture-prototype.md`](./plans/2026-05-23-coursecapture-prototype.md) | ✅ Done. CourseCapture v1 prototype: per-course audit chat, scoring pipeline, voice input. |
| 2026-05-25 | [`plans/2026-05-25-manning-encoding-backfill.md`](./plans/2026-05-25-manning-encoding-backfill.md) | In progress. Backfill Manning-skill encoding for prompts written after the original M-trial pattern was set; `manning_skills:` frontmatter as the contract. Phase A (program-score-coverage) and Phase B (4 capture-pipeline prompts) done; `capture-chat` deferred pending verification. |
| 2026-05-25 | [`plans/2026-05-25-capture-reference-compression.md`](./plans/2026-05-25-capture-reference-compression.md) | ✅ Done. Auto-compress long reference materials at extraction so the audit-chat prompt stays under the OpenAI input cap. New `material-summary` AI function + `summary` columns on `course_materials` + shared `finalizeExtraction` helper that every extraction site routes through. Faculty get a per-row `summarize` toggle and a one-time "Compress existing materials" backfill button. |
| 2026-06-03 | [`plans/2026-06-03-hybrid-http-https-mic-architecture.md`](./plans/2026-06-03-hybrid-http-https-mic-architecture.md) | ✅ Done. Replaces the spec-broken HTTPS iframe-bridge for mic with a hybrid surface — public HTTP landing + read-only profile views at the LAN IP; whole faculty app on Tailscale Funnel HTTPS (Basic Auth gated) where mic works natively in a top-level secure context. Supersedes the iframe plan from earlier the same day. |
| 2026-06-03 | [`plans/2026-06-03-adversarial-stress-test-agent.md`](./plans/2026-06-03-adversarial-stress-test-agent.md) | ✅ Done. On-demand `capture-stress-test` agent (heavy tier) that adversarially reviews a produced Course Outcome Profile. Per-competency annotations (confidence + concerns + optional suggested adjustments) + profile-level concerns + overall assessment. Ephemeral — never persisted to the draft. Surfaced inline in `ProfileReviewPanel`. |

> Plans between 2026-05-26 and 2026-06-02 (CourseCapture v2 stages, scaffolding analysis Stage 1, curriculum chat phase B, etc.) are tracked in [STATE.md's Active arc](../STATE.md#active-arc) but not yet indexed here. The index above covers the M-trial era + the most recent two-day arc; the middle window is a backfill gap.

## Pilot docs

Public-facing milestone writeups and interactive previews.

| File | Description |
| ---- | ----------- |
| [`pilot/2026-05-19-industry-partner-input-pilot.html`](./pilot/2026-05-19-industry-partner-input-pilot.html) | Industry Partner Input v1 pilot writeup. |
| [`pilot/2026-05-20-industry-partner-interface-preview.html`](./pilot/2026-05-20-industry-partner-interface-preview.html) | Clickable employer-side interface mockup. |
| [`pilot/2026-05-21-course-builder-spec.html`](./pilot/2026-05-21-course-builder-spec.html) | Course Builder spec doc (problem, 5-stage workflow, KUD loop, data model, API shape, build scope). |
| [`pilot/2026-05-21-course-builder-preview.html`](./pilot/2026-05-21-course-builder-preview.html) | Interactive Course Builder UI mockup (linked from prototype page Tool 1 card). Live at GitHub Pages. |

---

## Current state, active arc, and what's next

These live in **[`docs/STATE.md`](../STATE.md)** — the volatile snapshot that gets updated as part of any commit touching routes, schema, AI functions, env vars, deployment surface, plan/spec status, or "What's live." For a full reconciliation against the repo + recent commits, run `/refresh-state`.

This README is the stable doc index above; STATE.md is the live picture. Session bootstrap at [`CLAUDE.md`](../../CLAUDE.md) points to both.

---

## Repo conventions

- Specs and plans are created via the `superpowers:brainstorming` and `superpowers:writing-plans` skills.
- Plans get executed via `superpowers:subagent-driven-development` (fresh subagent per task + spec/quality review).
- Each increment lives in its own dated file. Don't edit historical plans/specs; write new ones.
- The `docs/` folder is published to GitHub Pages via the `gh-pages` branch (the `docs/` folder root is served at `chiptoe-svg.github.io/gc-curriculum-tool/docs/`).
