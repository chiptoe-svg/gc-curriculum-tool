# GC Curriculum Tool — v1 Implementation Design

**Scope:** Builds 1–3 from `gc-curriculum-tool-spec.md` (Foundation, Course Content, Coverage Analysis)
**Date:** 2026-05-17
**Status:** Draft for user review

This document is the implementation design for the first three builds of the GC Curriculum Tool. It resolves the architectural and scope questions the source spec leaves open and produces a buildable plan. Builds 4–7 (Proposals, Curriculum Map, Sankey/Sequence, Resource Summary, Presentation View) and the full Assessment Framework are out of scope for this design and will get their own design docs once v1 is real with seeded data.

---

## 1. Architecture & Stack

**Application:** Next.js 15 App Router (React 19, TypeScript). Single deployable serving both UI and API routes from the same Vercel project.

**Database:** Postgres via Neon (Vercel-managed serverless Postgres free tier; expandable).

**ORM / migrations:** Drizzle ORM. Typed schema in TS, versioned migrations checked into the repo.

**UI:** Tailwind CSS + shadcn/ui component primitives.

**AI provider abstraction:** `lib/ai/provider.ts` exposes one interface with two implementations (`OpenAIProvider`, `AnthropicProvider`). Switched via `AI_PROVIDER` env var. Default: `openai`. System prompts and Manning-skill encodings live in `lib/ai/prompts/` and are provider-agnostic — no Anthropic-specific syntax (no `<thinking>` tags, no prompt-caching markers, no extended-thinking). Structured outputs use OpenAI's `response_format: { type: 'json_schema' }`; the Anthropic implementation uses JSON mode with schema validation in the client.

**O\*NET integration:** `lib/onet/` — thin client around the public O\*NET Web Services API. Requires a free API key registered at `services.onetcenter.org`. Responses cached for 24 hours in the database (`onet_cache` table) to avoid hitting rate limits and to keep panel sessions responsive.

**Auth:** Deferred. Build 1–3 run with a hardcoded single-admin session (you). NextAuth is added at Build 4 when faculty actually log in. Until then, every request is treated as the admin user; UI shows your name in the header but there's no login screen.

**Hosting:** Vercel for the app, Neon for the DB. Both have generous free tiers. Total infrastructure cost during v1: ~$0/month. O\*NET API is free. OpenAI API costs estimated at $10–15 across all of v1 development (see Section 4 cost ballpark).

**Repository layout (after M0):**

```
/app
  /(admin)/                          Routes available to admin role
    courses/                         Course index + detail + edit
    targets/                         Career Target index + detail + edit
    coverage/                        Coverage heat map
  /api/                              API routes
    courses/                         CRUD endpoints
    targets/
    ai/
      draft-outcomes/
      score-coverage/
      unpack-competency/
      rescore-all/
    onet/
      fetch-ksas/
/components/                         shadcn/ui components + project-specific UI
/lib
  /db/                               Drizzle schema, migrations, query helpers
  /ai/                               Provider abstraction, prompt files, Manning encodings
    /prompts/                        Markdown files with YAML frontmatter
  /onet/                             O*NET client + caching
  /domain/                           Pure TS types + business logic (no React, no DB)
/scripts                             One-off scripts (seed, import, batch operations)
/docs/superpowers/specs/             Design docs (this file lives here)
```

**Why Next.js + Postgres and not the source spec's "Claude artifact":** the source spec hedges between artifact-based prototype and full app. v1 has four user roles eventually, real persistence, real AI calls, and PDF export. Claude artifacts are not the right home for any of these. Starting on Next.js avoids a costly migration at Build 4.

