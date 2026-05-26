# Project State — GC Curriculum Tool

> **Last verified:** `b4e0cac` · 2026-05-26
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

- **Provider abstraction** at `lib/ai/provider.ts`: `getProvider()` returns OpenAI / Anthropic / Local / Fake. Structured output via OpenAI strict JSON-schema + Zod parse. **New as of 2026-05-26 (CourseCapture v2 Stage 1):** `completeWithTools` method on all four providers, built on Vercel AI SDK v6 — used by Stage 3's agent loop (not exposed by any AI function yet).
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

Latest migration: **`0023_tiresome_rhino.sql`** (CourseCapture v2 Stage 1: adds UNIQUE constraint on `capture_messages(session_id, turn_index)`; follows `0022_mighty_firedrake.sql` which created `capture_messages` + added `courses.audit_mode` + `course_capture_snapshots.transcript_session_id`).

Tables defined in [`lib/db/schema.ts`](../lib/db/schema.ts):

- **Career target framework:** `careerTargets`, `subCompetencies`, `prototypeTargetEdits`
- **Courses + catalog:** `courses` (with `builder_status` enum: `draft | profile_complete | kuds_generated | approved`), `sheetSyncState`
- **Course profile (M-trial):** `courseProfiles`, `courseProfileRuns`, `courseMaterials`, `courseKuds`, `courseKudRuns`, `coverageScores`
- **CourseCapture v1:** `courseCaptureProfiles` (mutable draft), `courseCaptureSnapshots` (immutable versioned + new `transcript_session_id` linking to v2 sessions), `captureConversations` (legacy; preserved as-is, no new writes after Stage 3 cutover)
- **CourseCapture v2 Foundation:** `captureMessages` (append-only conversation log keyed by `session_id` + `turn_index`, UNIQUE-constrained; replaces session-overwriting `captureConversations`)
- **Course-level toggle:** `courses.audit_mode` (`'full'` | `'simple'`, default `'full'`; UI lands in Stage 2)
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

**CourseCapture v2 — Agentic Retrieval Architecture (Stage 1 shipped; Stages 2–5 pending).** Spec at [`docs/superpowers/specs/2026-05-26-coursecapture-agentic-retrieval-design.md`](./superpowers/specs/2026-05-26-coursecapture-agentic-retrieval-design.md); Stage 1 plan at [`docs/superpowers/plans/2026-05-26-coursecapture-v2-stage1-foundation.md`](./superpowers/plans/2026-05-26-coursecapture-v2-stage1-foundation.md). Replaces the "dump every material into one context" pipeline with three phases — per-material ingestion (chunk + digest + index in Weaviate), tool-using audit agent, synthesis with intrinsic provenance. Coexists with user's local agent infrastructure (shared Weaviate, per-course tenant). Supersedes the Phase 2 agent design ([`2026-05-22-phase2-agent-design.md`](./superpowers/plans/2026-05-22-phase2-agent-design.md)) and generalizes the reference-compression plan's two-tier future-directions.

**Stage 1 (Foundation) shipped 2026-05-26** (commits `a280db6` → `b4e0cac`, 9 commits):
- Schema: `capture_messages` append-only table with `UNIQUE(session_id, turn_index)`, `courses.audit_mode` toggle (default `'full'`), `course_capture_snapshots.transcript_session_id` link. Migrations `0022_mighty_firedrake.sql` + `0023_tiresome_rhino.sql`.
- Queries: `lib/db/capture-messages-queries.ts` (`appendMessage`, `getSessionMessages`, `startNewSession`).
- Data migration: existing `capture_conversations` row for GC 4800 mirrored into `capture_messages` (one-off script in `scripts/_one-off/`).
- Provider abstraction extended with `completeWithTools` across OpenAI, Anthropic, Local, Fake providers. Built on Vercel AI SDK v6 (`ai@6.0.191`) using `generateText` + `Output.object` + `tool` primitives (v6 replaces v4's `generateObject`). No AI function exposes this yet — wires up in Stage 3.
- Stages 2–5 wait on user's local Weaviate instance (~2 days out per the spec phasing).

**Tactical Canvas-Syllabus suppression shipped 2026-05-26** (commit `8774b92`). Canvas Syllabus pages are skipped at import when the Sheets catalog has ≥1 learning objective; three existing rows (GC 1010, GC 3800, GC 4800) retroactively marked ignored. Step ahead of the broader curation rule set in the agentic-retrieval spec.

**Manning encoding backfill** (in progress). Phase A and Phase B (4 of 5) done; `capture-chat` deliberately deferred pending verification that the 4 encoded Phase B prompts produce better snapshots. If snapshot quality is unchanged or worse, Phase B becomes a revert candidate. **The capture-chat rewrite in the agentic-retrieval spec absorbs this work** — the new `capture-chat-agent.md` will carry Manning encoding from the start.

---

## Next-up

### Spec'd, not yet implemented

| Increment | Spec | Description |
| --------- | ---- | ----------- |
| **CourseCapture v2 — Agentic Retrieval** | [spec](./superpowers/specs/2026-05-26-coursecapture-agentic-retrieval-design.md) | Three-phase architecture: per-material ingestion (chunk + digest + Weaviate index), tool-using audit agent, synthesis with intrinsic provenance. Per-course Weaviate tenants on a shared local instance. `audit_mode` toggle per course (Full / Simple). Pending implementation plan. **Next move.** |
| **Phase 1B — Scaffolding Analysis** | [spec](./superpowers/specs/2026-05-25-scaffolding-analysis-design.md) | Depth-sequence scaffolding (introduce / practice / integrate) + productive-failure + reflection sequencing. Data dependency satisfied by the agentic-retrieval architecture once snapshots are produced with it. |
| **Phase 1C — Prerequisite Gap Analysis** | sketched in [Phase 1 umbrella spec](./superpowers/specs/2026-05-24-program-coverage-views-spec.md) | For each captured course, compare its `incoming_expectations` against captured snapshots of its declared prerequisites. |
| **Phase 1D — Advising View** | sketched in same umbrella | Per-target recommended course sequence + gap detection. |

### Blocked

- **Phase 2 conversational agents** ([plan](./superpowers/plans/2026-05-22-phase2-agent-design.md)) — **superseded by the agentic-retrieval spec** above. The remaining pieces (materials auditor + KUD chat as standalone agents) are absorbed into the v2 architecture; nanoclaw block is no longer load-bearing since the v2 design uses the existing provider abstraction extended with tool-use.
- **CareerCapture** — employer-side parallel of CourseCapture (Phase 3). Strategic, no spec yet. The current `/partners/*` magic-link survey is the partner-input precursor; CareerCapture would be the audit-conversational evolution.

### Deferred / debt

- **Real faculty auth.** Current Basic Auth gate is a stopgap. Options: magic-link sessions (same pattern as `/partners/*`), Clemson SSO/Shibboleth, OAuth via Clemson IdP. Revisit in deployment-planning phase.
- **DB off Neon, backup/restore, always-on hosting.** Deferred to deployment-planning phase.
- **Industry Partner Input Plan 2** — position ratings table + project-rating heat map. Gap between Plan 1 and the already-shipped Plan 3 synthesis.
- **AnthropicProvider native PDF blocks.** Prerequisite for high-quality syllabus extraction; not built.
- **Capture-chat Manning encoding.** Held pending snapshot-quality evidence; **absorbed into the v2 agentic-retrieval spec** — the new `capture-chat-agent.md` prompt will carry Manning encoding from the start, so this deferred decision becomes moot when v2 ships.
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
