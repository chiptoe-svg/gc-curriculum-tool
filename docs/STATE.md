# Project State — GC Curriculum Tool

> **Last verified:** `3adf862` · 2026-05-26
>
> **What this is:** the single source of truth for "what's live, what's next, what's blocked." Read this before any feature work, schema change, AI function add, deployment change, or new spec/plan. Static framing (KUD+, vision, architecture rationale) lives in [`CLAUDE.md`](../CLAUDE.md) and [`docs/superpowers/README.md`](./superpowers/README.md); this file is the volatile snapshot that sits in front of them.
>
> **Update protocol:** if your commit touches anything in [§What this file tracks](#what-this-file-tracks), update it in the same commit. For a full reconciliation, run `/refresh-state`.

---

## What's live

Two deployments, same codebase. Faculty side is gated by HTTP Basic Auth on the local Mac; partner side is public on Vercel.

### Faculty surfaces — local Mac (LAN, `0.0.0.0:3000`, Basic Auth)

| Route | Surface | Status | Shipped |
| ----- | ------- | ------ | ------- |
| `/capture/[code]` | **CourseCapture v1** — audit conversation → confirmed Course Outcome Profile + immutable snapshots | live | 2026-05-23 (prototype) → 2026-05-24 (v1 close-out) |
| `/explore/[code]` | **Explore v1** — custom-target authoring, downstream-target auto-detection, what-if scenarios | live | 2026-05-24 |
| `/program` | **Program Coverage Matrix (Phase 1A)** — snapshots × career-target sub-competencies, depth-aware heat map, on-demand AI scoring | live | 2026-05-25 |
| `/settings` | Per-function AI model tier + override | live | 2026-05-24 |
| `/admin/partners` | Partner CSV import, invites, status | live | 2026-05-19 (Plan 1) |
| `/admin/synthesis?slug=…` | Per-target AI synthesis dashboard (themes, salaries, partner quotes, proposed KUD edits) | live | 2026-05-19 (Plan 3) |
| `/` | Home (slug-gated) | live | — |

### Partner / public surfaces — Vercel (`gc-curriculum-tool.vercel.app`)

| Route | Surface | Status |
| ----- | ------- | ------ |
| `/partners/[token]` | Magic-link survey: welcome, target match, position-submission wizard (draft/submit/delete) | live |
| `/preview/[slug]` | M-trial prototype — Course Builder · Prereq Analyzer · Career-Target Alignment (legacy; still functional, superseded by Capture/Explore/Program for new work) | live |
| `/preview/[slug]/courses/[code]` | Per-course 4-tab page from M-trial: Info / Materials / Profile / KUDs | live |

The static GitHub-Pages preview at `chiptoe-svg.github.io/gc-curriculum-tool/` serves the docs (vision, specs, plans, deep-dives, faculty guide) plus the legacy interactive partner-interface preview. Submissions and feedback POST to a Google Apps Script Web App which appends to the shared Google Sheet's "Submissions" and "Feedback" tabs.

---

## Architecture (at-a-glance)

**Hybrid deploy (Phase 2, implementation complete per commit `01286f1`).** Same codebase, two runtime personalities flipped by env-var presence:

- **Local Mac.** `FACULTY_BASIC_AUTH` set → middleware gates faculty surfaces. `AI_PROVIDER=local` → omlx (Qwen3.6 family). `PDF_PARSER=docling` → docling-serve on 127.0.0.1:5001 (CPU mode, MPS gap). `DOCLING_VLM_*` → optional figure descriptions via local VLM. launchd-managed (`com.gc.curriculum-tool.plist`, `com.gc.docling-serve.plist`); restart on crash.
- **Vercel.** `FACULTY_BASIC_AUTH` unset → middleware no-ops. `AI_PROVIDER=openai`. `PDF_PARSER=unpdf` (or unset; default).
- **Shared.** Neon Postgres, single Drizzle schema, single OpenAI org for partner-side calls. The `/partners/*` magic-link survey runs from either.

Setup details: [`docs/superpowers/running-locally.md`](./superpowers/running-locally.md). Hybrid-deploy rationale + open items: [`docs/superpowers/plans/2026-05-25-phase2-hybrid-deploy.md`](./superpowers/plans/2026-05-25-phase2-hybrid-deploy.md).

### AI provider + function tiers

- **Provider abstraction** at `lib/ai/provider.ts`: `getProvider()` returns OpenAI / Anthropic / Local / Fake. Structured output via OpenAI strict JSON-schema + Zod parse.
- **Function tier system** at `lib/ai/function-settings.ts`: 9 named function IDs. Tier (light / default / heavy) maps to a model; per-function override stored in `ai_function_settings` table. 60s TTL resolver cache.

| Function ID | Default tier | Note |
| ----------- | ------------ | ---- |
| `capture-chat` | default | Bumped from light when audit bundle outgrew gpt-5.4-mini's 272k input cap |
| `capture-scores` | default | |
| `materials-analysis` | default | |
| `material-summary` | light | One short summarization pass per long reference material at extraction; cached on row |
| `explore-draft-target` | default | |
| `explore-compare` | default | |
| `explore-what-if` | default | |
| `program-score-coverage` | heavy | Heaviest scorer; batches by target for cache reuse |
| `decompose-prereq-gap` | default | |

**Reference-material compression** (`lib/capture/material-compression.ts`, `lib/capture/finalize-extraction.ts`, `lib/ai/analyze/material-summary.ts`): every extraction call site now routes through `finalizeExtraction`, which writes the extracted text and — if the material is long (≥15k tokens) AND a reference-leaning kind (Canvas File, Drive PDF, YouTube, plain upload) — synchronously summarizes and caches the result. `effectiveAuditText(m)` substitutes the summary in the audit prompt when `useSummary` is true. Canvas dense kinds (Syllabus, Assignments, Modules, Pages, Discussions, Quizzes) and Google Workspace materials are never summarized. Faculty toggle per row from the Materials panel; one-time backfill via `POST /api/courses/[code]/materials/compress`.

### Schema (Neon Postgres via Drizzle)

Latest migration: **`0021_soft_the_liberteens.sql`** (added `summary`, `summary_model`, `summary_generated_at`, `use_summary` to `course_materials`).

Tables defined in [`lib/db/schema.ts`](../lib/db/schema.ts):

- **Career target framework:** `careerTargets`, `subCompetencies`, `prototypeTargetEdits`
- **Courses + catalog:** `courses` (with `builder_status` enum: `draft | profile_complete | kuds_generated | approved`), `sheetSyncState`
- **Course profile (M-trial):** `courseProfiles`, `courseProfileRuns`, `courseMaterials`, `courseKuds`, `courseKudRuns`, `coverageScores`
- **CourseCapture v1:** `courseCaptureProfiles` (mutable draft), `courseCaptureSnapshots` (immutable versioned), `captureConversations` (persistent transcripts)
- **Explore v1:** `courseExploreTargets`, `courseExploreAnalyses`, `courseExploreWhatIfs`
- **Phase 1A coverage:** `snapshotTargetCoverage` (composite PK: `snapshotId × careerTargetId × subCompetencyId`)
- **Partners:** `partners`, `partnerSessions`, `partnerEvents`, `partnerSubmissions`, `synthesisRuns`
- **AI settings + telemetry:** `aiFunctionSettings`, `prototypeRuns`, `prototypeFlags`
- **Rate-limit / cost guard:** `dailyCost`, `ipHourly`

### Prompt library

22 system prompts in `lib/ai/prompts/*.md` with `manning_skills:` frontmatter contract. Shared partials in `lib/ai/prompts/shared/` (notably `depth-scale.md` — the authoritative KUD+ rubric — and `kud-rubric.md`). 16/22 are Manning-encoded; the remaining 6 are either pure I/O glue or deliberately deferred. See [`docs/superpowers/plans/2026-05-25-manning-encoding-backfill.md`](./superpowers/plans/2026-05-25-manning-encoding-backfill.md).

### Env vars

`.env.example` lists the full surface. Categories:

- **DB:** `DATABASE_URL`
- **AI:** `AI_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `LOCAL_BASE_URL`, `LOCAL_API_KEY`, `LOCAL_MODEL`
- **PDF:** `PDF_PARSER`, `DOCLING_URL`, `DOCLING_VLM_*`
- **Auth / slug:** `FACULTY_BASIC_AUTH` (faculty gate on local), `PROTOTYPE_SLUG` (single-user slug-gated session)
- **Cost guard:** `DAILY_COST_CAP_USD`, `COST_ALERT_EMAIL`
- **Sheets / partners:** `GOOGLE_SHEET_ID`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `PARTNERS_BASE_URL`, `SYNTHESIS_STALENESS_THRESHOLD`
- **Vercel Blob:** `BLOB_READ_WRITE_TOKEN`

---

## Active arc

**Faculty trial period.** The trial period started with the M-trial prototype and continues now across CourseCapture + Explore + Program. The point hasn't changed: confirm that the analysis is good enough to be useful before building the rest of Phase 1.

**Reference compression in production** (shipped 2026-05-25, today's most recent feature). Watching whether `gpt-5.4`'s 272k input cap holds for 2–3 more course captures with compression on. If 1+ more faculty hit the wall *after* compression, escalate to the two-tier digest + agentic retrieval design captured in the "Future directions" section of the reference-compression plan.

**Manning encoding backfill** (in progress). Phase A and Phase B (4 of 5) done; `capture-chat` deliberately deferred pending verification that the 4 encoded Phase B prompts produce better snapshots. If snapshot quality is unchanged or worse, Phase B becomes a revert candidate.

---

## Next-up

### Spec'd, not yet implemented

| Increment | Spec | Description |
| --------- | ---- | ----------- |
| **Phase 1B — Scaffolding Analysis** | [spec](./superpowers/specs/2026-05-25-scaffolding-analysis-design.md) | Depth-sequence scaffolding (introduce / practice / integrate) + productive-failure + reflection sequencing. Requires re-captured snapshots with `productive_failure_conditions` populated. |
| **Phase 1C — Prerequisite Gap Analysis** | sketched in [Phase 1 umbrella spec](./superpowers/specs/2026-05-24-program-coverage-views-spec.md) | For each captured course, compare its `incoming_expectations` against captured snapshots of its declared prerequisites. |
| **Phase 1D — Advising View** | sketched in same umbrella | Per-target recommended course sequence + gap detection. |

### Blocked

- **Phase 2 conversational agents** ([plan](./superpowers/plans/2026-05-22-phase2-agent-design.md)) — materials auditor + KUD chat as standalone nanoclaw-style agents. CourseCapture has absorbed much of the materials-auditor vision; the remaining piece is the nanoclaw integration. **Blocked on:** nanoclaw API contract (endpoint, auth, request/response shape, tool-registration model).
- **CareerCapture** — employer-side parallel of CourseCapture (Phase 3). Strategic, no spec yet. The current `/partners/*` magic-link survey is the partner-input precursor; CareerCapture would be the audit-conversational evolution.

### Deferred / debt

- **Real faculty auth.** Current Basic Auth gate is a stopgap. Options: magic-link sessions (same pattern as `/partners/*`), Clemson SSO/Shibboleth, OAuth via Clemson IdP. Revisit in deployment-planning phase.
- **DB off Neon, backup/restore, always-on hosting.** Deferred to deployment-planning phase.
- **Industry Partner Input Plan 2** — position ratings table + project-rating heat map. Gap between Plan 1 and the already-shipped Plan 3 synthesis.
- **AnthropicProvider native PDF blocks.** Prerequisite for high-quality syllabus extraction; not built.
- **Capture-chat Manning encoding.** Held pending snapshot-quality evidence from the 4 already-encoded Phase B prompts.
- **Cross-snapshot diff view.** Phase 2 carryover.

---

## What this file tracks

Update STATE.md as part of any commit that touches:

- **Routes** — anything added/removed/renamed under `app/**/page.tsx` or `app/api/**/route.ts`
- **Schema** — any new Drizzle migration in `drizzle/`, or any change to a table in `lib/db/schema.ts`
- **AI functions** — adding / removing / renaming an entry in `AI_FUNCTION_IDS`, or changing a default tier in `DEFAULT_TIERS` (`lib/ai/function-settings.ts`)
- **Env vars** — anything added/removed in `.env.example`
- **Deployment surface** — middleware behavior, what runs where, launchd plists
- **Plan / spec status** — when a plan ships, a spec is superseded, or a new plan/spec file lands in `docs/superpowers/{plans,specs}/`
- **"What's live"** — adding / removing / renaming a user-visible surface

Trivial commits (typos, copy edits, single-line bugfixes, internal refactors that change nothing above) do **not** update this file.

---

## Conventions (project-specific)

- **Specs and plans** are created via `superpowers:brainstorming` and `superpowers:writing-plans`. One dated file per increment; never edit historical specs/plans (write a new one that supersedes).
- **Plans executed** via `superpowers:subagent-driven-development` (fresh subagent per task + spec/quality review).
- **`docs/`** is published to GitHub Pages from `main`; the source `.md` files are the source of truth, the `.html` siblings are styled exports.
- **`pnpm`** is the package manager. `pnpm dev` for solo dev (localhost); `pnpm dev:lan` for the launchd 0.0.0.0 binding.
- **Migrations** via `pnpm db:generate` + `pnpm db:migrate` (drizzle-kit). Never rename a generated migration file.

---

## Related

- [`CLAUDE.md`](../CLAUDE.md) — session bootstrap; KUD+ summary, doc map, codegraph protocol, pre-impl ritual.
- [`docs/superpowers/README.md`](./superpowers/README.md) — full doc index (specs, plans, vision, deep-dives, pilot writeups).
- [`docs/superpowers/running-locally.md`](./superpowers/running-locally.md) — local-Mac setup, launchd plists, Docling + omlx wiring.