**Why we are not forking DCM (WolfgangFahl/dcm) or adopting Skills-Mapping (Humanitariansai/Skills-Mapping):** evaluated and rejected. DCM is a research artifact (5 stars, 1 fork, RWTH-Aachen internal use) in Python + NiceGUI; its competency-tree paradigm conflicts with the spec's flatter target → sub-competency structure; it has no AI, no auth, no Proposal concept — the hard parts of this tool. Skills-Mapping is an empty repo (all data/code directories empty as of API check 2026-05-17). The genuine insight from that research — *help advisors set up career targets, don't make them stare at blank fields* — is folded into the design via O\*NET KSA fetching and the AI competency-unpacking endpoint (Section 4).

---

## 2. Data Model (v1 subset)

Drizzle schema. Only the entities needed for Builds 1–3 are included; Proposal-related and assessment-related entities are deferred to their respective design docs.

```ts
// Users — single admin row seeded; multi-user comes at Build 4
users {
  id: uuid (pk)
  name: text
  email: text (unique)
  role: enum('admin', 'faculty', 'panel_member', 'viewer')  // only 'admin' used in v1
  created_at: timestamp
}

// Courses — identity record
courses {
  id: uuid (pk)
  code: text (unique)                  // "GC 3010"
  title: text
  credit_hours: integer
  level: integer                        // 1 / 2 / 3 / 4 (parsed from 1000/2000/3000/4000)
  delivery_format: enum('in_person', 'hybrid', 'online')
  owner_id: uuid → users.id (nullable; null in v1)
  official_record_id: uuid → course_records.id (nullable; set when first record is marked accurate)
  retired: boolean (default false)
  retired_at: timestamp (nullable)
  created_at: timestamp
}

// Prerequisites — many-to-many self-reference
course_prerequisites {
  course_id: uuid → courses.id
  prereq_course_id: uuid → courses.id
  PRIMARY KEY (course_id, prereq_course_id)
}

// Course records — versioned content
course_records {
  id: uuid (pk)
  course_id: uuid → courses.id
  description: text
  know_outcomes: jsonb              // string[] — "Students will know that..."
  understand_outcomes: jsonb        // string[]
  do_outcomes: jsonb                // string[]
  syllabus_text: text
  is_official: boolean              // exactly one record per course has true
  marked_accurate_by: uuid → users.id (nullable)
  marked_accurate_at: timestamp (nullable)
  notes: text                        // internal notes
  created_at: timestamp
}

// Projects — separate table (not embedded) for queryability
projects {
  id: uuid (pk)
  course_record_id: uuid → course_records.id
  name: text
  description: text
  competency_tags: jsonb            // string[] of sub_competency ids; faculty claims
  display_order: integer
}

// Career Targets
career_targets {
  id: uuid (pk)
  name: text
  short_definition: text
  industry_contexts: jsonb          // string[] — 2-3 examples
  know_descriptors: jsonb           // string[]
  understand_descriptors: jsonb     // string[]
  do_descriptors: jsonb             // string[]
  panel_notes: text
  panel_members: jsonb              // string[] of "Name, Affiliation"
  defensibility_note: text
  last_reviewed_at: timestamp (nullable)
  soc_code: text (nullable)         // "13-1161.00" — anchors O*NET fetch
  soc_label: text (nullable)        // cached SOC title at fetch time
  display_order: integer
}

// Sub-competencies — children of career targets
sub_competencies {
  id: uuid (pk)
  career_target_id: uuid → career_targets.id
  name: text
  know_descriptor: text
  understand_descriptor: text
  do_descriptor: text
  display_order: integer
}

// Coverage scores — AI-generated, versioned, per (course_record × sub_competency)
coverage_scores {
  id: uuid (pk)
  course_record_id: uuid → course_records.id
  sub_competency_id: uuid → sub_competencies.id
  kud_level: enum('know', 'understand', 'do', 'not_addressed')
  confidence: enum('high', 'medium', 'low')
  ai_reasoning: text                 // 1–3 sentences, required
  disputed: boolean (default false)
  dispute_note: text (nullable)      // preserved across reruns
  scored_at: timestamp
  ai_provider: text                  // "openai" | "anthropic"
  ai_model: text                     // "gpt-4o" | "claude-sonnet-4-6"
}

// O*NET response cache
onet_cache {
  soc_code: text (pk)
  payload: jsonb                     // raw O*NET API response
  fetched_at: timestamp
}

// Prerequisite competencies — what students should walk INTO this course with
// (distinct from course_prerequisites, which is the registrar's course-to-course list)
prerequisite_competencies {
  id: uuid (pk)
  course_record_id: uuid → course_records.id
  sub_competency_id: uuid → sub_competencies.id
  expected_kud_level: enum('know', 'understand', 'do')
  rationale: text                    // why this course needs this competency
                                     // (faculty-authored, AI-drafted)
  source: enum('faculty', 'ai_suggested', 'ai_confirmed')
                                     // tracks who claimed it
  display_order: integer
}
```

