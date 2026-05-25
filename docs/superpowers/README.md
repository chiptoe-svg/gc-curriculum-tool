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

## Pilot docs

Public-facing milestone writeups and interactive previews.

| File | Description |
| ---- | ----------- |
| [`pilot/2026-05-19-industry-partner-input-pilot.html`](./pilot/2026-05-19-industry-partner-input-pilot.html) | Industry Partner Input v1 pilot writeup. |
| [`pilot/2026-05-20-industry-partner-interface-preview.html`](./pilot/2026-05-20-industry-partner-interface-preview.html) | Clickable employer-side interface mockup. |
| [`pilot/2026-05-21-course-builder-spec.html`](./pilot/2026-05-21-course-builder-spec.html) | Course Builder spec doc (problem, 5-stage workflow, KUD loop, data model, API shape, build scope). |
| [`pilot/2026-05-21-course-builder-preview.html`](./pilot/2026-05-21-course-builder-preview.html) | Interactive Course Builder UI mockup (linked from prototype page Tool 1 card). Live at GitHub Pages. |

---

## Current state (as of 2026-05-25)

### What's live at `gc-curriculum-tool.vercel.app`

Five top-level surfaces, all accessible behind a single slug-gated session:

**`/capture/[code]` — CourseCapture v1** (fully functional, in active use)
- The instructor-facing audit conversation that produces a Course Outcome Profile for a single course.
- Header: Program · Settings · Explore · Course Builder · Profile actions.
- Materials & catalog panel: catalog text + uploads + Canvas-imported syllabus, assignments (with point values), pages, discussions, quizzes (Classic + New Quizzes APIs), file attachments, YouTube/Vimeo/Panopto/Loom/etc. references, Google Docs/Slides/Sheets (via "Anyone with link" sharing), Drive PDFs. Voice input via OpenAI Whisper.
- Audit chat: one question per turn, finding-and-question on same topic, three-paragraph opening / two-paragraph follow-ups; readiness signal on every turn (0–100 with `covered` / `remaining` labels).
- Save Snapshot: immutable versioned Course Outcome Profile written to `course_capture_snapshots`. Draft remains mutable; snapshots are the historical record. Multiple snapshots per course supported.

**`/program` — Program Coverage Matrix (Phase 1A)** (shipped 2026-05-25, today)
- Heat map of confirmed snapshots × career-target sub-competencies, colored by D depth (0–5 ramp).
- Target tabs along the top; one row per snapshotted course; one column per sub-competency; cell shows K/U/D.
- "Score N stale pairs" button runs the AI scorer on un-scored cross-product cells, sorted by target for prompt-cache reuse (~$0.04 per pair via gpt-5.4-mini default tier; ~$5 for a full GC-program refresh).
- Cell drawer: matched snapshot competency, evidence excerpt, confidence chip, full rationale, re-score button, snapshot link.
- Backed by `snapshot_target_coverage` (composite PK: snapshotId × careerTargetId × subCompetencyId) and the `program-score-coverage` AI scorer.

