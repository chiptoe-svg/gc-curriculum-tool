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
| 2026-06-04 | [`specs/2026-06-04-evidence-ladder-design.md`](./specs/2026-06-04-evidence-ladder-design.md) | Evidence-ladder: per-claim credibility (claimed/materials-supported/artifact-verified) derived at read time from existing `source`+`citations`. No schema change, no migration, retroactive. Shipped 2026-06-04. |
| 2026-06-04 | [`specs/2026-06-04-problem-solving-capture-fix-design.md`](./specs/2026-06-04-problem-solving-capture-fix-design.md) | Problem-solving capture fix: presence-as-sentinel, unified prompt paths, `no_data` pf_status band, citation-backed structured_post_mortem, legacy reclassification. Shipped 2026-06-04. |
| 2026-06-04 | [`specs/2026-06-04-session-continuity-briefing-design.md`](./specs/2026-06-04-session-continuity-briefing-design.md) | Session-continuity briefing: deterministic structured briefing replaces raw-transcript dump in audit agent at-rest context. Shipped 2026-06-04. |
| 2026-06-04 | [`specs/2026-06-04-wiki-update-compile-loop-design.md`](./specs/2026-06-04-wiki-update-compile-loop-design.md) | `wiki-update` compile-loop design: compiles immutable raw layer into the regenerated wiki narrative layer. Needs review before writing-plans pass. |
| 2026-06-04 | [`specs/2026-06-04-position-capture-v1-prebuild-amendments.md`](./specs/2026-06-04-position-capture-v1-prebuild-amendments.md) | Position Capture v1 pre-build amendments (A1–A5): sub-competency join key on qualifying competencies + Page-5 ratings, day-one entry-level anchor, demand-side evidenced_by/confidence discipline, and the A5 demand→snapshot_target_coverage seam spec (keyed demand captured, sufficiency scoring deferred to unified-coverage-layer). Applied to schema 0029 + synthesis. |

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
| 2026-05-21 | [`plans/2026-05-21-anthropic-provider.md`](./plans/2026-05-21-anthropic-provider.md) | ✅ Done. Anthropic added to the `AI_PROVIDER` abstraction alongside OpenAI; structured output via the SDK's tool-use mode + Zod parse. |
| 2026-05-21 | [`plans/2026-05-21-canvas-import.md`](./plans/2026-05-21-canvas-import.md) | ✅ Done. Canvas import via API token + course id; pulls assignments, modules, module items, quizzes, pages, discussions; published-only filter (2026-06-02 refinement); per-item ignore via `course_materials.ignored_items`. |
| 2026-05-21 | [`plans/2026-05-21-sheet-sync.md`](./plans/2026-05-21-sheet-sync.md) | ⏸ Superseded by `pnpm db:seed-courses`. The resync route returns 410. |
| 2026-05-21 | [`plans/2026-05-21-syllabus-entry.md`](./plans/2026-05-21-syllabus-entry.md) | ✅ Done. Faculty syllabus upload + structured extraction → CaptureProfile seed. |
| 2026-05-21 | [`plans/2026-05-21-course-builder.md`](./plans/2026-05-21-course-builder.md) | ✅ Done. 5-stage Course Builder workflow live: `builder_status` on courses, `course_kuds`/`course_kud_runs` tables, KUD generation pipeline, 4-tab UI (Info/Materials/Profile/KUDs), approval gate in CourseSelector. |
| 2026-05-22 | [`plans/2026-05-22-conversational-kud.md`](./plans/2026-05-22-conversational-kud.md) | ✅ Done. Conversational KUD-chat agent (Phase 2 design precursor). |
| 2026-05-22 | [`plans/2026-05-22-graduate-data-collection.md`](./plans/2026-05-22-graduate-data-collection.md) | Planning artifact for graduate-outcome validation dataset. |
| 2026-05-22 | [`plans/2026-05-22-graduate-outcome-validation.md`](./plans/2026-05-22-graduate-outcome-validation.md) | Planning artifact for the validation proposal published at [`graduate-outcome-validation.html`](../graduate-outcome-validation.html). |
| 2026-05-22 | [`plans/2026-05-22-phase2-agent-design.md`](./plans/2026-05-22-phase2-agent-design.md) | Phase 2 conversational-agent design decisions (materials auditor + KUD chat); blocked on nanoclaw API contract. |
| 2026-05-23 | [`plans/2026-05-23-coursecapture-prototype.md`](./plans/2026-05-23-coursecapture-prototype.md) | ✅ Done. CourseCapture v1 prototype: per-course audit chat, scoring pipeline, voice input. |
| 2026-05-25 | [`plans/2026-05-25-manning-encoding-backfill.md`](./plans/2026-05-25-manning-encoding-backfill.md) | In progress. Backfill Manning-skill encoding for prompts written after the original M-trial pattern was set; `manning_skills:` frontmatter as the contract. Phase A (program-score-coverage) and Phase B (4 capture-pipeline prompts) done; `capture-chat` deferred pending verification. |
| 2026-05-25 | [`plans/2026-05-25-capture-reference-compression.md`](./plans/2026-05-25-capture-reference-compression.md) | ✅ Done. Auto-compress long reference materials at extraction so the audit-chat prompt stays under the OpenAI input cap. New `material-summary` AI function + `summary` columns on `course_materials` + shared `finalizeExtraction` helper that every extraction site routes through. Faculty get a per-row `summarize` toggle and a one-time "Compress existing materials" backfill button. |
| 2026-05-25 | [`plans/2026-05-25-phase2-hybrid-deploy.md`](./plans/2026-05-25-phase2-hybrid-deploy.md) | ✅ Done, then superseded 2026-06-04. Established the original hybrid Mac-local + Vercel-side deployment with `FACULTY_BASIC_AUTH` gating, env-var-driven provider/extractor swap. The hybrid retired on 2026-06-04 when the partner survey moved to the Mac too — see [`2026-06-04-partner-handoff-vercel-phaseout.md`](./plans/2026-06-04-partner-handoff-vercel-phaseout.md). |
| 2026-05-26 | [`plans/2026-05-26-coursecapture-v2-stage1-foundation.md`](./plans/2026-05-26-coursecapture-v2-stage1-foundation.md) | ✅ Done. Provider abstraction extended with `completeWithTools` across all five providers (built on Vercel AI SDK v6 `generateText` + `Output.object` + `tool` primitives). Foundation for the agentic-retrieval pipeline that replaces "dump every material into one context." |
| 2026-05-26 | [`plans/2026-05-26-coursecapture-v2-stage2a-pre-weaviate.md`](./plans/2026-05-26-coursecapture-v2-stage2a-pre-weaviate.md) | ✅ Done. Per-material ingestion pipeline (chunker, FERPA detector, materials policy, in-memory vector store) before Weaviate adapter shipped. `material-digest` replaces `material-summary`. |
| 2026-05-27 | [`plans/2026-05-27-coursecapture-v2-stage2b-weaviate.md`](./plans/2026-05-27-coursecapture-v2-stage2b-weaviate.md) | ✅ Done. Weaviate adapter on the v2 vector-store interface; per-course tenant isolation; launchd-managed at 127.0.0.1:8090. |
| 2026-05-27 | [`plans/2026-05-27-coursecapture-v2-stage3-agent.md`](./plans/2026-05-27-coursecapture-v2-stage3-agent.md) | ✅ Done. Tool-using audit-chat agent — `capture-chat-agent` per-turn loop emits structured `{ finding, question, citations, readiness }`; retrieval tools query the per-course Weaviate tenant. |
| 2026-05-27 | [`plans/2026-05-27-coursecapture-v2-stage4-synthesis.md`](./plans/2026-05-27-coursecapture-v2-stage4-synthesis.md) | ✅ Done. v2 synthesis prompt + schema produces a CaptureProfile with intrinsic provenance (per-finding citations to specific transcript turns or material chunks). |
| 2026-05-28 | [`plans/2026-05-28-coursecapture-v2-stage6-agent-persona.md`](./plans/2026-05-28-coursecapture-v2-stage6-agent-persona.md) | ✅ Done. Audit-agent persona refinement — opening-turn self-introduction (no fake user row), conversational discipline, citation rigor enforced at validate time. |
| 2026-05-28 | [`plans/2026-05-28-coursecapture-v2-stage7a-streaming-and-stage5-legacy.md`](./plans/2026-05-28-coursecapture-v2-stage7a-streaming-and-stage5-legacy.md) | ✅ Done. Streaming via NDJSON deltas in `CaptureChatPanel`; v1 (Stage 5 legacy) capture pages render a "this is the legacy view" banner pointing to v2. |
| 2026-05-28 | [`plans/2026-05-28-phase1b-scaffolding-stage1-data-and-strip.md`](./plans/2026-05-28-phase1b-scaffolding-stage1-data-and-strip.md) | 🚧 Stage 1 done — `scaffolding_observations` table + per-course `scaffolding_strip` derived view + `/program/scaffolding` view. Subsequent stages (productive-failure indicators, three-act structure overlays) pending. |
| 2026-05-28 | [`plans/2026-05-28-spreadsheet-trial-readiness.md`](./plans/2026-05-28-spreadsheet-trial-readiness.md) | ✅ Done. xlsx/xls/xlsm narrowed in materials policy to gradebook-shaped filenames; `compactSpreadsheetMarkdown` strips empty rows + degenerate tables + inline base64 image blobs (the dominant token cause). |
| 2026-05-29 | [`plans/2026-05-29-feedback-widget-phase1.md`](./plans/2026-05-29-feedback-widget-phase1.md) | ✅ Done. `<FeedbackWidget />` mounted on every faculty page; `POST /api/feedback` → GitHub Issue (`gc-feedback` label) with auto-captured route/course/UA context. |
| 2026-05-30 | [`plans/2026-05-30-feedback-widget-phase2.md`](./plans/2026-05-30-feedback-widget-phase2.md) | ✅ Done. launchd cron orchestrates `/triage-feedback` + `/implement-feedback` every 15 min; hard gates (`gate-auth`, `gate-cost`, `gate-prompts-or-schema`, `gate-anonymous`) block auto-implement until removed; daily-cost interlock halts the run when today's spend ≥ cap; bot PRs prefixed `[bot-<effort>]`, never auto-merged. |
| 2026-05-30 | [`plans/2026-05-30-wiki-readiness-substrate.md`](./plans/2026-05-30-wiki-readiness-substrate.md) | ✅ Done. gc-curriculum-wiki repo + `wiki-update` AI function + scheduled narrative sync from program/course state. The substrate that curriculum-chat reads against. |
| 2026-05-31 | [`plans/2026-05-31-course-overview-and-landing-page.md`](./plans/2026-05-31-course-overview-and-landing-page.md) | ✅ Done. `/` lists every course (HTTP, public) with View + Edit buttons; per-course read-only profile views at `/view/[code]`. |
| 2026-06-01 | [`plans/2026-06-01-curriculum-wiki-and-chat.md`](./plans/2026-06-01-curriculum-wiki-and-chat.md) | ✅ Done. `curriculum-chat` AI function + three navigation tools (`read_wiki` / `list_wiki` / `search_wiki`) over the wiki narrative layer; agent emits `{ response, citations[] }` with verbatim-excerpt page citations. |
| 2026-06-02 | [`plans/2026-06-02-curriculum-chat-phase-b-revised.md`](./plans/2026-06-02-curriculum-chat-phase-b-revised.md) | ✅ Done. Curriculum-chat Phase B — third mode in `/explore/[code]?tab=ask`, standalone `/ask?slug=…`, panel on `/wiki`, `💬 Ask` deep-links in every faculty header. Shared `<AskTab>` auto-selects course-anchored vs. standalone endpoints. |
| 2026-06-03 | [`plans/2026-06-03-microphone-bridge-via-tailscale.md`](./plans/2026-06-03-microphone-bridge-via-tailscale.md) | ⏸ Superseded same day. The spec-broken HTTPS-iframe-in-HTTP-parent attempt to get mic access on the LAN deploy — fails per W3C Secure Contexts. Replaced by the hybrid HTTP/HTTPS architecture below. |
| 2026-06-03 | [`plans/2026-06-03-hybrid-http-https-mic-architecture.md`](./plans/2026-06-03-hybrid-http-https-mic-architecture.md) | ✅ Done. Replaces the iframe-bridge approach: public HTTP landing + read-only profile views at the LAN IP; whole faculty app on Tailscale Funnel HTTPS (Basic Auth gated) where mic works natively in a top-level secure context. |
| 2026-06-03 | [`plans/2026-06-03-adversarial-stress-test-agent.md`](./plans/2026-06-03-adversarial-stress-test-agent.md) | ✅ Done. On-demand `capture-stress-test` agent (heavy tier) that adversarially reviews a produced Course Outcome Profile. Per-competency annotations (confidence + concerns + optional suggested adjustments) + profile-level concerns + overall assessment. Ephemeral — never persisted to the draft. Surfaced inline in `ProfileReviewPanel`. |
| 2026-06-03 | [`plans/2026-06-03-neon-to-local-postgres-migration.md`](./plans/2026-06-03-neon-to-local-postgres-migration.md) | ⏸ Superseded same day by [`2026-06-03-local-canonical-postgres-migration.md`](./plans/2026-06-03-local-canonical-postgres-migration.md). Initial two-DB framing kept partner data + reference tables canonical on Neon; reframed before execution. |
| 2026-06-03 | [`plans/2026-06-03-local-canonical-postgres-migration.md`](./plans/2026-06-03-local-canonical-postgres-migration.md) | ⏸ Superseded 2026-06-04. Proposed local-canonical-with-Neon-as-buffer architecture; never executed. Subsumed by the simpler wholesale phaseout below once the partner survey moved to the funnel too. |
| 2026-06-04 | [`plans/2026-06-04-careercapture-v1.md`](./plans/2026-06-04-careercapture-v1.md) | ⏸ Superseded by **Position Capture v1** (2026-06-05). CC v1 was a non-functional prototype (one employer trial, flow did not work); schema 0029 renames its tables; the `/partners/[token]/interview/[targetId]` route is retired. |
| 2026-06-04 | [`plans/2026-06-04-partner-handoff-vercel-phaseout.md`](./plans/2026-06-04-partner-handoff-vercel-phaseout.md) | ✅ Done. Vercel + Neon + Resend phaseout in a single push. Manual-send admin UI replaces Resend invites; `PARTNERS_BASE_URL` flipped to the Tailscale Funnel; `lib/db/client.ts` swapped from `@neondatabase/serverless` to `node-postgres`; Neon dumped + restored to Postgres.app on `127.0.0.1:5433`. The Mac is now the only host; the Vercel/Neon dashboard cleanup is the only user-side residue. |
| 2026-06-04 | [`plans/2026-06-04-position-capture-v1.md`](./plans/2026-06-04-position-capture-v1.md) | ✅ Done (shipped 2026-06-05). Full 6-page Position Capture v1 flow: JD ingest → uniqueness → interview questions → trajectory → AI-rated experiences → agent interview → synthesis → immutable `position_captures` row. Schema 0029. Retires CC v1's partner-facing surface + the old 3-step `/submit` wizard. Pre-build amendments A1–A5 folded in (sub-competency join key, demand discipline, A5 seam spec). 20 tasks via subagent-driven execution. |

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