**Notable design calls:**

- **Projects in a separate table, not embedded JSON.** Costs nothing in complexity; lets us query "all projects tagged with sub-competency X" later (useful for Build 4 Impact View).
- **`ai_provider` and `ai_model` recorded on every coverage_score.** Not in source spec. Reproducibility matters: when you switch providers or models later, you'll want to know which scores came from which.
- **Disputes preserved across reruns.** When a course record's coverage is rescored, the new `coverage_scores` rows inherit `disputed=true` and `dispute_note` from the prior row for the same (course_record × sub_competency) pair. Faculty pushback should not silently vanish.
- **At most one official record per course.** Enforced by a partial unique index on `course_records(course_id) WHERE is_official = true`. A newly-created course has zero official records until "Mark as accurate" runs the first time. After that, "Mark as accurate" runs in a transaction that flips the prior official record's flag to false and the new one's flag to true.
- **Prerequisite competencies are the inverse of coverage.** Coverage answers "what does this course build *toward*?" Prerequisite competencies answer "what does this course expect students to walk *in* with?" The combination lets us detect scaffolding failures — when a the course's expectations exceed what any prior course actually develops. This is distinct from the registrar's `course_prerequisites` (which is just "must have taken X before"); it's the competency-grain version of the same idea. Manning's "Learning Progressions" (D7) and "Scope and Sequence" (D16) skills, both cited in the source spec, encode the reasoning framework for this analysis.

---

## 3. Pages & Flows (v1)

### Routes

```
/                                Dashboard — recent activity, jump-off links
/targets                         Career Target index
/targets/[id]                    Career Target detail + editor
                                 - Identity block, KUD descriptors, panel info
                                 - "Suggest from O*NET" button (if soc_code present)
                                 - Sub-competency list with inline editor + drag-reorder
                                 - Each sub-competency row has "Help draft KUD descriptors" (AI)
/courses                         Course index — sortable table, filter by level
/courses/new                     Create course (identity only)
/courses/[id]                    Course page — Official Record view-only mode
                                 - Identity block (read-only)
                                 - Description + KUD outcomes + projects
                                 - Prerequisite Competencies (what this course expects)
                                 - Prerequisite Gaps — flagged competencies no prior coursework
                                   course develops to the expected level
                                 - Coverage scores grouped by target, click-to-expand reasoning
                                 - Dispute UI per coverage row
/courses/[id]/edit               Edit course record
                                 - "Paste syllabus → Draft outcomes" workflow
                                 - Outcome editors (3 sections, 3–5 bullets each)
                                 - Project editor (add/remove/reorder, competency tag picker)
                                 - Prerequisite competency editor with AI suggestion
                                   ("Based on your outcomes, the AI thinks these should be
                                   in place when students arrive — accept / edit / reject")
                                 - "Mark as accurate" action
/coverage                        Heat map view — courses × sub-competencies
                                 - Color-coded cells by KUD level
                                 - Click cell → side panel with reasoning + dispute
```

### The Build 2 → Build 3 loop (where the AI value shows up)