**`/explore` — Explore module v1** (shipped 2026-05-24)
- Two modes: **custom target** (faculty/student composes a hypothetical role profile, alignment to a chosen snapshot) and **downstream target** (a downstream course's incoming expectations, alignment to a snapshot of an upstream course).
- What-if scenarios: simulate proposed snapshot changes (e.g., "what if we added project X with these depths?") against the alignment analysis; rates each scenario `worth_doing` / `worth_considering` / `not_worth_doing`.
- Career-path mode deferred until graduate-outcome dataset is wired in.

**`/settings` — Per-function AI model selector** (shipped 2026-05-24)
- Tier-based selection (Light / Default / Heavy) plus per-function model dropdown sourced from the OpenAI provider's `models.list` (filtered to chat-completion-capable models, sorted newest/largest).
- 60-second TTL cache on the function-→-model resolver so changes propagate without restart.
- AI functions exposed for tuning: materials analysis, course-profile synthesis, capture chat, capture scoring, explore drafting / comparison / what-if, program coverage scoring.

**`/preview/[slug]` — original M-trial prototype** (still live)
- The three earlier tools (Course Builder · Prereq Analyzer · Career Target Alignment) remain as built. CourseCapture and the program matrix supersede them for new work but the M-trial cards still function.

### Schema (Neon Postgres via Drizzle)

Core tables (M-trial era): `courses`, `career_targets`, `sub_competencies`, `course_materials`, `course_profiles`, `course_profile_runs`, `coverage_scores`, `prototype_runs`, `prototype_flags`, `partners`, `partner_positions`, `course_kuds`, `course_kud_runs`.

Added since 2026-05-21:
- `course_capture_profiles` — the mutable draft profile per course
- `capture_conversations` — persistent audit transcripts (per course, per session)
- `course_capture_snapshots` — immutable versioned Course Outcome Profiles
- `ai_function_settings` — per-function model overrides feeding `/settings`
- `course_explore_targets` — custom + downstream target specs
- `course_explore_analyses` — alignment runs per snapshot × target
- `course_explore_what_ifs` — what-if scenarios per analysis
- `snapshot_target_coverage` — Phase 1A coverage matrix cells (composite PK)

`courses.builder_status` enum (M-trial): `draft | profile_complete | kuds_generated | approved`.

### AI architecture

- **Provider abstraction** (`lib/ai/provider.ts`): `getProviderForFunction(functionId)` returns the configured OpenAI / Anthropic / Local provider for each AI function. Structured-output via OpenAI strict JSON-schema mode where the output shape is enforced.
- **Function tier system** (`lib/ai/function-settings.ts`): each AI integration point is a named function; `light/default/heavy` tiers map to model defaults that can be overridden per-function in `/settings`. Cost optimization point: most light-tier functions use gpt-5.4-mini; heavy-tier (e.g., synthesis, score-coverage) use gpt-5.4 or gpt-5.5.
- **Prompt library** (`lib/ai/prompts/*.md`): all 22 system prompts are version-controlled markdown with frontmatter. `includes:` composes shared rubric partials (notably `shared/depth-scale.md` and `shared/kud-rubric.md`). **The `manning_skills:` frontmatter is the build-time encoding contract** — every prompt that embodies a Gareth Manning Education Agent Skill names which ones in its frontmatter and embodies them in its body. As of 2026-05-25, 16 of 22 prompts are Manning-encoded; the remaining 6 are either pure I/O glue (no pedagogical reasoning to encode) or deliberately deferred (capture-chat — see the [Manning encoding backfill plan](./plans/2026-05-25-manning-encoding-backfill.md)).
- **Prompt caching**: ~10% of input rate for cached tokens. Scorers sort batches by target/snapshot to maximize cache hits.

### Other current-state notes
- **Catalog data flow.** Bootstrapped from a seed script (`pnpm db:seed-courses`, 120 courses), then faculty edit per-course tabs on a shared Google Sheet. The bulk M-trial-era resync was retired, but per-course on-demand sync is live inside CourseCapture: the Materials panel's "Sync from Sheet" button calls `POST /api/courses/[code]/sync-from-sheet`, which re-reads the course's tab and updates its catalog row in place. The shared sheet remains the faculty-facing source of truth for catalog values.
- Canvas integration: tokens stored per-course in `course_canvas_links`; import pulls assignments + rubrics, modules + items, pages, discussions, quizzes, file metadata. Quizzes use both Classic (`/api/v1/`) and New Quizzes (`/api/quiz/v1/`) APIs.
- YouTube captions fetched via `youtube-transcript` npm package; Vimeo/Panopto/Loom appear as references the auditor surfaces but cannot transcribe (deferred).
- Auth model: single-user, slug-gated via `PROTOTYPE_SLUG` env. No per-user accounts.
- Vercel for app deploy; GitHub Pages for docs (this folder).

---

## Future increments (not yet planned, or partial)

| Increment | Description | Status |
| --------- | ----------- | ------ |
| **Phase 1A — Coverage Matrix** | Confirmed snapshots × career targets, heat map, on-demand AI scoring, cell drawer with evidence. | ✅ Shipped 2026-05-25 |
| **Phase 1B — Scaffolding Analysis** | Across the full degree plan, judge whether each competency is introduced (K1–2), practiced (K3–4 / U2–3 / D2–3), and brought to integration (U4–5 / D4–5) in the right course-level sequence. | Spec drafted; not implemented |
| **Phase 1C — Prerequisite Gap Analysis** | For any focal course, check prior coursework students actually take against the focal course's `incoming_expectations`. | Spec drafted; not implemented |
| **Phase 1D — Advising View** | Per-student / per-career-target advising slice. | Spec drafted; not implemented |
| **CareerCapture** | Employer-side parallel of CourseCapture: produces Role Outcome Profiles via audit conversation with employer respondents. | Strategic, no spec yet |
| **AnthropicProvider native PDF blocks** | Preserves tables/headers in PDF ingestion. Prerequisite for high-quality syllabus extraction. | Not built |
| **Capture-chat Manning encoding** | Whether to backfill `capture-chat` with Backwards Design framing. Held pending verification that the 4 other Phase B prompts produce better snapshots. | Deferred — see [the backfill plan](./plans/2026-05-25-manning-encoding-backfill.md) |
| **Phase-2 conversational agents** | Materials auditor + KUD chat as standalone agents (nanoclaw-style). | Blocked on nanoclaw API contract |
| **Cross-snapshot diff** | Show what changed between two snapshots of the same course. | Phase 2 carryover |
| **Industry Partner Input Plan 2** | Position ratings table + project-rating heat map. | Gap between Plan 1 and Plan 3 |

---

## Repo conventions

- Specs and plans are created via the `superpowers:brainstorming` and `superpowers:writing-plans` skills.
- Plans get executed via `superpowers:subagent-driven-development` (fresh subagent per task + spec/quality review).
- Each increment lives in its own dated file. Don't edit historical plans/specs; write new ones.
- The `docs/` folder is published to GitHub Pages via the `gh-pages` branch (the `docs/` folder root is served at `chiptoe-svg.github.io/gc-curriculum-tool/docs/`).
