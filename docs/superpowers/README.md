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
| 2026-05-18 | [`specs/2026-05-18-sheet-integration-design.md`](./specs/2026-05-18-sheet-integration-design.md) | Sheet-integration design (snapshot + resync + editable course fields). Superseded — sheet sync retired; courses now seeded via catalog script. |
| 2026-05-18 | [`specs/2026-05-18-industry-partner-input-design.md`](./specs/2026-05-18-industry-partner-input-design.md) | Industry Partner Input Tool — magic-link survey + AI synthesis layer feeding career targets. |
| 2026-05-19 | [`specs/2026-05-19-m-trial-dual-analysis-modes-design.md`](./specs/2026-05-19-m-trial-dual-analysis-modes-design.md) | M-trial: split the single Analyze button into two tabs (career-target alignment vs. prereqs feeding a course). |
| 2026-05-19 | [`specs/2026-05-19-faculty-assignment-intake-design.md`](./specs/2026-05-19-faculty-assignment-intake-design.md) | Faculty upload real assignment files (PDF/DOCX); AI distills them into an editable course profile. |

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

## Pilot docs

Public-facing milestone writeups and interactive previews.

| File | Description |
| ---- | ----------- |
| [`pilot/2026-05-19-industry-partner-input-pilot.html`](./pilot/2026-05-19-industry-partner-input-pilot.html) | Industry Partner Input v1 pilot writeup. |
| [`pilot/2026-05-20-industry-partner-interface-preview.html`](./pilot/2026-05-20-industry-partner-interface-preview.html) | Clickable employer-side interface mockup. |
| [`pilot/2026-05-21-course-builder-spec.html`](./pilot/2026-05-21-course-builder-spec.html) | Course Builder spec doc (problem, 5-stage workflow, KUD loop, data model, API shape, build scope). |
| [`pilot/2026-05-21-course-builder-preview.html`](./pilot/2026-05-21-course-builder-preview.html) | Interactive Course Builder UI mockup (linked from prototype page Tool 1 card). Live at GitHub Pages. |

---

## Current state (as of 2026-05-21)

### What's live at `gc-curriculum-tool.vercel.app/preview/<slug>`

The prototype exposes three tools via three cards at the top of the page:

**Tool 1 — Course Builder** (fully functional)
- Per-course page at `/preview/<slug>/courses/<code>` now has a 4-tab layout: Info / Materials / Profile / KUDs.
- Profile tab: faculty edit learning objectives, major projects, required incoming skills.
- KUDs tab: Generate AI-drafted KUDs from the profile, edit bullets inline, accept — which marks the course `approved`.
- Approval gate: `CourseSelector` with `requireApproved` grays out unapproved courses; only approved courses appear in the prereq/coverage analysis tools.
- State machine: `draft → profile_complete → kuds_generated → approved`. Editing profile or KUDs after approval resets approval.

**Tool 2 — Prereq Analyzer** (fully functional)
- Course-centric pipeline: KUDs derived from course content, then AI extracts entry requirements for the focal course, then prior courses are scored against those requirements.
- No career target involved. Gap analysis + scaffolding quality across the prior set.
- Heat map columns = focal course's entry requirements; prior courses as rows.

**Tool 3 — Career Target Alignment** (fully functional)
- Select a career target + a chain of courses; AI scores each course against the target's sub-competencies.
- Heat map shows KUD coverage across the chain; scaffolding quality in column headers.

### Schema (Neon Postgres via Drizzle)
Core tables: `courses`, `career_targets`, `sub_competencies`, `course_materials`, `course_profiles`, `course_profile_runs`, `coverage_scores`, `prototype_runs`, `prototype_flags`, `partners`, `partner_positions`, `course_kuds`, `course_kud_runs`.

`courses.builder_status` enum: `draft | profile_complete | kuds_generated | approved`.

### Other current-state notes
- Google Sheets resync retired; course data seeded via `pnpm db:seed-courses` (catalog script, 120 courses).
- `resolveCourseContext` prefers course profile data over raw syllabus text when an AI-generated profile exists for a course.
- PDF ingestion uses `pdf-parse` (flat text, loses structure). Anthropic native PDF API (document blocks) would preserve tables/headers but requires an `AnthropicProvider` implementation — not yet built.

---

## Future increments (not yet planned)

| Increment | Description |
| --------- | ----------- |
| **AnthropicProvider** | Native PDF document blocks for structured extraction (tables, rubrics, schedules). ~165 lines across 4 files. Prerequisite for high-quality Course Builder ingestion. |
| **Industry Partner Input Plan 2** | Position ratings table + project-rating heat map. The plan doc gap between Plan 1 and Plan 3. |
| **Phase 1** | Program-wide coverage matrix, per-course views with career-target overlays, admin tooling for career-target evolution. No spec yet — write after Course Builder ships and trial feedback settles. |

---

## Repo conventions

- Specs and plans are created via the `superpowers:brainstorming` and `superpowers:writing-plans` skills.
- Plans get executed via `superpowers:subagent-driven-development` (fresh subagent per task + spec/quality review).
- Each increment lives in its own dated file. Don't edit historical plans/specs; write new ones.
- The `docs/` folder is published to GitHub Pages via the `gh-pages` branch (the `docs/` folder root is served at `chiptoe-svg.github.io/gc-curriculum-tool/docs/`).