1. Open `/courses/GC-3460/edit` (the course identity already exists from seed data).
2. Paste syllabus text into the syllabus field.
3. Click **"Draft outcomes from syllabus"** → AI populates Know/Understand/Do fields with editable bullets and a draft description.
4. Edit outcomes; add 2–4 projects with descriptions; tag each project with sub-competencies from the picker.
5. Click **"Mark as accurate"** → in a single transaction:
   - The prior official `course_records` row's `is_official` flips to false.
   - A new `course_records` row is created with `is_official = true`.
   - A background job enqueues coverage analysis: 5 API calls (one per career target).
6. The course page updates as scores arrive. Each coverage row shows KUD pill + confidence badge + click-to-expand reasoning.
7. If a score is wrong, click **"Dispute"**, write a note. The note is preserved across reruns.
8. `/coverage` heat map reflects the new scores.

### Key design calls

- **Coverage analysis runs per-target, not per-sub-competency.** One API call returns scores for all sub-competencies under one career target. Cheaper (5 calls per save instead of 20+), more coherent reasoning (the model sees the whole target frame at once), and lets us show "reasoning per target" cleanly in the UI.

- **"Mark as accurate" is the analysis trigger, not "Save".** The course record draft autosaves while editing without invoking AI. Coverage analysis only runs when you mark it accurate. This matches the source spec's intent ("the map is always live") and avoids running expensive AI on every keystroke.

- **No Proposal mode in v1.** The Course Page header shows the Official Record state only. "Start a Proposal" is a disabled button with a "Coming in Build 4" tooltip. This is honest and prevents architectural debt from a half-built feature.

- **Heat map is the only visualization in v1.** Sankey, Sequence Map, and Gap Panel are Build 5–6. The heat map alone delivers ~80% of the analytical value for the v1 gate (panel review).

- **Prerequisite Gaps appear as a list, not a diagram in v1.** A faculty-resonant section on the Course Page: "These competencies are expected when students arrive, but no prior course develops them to the expected level." Each gap shows the prerequisite competency, expected KUD level, what (if anything) prior courses develop instead, and AI reasoning. The Sequence Map (Build 6) will eventually overlay this on the prerequisite network diagram with red arrows for failed scaffolding chains, but the list form alone is what faculty will react to.

---

## 4. AI Integration & Manning Skills

### Endpoints

| Endpoint | Trigger | Input | Output |
|---|---|---|---|
| `POST /api/ai/draft-outcomes` | Course edit page button | syllabus text + all career target descriptors | `{description, know[], understand[], do[]}` |
| `POST /api/ai/score-coverage` | Mark as accurate (per target) | course record (KUD + projects) + one career target with sub-competencies | `[{sub_competency_id, kud_level, confidence, reasoning}]` |
| `POST /api/ai/unpack-competency` | Sub-competency "Help draft KUD descriptors" button | sub-competency name + parent target context | `{know_descriptor, understand_descriptor, do_descriptor}` |
| `POST /api/ai/suggest-prerequisites` | Course edit "Suggest prerequisite competencies" button | course record (KUD + projects) + all sub_competencies | `[{sub_competency_id, expected_kud_level, rationale}]` |
| `POST /api/ai/analyze-prerequisite-gaps` | After Mark as accurate (background) | course record + its prerequisite competencies + coverage scores for all prior courses | `[{prerequisite_competency_id, status: 'met'|'underdeveloped'|'missing', prior_coursework_evidence, reasoning}]` |
| `POST /api/ai/rescore-all` | Career target updated (admin only) | batch, background | rescore every course's coverage for the updated target |
| `POST /api/onet/fetch-ksas` | Career Target "Suggest from O*NET" button | SOC code | structured KSAs (cached 24h) |

The O\*NET endpoint is not an AI call — it's a direct proxy with caching.

### Manning skill encoding strategy

The source spec mandates encoding four Manning domain skill sets (Domains 7, 16, 13, 9) into AI system prompts at build time. Approach:

1. At implementation start, attempt to fetch `github.com/GarethManning/education-agent-skills` and read the SKILL.md files for the named skills.
2. If the repo is accessible, encode each skill's reasoning framework into the relevant prompt file. Where the spec chains two skills (e.g., "Backwards Design + KUD Chart Authoring"), the prompt explicitly walks through both frameworks in sequence.
3. If the repo is private or otherwise unavailable, fall back to encoding the spec's own summary descriptions of each Manning skill (the spec's "Manning Skills Integration" section already summarizes each one well).

Prompt files live as version-controlled markdown with YAML frontmatter listing which Manning skills they encode and any version notes:

```
/lib/ai/prompts/
  draft-outcomes.md           uses: Backwards Design + KUD Chart Authoring + Threshold Concept Translation
  score-coverage.md           uses: Coverage Audit + KUD Chart Authoring + Assessment Validity +
                                    Developmental Band Translation + Disciplinary AI Reliability
  unpack-competency.md        uses: Competency Unpacking
  suggest-prerequisites.md    uses: Learning Progressions + Scope and Sequence + Backwards Design
  analyze-prerequisite-gaps.md  uses: Learning Progressions + Scope and Sequence +
                                       Developmental Band Translation
  shared/kud-rubric.md        the KUD scoring rubric, included by both scoring and unpacking
  shared/career-target-frame.md   how to reason about target sub-competencies
```

Each prompt is loaded at runtime and composed into a system prompt sent with the request.

### The "AI reasons out loud" rule

Every coverage score includes a `reasoning` field of 1–3 sentences citing specific outcomes or projects. The JSON schema enforces non-empty reasoning; an empty or trivially short reasoning fails validation and the call is retried with a clarifying message. This is mechanically enforced because the source spec's whole philosophical stance — "the tool does not present AI output as authoritative fact" — depends on it.

### Cost ballpark (OpenAI gpt-4o, v1 development)

- One full coverage rescore: 13 courses with data × 5 targets = 65 calls.
- Per call: ~2K input tokens + ~600 output tokens.
- Rate: ~$0.005 input + ~$0.015 output per call → ~$1.30 per full rescore.
- Expected runs during v1: 5–10 (initial seeding, prompt tuning, panel demo iteration). **~$10–15 total.**
- Drafting outcomes from a syllabus: one-off, ~5K input + ~1K output → ~$0.05 per course. **<$1 total across all course content entry.**
- Competency unpacking and O\*NET fetches: negligible.

---

## 5. Build Sequence & Milestones

Each milestone is independently usable and ends with a real-data gate. Don't start the next milestone until the prior one is real.

### M-trial — Faculty-facing prototype (~6–7 days)

**Purpose:** A standalone demo page faculty can actually use on their own. Validates the AI prompts against real syllabi before architectural commitment, and gives early faculty members something concrete to react to.

**Page structure (single route, `/`):**

1. **Hero + bigger-picture intro.** Plain-language: what the full curriculum tool will do, why it matters for the GC program, why this prototype exists and what it does and doesn't represent. Roughly 200–300 words. Authored content.
2. **Instructions** — short numbered list:
   - Paste a prior course's syllabus (e.g., GC 3460), or click "Load example"
   - Paste the syllabus of the course being analyzed (e.g., GC 4060), or click "Load example"
   - Pick a career target from the dropdown
   - Click "Analyze"
   - Review the results — click any AI reasoning to expand it; flag anything that looks wrong
3. **The interactive form** — two syllabus textareas (each with "Load GC 3460 example" / "Load GC 4060 example" buttons pre-populating from the source spec's course descriptions), a career target dropdown, and an Analyze button.
4. **Output area (renders after Analyze):**
   - Two side-by-side KUD outcome cards (AI-drafted, shown clearly as drafts)
   - A heat map: 2 rows (courses) × N columns (sub-competencies of the chosen target), color-coded by KUD level
   - Click any cell → expand AI reasoning + a "Flag this" button (with note field)
   - A Prerequisite Gap Analysis panel: for each expected competency in the course being analyzed, status (met / underdeveloped / missing) + AI reasoning + Flag button
5. **Footer:** "This is a prototype. The full tool ships in ~3 months. Feedback: <Chip's email>."

**Technical components:**

- Next.js page at `/` with API routes for the AI calls
- AI provider abstraction (`lib/ai/provider.ts`) + OpenAI implementation — **becomes the foundation of the real tool**
- Manning-skill-encoded prompts (`lib/ai/prompts/*.md`) — **becomes the foundation of the real tool**
- Seed data in TS: 5 career targets with sub-competencies and KUD descriptors — **becomes M1 seed data**
- Heat map component + prerequisite gap component — **become M3 UI**
- `prototype_runs` table (or just JSON log): records each anonymous run with the inputs and outputs for prompt tuning analysis
- `prototype_flags` table: records faculty pushback on AI reasoning (same dispute pattern as the real tool)
- Cost protection: per-IP rate limit (10 analyses / hour), daily total cap ($5/day), email alert if cap hit
- Unguessable URL: deployed at a slug like `gc-curriculum-tool.vercel.app/preview/<slug>` so the page isn't randomly discoverable; share the link with faculty directly

**Access model:** Unguessable URL, no password. Faculty get the link from you. If you want a password later (e.g., before sending to industry panel), it's a one-line change.

**Sample syllabi:** Pre-loaded from the source spec's course descriptions for GC 3460, GC 4060, GC 4070, GC 4400, GC 3720, GC 3400. Faculty can replace with their own paste-ins. (Six options keeps the demo flexible across discussions; not all are loaded by default — the buttons let people pick what to compare.)

**Gate:** A faculty member you've never demoed it to can open the link, follow the instructions, paste their own syllabus, get a result they find substantive enough to argue with, and flag at least one piece of AI reasoning. You can read the flags afterward and use them to tune prompts before M0.

**What carries forward to M0–M3 (~80–85% of code):**
- AI provider abstraction, prompt files, JSON schemas
- Seed career target data and sub-competencies
- Heat map and prerequisite gap components
- O*NET client (if added in this milestone — optional; could defer to M1)

**What's thrown away (~15–20% of code):**
- Single-page form UI (replaced by Course Page editor in M2)
- Routing scaffolding (just `/` and a few API routes)
- The "Load example" buttons and intro copy

---

### M0 — Project scaffold (~½ day)

- Next.js 15 + TS + Tailwind + shadcn/ui initialized.
- Drizzle + Neon connected. Trivial first migration runs (creates an `_app_meta` table with version + deployed_at) to prove the toolchain works before any real schema lands in M1.
- `lib/ai/provider.ts` abstraction + OpenAIProvider implemented and tested with a simple ping.
- Hardcoded admin session middleware.
- O\*NET API key registered; client stub returns mock data.
- Deploy to Vercel with preview URL.
- **Gate:** `/` loads on Vercel. `/api/health` returns OK and includes DB version + AI provider name.

### M1 — Foundation (~3–4 days)

- Drizzle schema for: `users`, `courses`, `course_prerequisites`, `career_targets`, `sub_competencies` (no `course_records` yet — identity only).
- Seed script (`scripts/seed.ts`) parses the source spec markdown (`gc-curriculum-tool-spec.md`) to populate:
  - All 5 career targets with seed KUD descriptors, industry contexts, defensibility notes, and SOC codes (from the spec's "Career Target Framework" section).
  - Seed sub-competencies (typically 5–7 per target) inferred from the spec's "Core competency areas" lists.
  - All 19 courses (13 with data + 6 without) as identity records with code, title, level.
- `/targets` index + `/targets/[id]` editor: KUD descriptor editing, sub-competency CRUD with drag-reorder, panel info, defensibility note.
- `/courses` index + `/courses/[id]` (placeholder view) + `/courses/new` + `/courses/[id]/edit` (identity fields only).
- `POST /api/onet/fetch-ksas` endpoint + 24-hour cache; "Suggest from O\*NET" button on Career Target page presents KSAs as a checklist for the panel member to selectively adopt.
- `POST /api/ai/unpack-competency` endpoint + "Help draft KUD descriptors" button on the sub-competency editor.
- **Gate:** All 5 career targets editable with full KUD descriptors and sub-competencies. The three SOC-anchored targets (Account Management, Brand Strategy, Production & Operations) have at least one panel-selected KSA from O\*NET visible in their notes. At least one sub-competency was drafted with AI assistance. All 19 courses listed and editable in the index.

### M2 — Course content + AI drafting (~5–6 days)

- Drizzle schema additions: `course_records`, `projects`, `prerequisite_competencies`. Partial unique index for `is_official`. Migration runs.
- Course page (Official Record view mode) renders the spec's full course layout. Coverage and Prerequisite Gaps sections are placeholders ("full analysis lights up in M3") until M3 ships.
- Course edit page: description, KUD outcome editors (3 sections), syllabus text area, project editor (add/remove/reorder, competency tag picker), prerequisite competency editor with AI-suggest button.
- `POST /api/ai/draft-outcomes` endpoint wired to "Draft outcomes from syllabus" button.
- `POST /api/ai/suggest-prerequisites` endpoint wired to "Suggest prerequisite competencies" button.
- "Mark as accurate" action: transaction that flips `is_official` and timestamps. Coverage analysis and prerequisite gap analysis enqueues are stubbed (return OK without running) — actual scoring lands in M3.
- Seed script extension: optionally drafts initial outcomes and prerequisite competencies for the 13 courses-with-data by feeding the spec's prose into the drafting and suggestion endpoints, then storing them as draft (un-marked-accurate) records for review.
- **Gate:** You've marked 3 courses accurate with real outcomes, projects, and prerequisite competencies. AI drafting and prerequisite suggestion noticeably reduce work vs typing from scratch. The Course Page reads clearly enough that a faculty member could understand it.

### M3 — Coverage + prerequisite gaps + heat map (~6–7 days)

- Manning-skill-encoded prompt files written and reviewed: `score-coverage.md`, `analyze-prerequisite-gaps.md`, and the shared rubric/frame files.
- `POST /api/ai/score-coverage` endpoint with strict JSON schema (`response_format` for OpenAI; equivalent validation for Anthropic).
- `POST /api/ai/analyze-prerequisite-gaps` endpoint. For a course record, transitively walks `course_prerequisites` to assemble the prior coursework coverage, then evaluates each prerequisite competency against what's actually developed across the prior coursework.
- "Mark as accurate" enqueues background work in this order: (1) 5 coverage scoring calls, one per target; (2) 1 prerequisite gap analysis call once coverage is in. Background runner is a simple in-process queue for v1 — no Inngest/QStash yet.
- Dispute preservation: rescores inherit `disputed` and `dispute_note` from the prior row for the same key. Applies to both coverage_scores and prerequisite gap results.
- Course Page: coverage rows grouped by target, KUD pill + confidence badge + click-to-expand reasoning panel, dispute UI. **Prerequisite Gaps section** lists each expected-but-undeveloped competency with prior coursework evidence and AI reasoning.
- `/coverage` heat map: courses (rows) × sub-competencies (columns), color-coded by KUD level (Do dark green, Understand olive, Know amber, not_addressed dark grey). Click cell → side panel with reasoning + dispute UI. Left-edge stripe color codes course level.
- Admin-only "Rerun analysis" button per course (one-off retry for transient failures or prompt updates).
- `POST /api/ai/rescore-all` endpoint triggered when a career target's KUD descriptors or sub-competencies change. Background batch reruns coverage for every course against that target; prerequisite gap analyses re-trigger for courses whose prerequisite chain coverage may have shifted.
- **Gate:** Coverage scores running on 5+ courses against all 5 targets. Prerequisite gaps surfaced on at least one course where a real gap exists (the GC 4060 → GC 3460 chain is the strongest candidate from current data). At least one disputed score with a note. The heat map and gap view are presentable to the industry/faculty panel without apologizing for them. You can answer both "why does this course score Understand on Brand Strategy?" and "what does GC 4060 expect that nothing earlier delivers?" by clicking and reading the AI's reasoning.

### What's not in v1

Out of scope for this design (each gets its own design doc when ready):

- **Build 4** — Proposal system (faculty-authored course revisions, Change Summary, Impact View, accept/reject flow). Auth and roles arrive here.
- **Build 5** — Curriculum Map (basic), Curriculum Proposals (add/retire), snapshots.
- **Build 6** — Sankey diagram, Sequence Map, display modes (Current / Proposed / Comparison).
- **Build 7** — Resource Summary auto-generation, Presentation View, PDF exports.
- **Assessment Framework** — Performance Standards, RubricAlignment, Assessment Gates, CohortGateResult, Placement Dashboard. Begins post-Build 4.

### v1 total estimate

**~4.5 weeks** of focused work for one developer including the prototype:
M-trial 6–7 days + M0 ½ day + M1 3–4 days + M2 4–5 days + M3 3–4 days.
The M2 and M3 estimates shrink (vs. the no-prototype path) because the AI prompts, seed data, heat map, and prereq-gap components are already proven by then. The faculty trial during the prototype phase also reduces the risk of late changes to the schema or rubric. Going without the prototype would cost ~3.5 weeks of focused work, but with materially higher risk on M3 quality and faculty acceptance.

---

## 6. Open Questions for User Review

These don't block writing the implementation plan but should be answered before M0 starts.

1. **Domain / hosting name.** Vercel deploys to `*.vercel.app` by default. Do you want a custom domain (e.g., `curriculum.clemson-gc.edu` or similar) and is Clemson IT involved in DNS?
2. **GitHub repo.** Should I assume a private GitHub repo will exist (you mentioned uploading the spreadsheet once one is established)? Public or private?
3. **OpenAI API key.** Do you have an API key with credit, or do we need to budget for the initial $20 setup at the OpenAI console?
4. **O\*NET API key.** Free but requires registration. I can register one in your name once we have a project email, or you can do it directly at `services.onetcenter.org/developer/signup`.
5. **xAPI integration (future, but worth flagging).** DCM uses xAPI statements for learner achievement data. Worth keeping in mind as the wire format for future Build 4+ assessment data flowing into the tool. Not built in v1; just noted.

---

## 7. Out-of-Scope Decisions Captured for Future Builds

- **Auth:** NextAuth at Build 4. Single admin session in v1.
- **Spreadsheet import:** GC_Core_Curriculum.xlsx is not needed for v1 because the source spec markdown already contains structured course data. If you upload the spreadsheet later, a separate script can reconcile and enrich.
- **Snapshots:** Build 5. Schema will add a `snapshots` table that captures full state as JSON.
- **PDF export:** Build 7. Likely react-pdf or Puppeteer-rendered print CSS.
- **Sankey + Sequence Map:** Build 6. Pure React + SVG (no D3 dependency) following the reference `gc-curriculum-viz.jsx` approach when that file becomes available.
- **AI-exposure context for career targets:** Future enhancement. The Career Target page could surface a per-SOC AI exposure score and BLS Occupational Outlook Handbook narrative as additional context informing the `defensibility_note` field. Reference: `karpathy/jobs` demonstrates the LLM-scored-with-rationale pattern over BLS data. We would source from BLS public data files directly (karpathy/jobs has no license file, so the code itself is not reusable). Not v1.

---

*End of v1 implementation design.*
