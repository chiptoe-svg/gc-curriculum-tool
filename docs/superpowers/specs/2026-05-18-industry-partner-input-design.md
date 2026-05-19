# Industry Partner Input Tool — v1 Design

**Date:** 2026-05-18
**Status:** Approved design, ready for implementation planning.
**Sibling docs:** [v1 Curriculum Tool Design](./2026-05-17-gc-curriculum-tool-v1-design.md), [Vision](../vision/gc-curriculum-tool-vision.md).

## Why this exists

The curriculum tool answers two questions: *what is our curriculum* and *how well does it build toward defined career targets*. Today the career targets are seeded from O\*NET and faculty judgment. They are the load-bearing definition the whole tool builds on — and they are not yet grounded in what hiring industry partners actually need from a GC graduate.

This tool is the **upstream feeder** for career targets: a magic-link web app that asks industry partners to describe the positions they hire GC grads into, and to rate the relevance of the projects students are doing. Faculty then sees aggregated, AI-synthesized insights per career target — including concrete proposed edits to the Know/Understand/Do descriptors — and curates from there.

It is not a job board, an HRIS, or a placement system. It is a structured-opinion collector with an AI-powered synthesis layer.

## v1 Scope

Three workflows ship in v1:

1. **Partner input form** — anchored to existing career targets, position-specific, repeatable per partner.
2. **Faculty synthesis dashboard** — read-only insights plus proposed KUD diffs per target. No auto-write-back; faculty copies accepted edits manually into the curriculum tool.
3. **Project relevance ranking** — partners rate course projects on a 1–5 relevance scale with optional comments.

### Out of v1 (deferred to v2+)

- Cross-target "Karpathy-wiki" synthesis of themes across all career targets at once.
- Auto-write-back of accepted KUD diffs into `careerTargets` / `subCompetencies`.
- Per-submission AI condensation at submit time (we synthesize server-side later).
- Weekly digest emails to faculty.
- Partner self-service profile editing.
- Multi-language support.

## Architecture

### Repo & deploy

Same repo, same Next.js app as the curriculum tool. Three new route groups:

- `app/partners/[token]/...` — partner-facing magic-link experience. Own layout, own branding shell. Auth = valid token in URL → session cookie scoped to this route group. Partner requests cannot reach faculty routes.
- `app/admin/synthesis/...` — faculty-facing admin pages. Sits beside existing `/api/admin/*` surface; reuses the existing admin auth pattern.
- `app/api/partners/...` and `app/api/synthesis/...` — server endpoints.

Single Vercel deploy at first. Optional `partners.gc-tool.vercel.app` subdomain later via CNAME + middleware rewrite if visual separation is wanted — no rebuild needed.

### Data model — seven new Drizzle tables

All live in the existing Neon Postgres database.

#### `partners`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `email` | text NOT NULL, unique | invite address |
| `firstName` | text NOT NULL | |
| `lastName` | text NOT NULL | |
| `company` | text NOT NULL | |
| `roleTitle` | text | nullable |
| `weight` | integer NOT NULL DEFAULT 1 | faculty-set synthesis weight; 0 = include in raw view but exclude from synthesis |
| `careerTargetHints` | jsonb (string[]) | optional career target IDs to pre-filter project ratings |
| `magicToken` | text NOT NULL, unique | 32-char URL-safe random; bearer of identity |
| `tokenExpiresAt` | timestamptz | nullable (default: never expires) |
| `notes` | text | faculty-only |
| `createdAt` | timestamptz NOT NULL DEFAULT now() | |
| `invitedAt` | timestamptz | set when invite email actually sent |
| `firstOpenedAt` | timestamptz | nullable |
| `lastActiveAt` | timestamptz | nullable |
| `active` | boolean NOT NULL DEFAULT true | soft-deactivate flag (revokes token) |

#### `partner_sessions`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | cookie value |
| `partnerId` | uuid NOT NULL FK → partners.id | |
| `createdAt` | timestamptz NOT NULL DEFAULT now() | |
| `expiresAt` | timestamptz NOT NULL | 24h after creation |

The URL token is permanent; the session cookie authenticates subsequent API calls and can be revoked without invalidating the token.

#### `partner_submissions`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `partnerId` | uuid NOT NULL FK → partners.id | |
| `careerTargetId` | text FK → careerTargets.id | nullable if "none of these fit" |
| `unmappedTargetLabel` | text | nullable; free-text label when no target matches |
| `positionTitle` | text NOT NULL | only required field besides FKs |
| `responsibilities` | text | |
| `salaryRangeLow` | integer | nullable |
| `salaryRangeHigh` | integer | nullable |
| `salaryCurrency` | text NOT NULL DEFAULT 'USD' | |
| `interviewQuestions` | jsonb (string[]) NOT NULL DEFAULT [] | |
| `requiredSkills` | jsonb (string[]) NOT NULL DEFAULT [] | |
| `niceToHaveSkills` | jsonb (string[]) NOT NULL DEFAULT [] | |
| `additionalNotes` | text | |
| `status` | text NOT NULL | 'draft' \| 'submitted' |
| `createdAt` | timestamptz NOT NULL DEFAULT now() | |
| `updatedAt` | timestamptz NOT NULL DEFAULT now() | |
| `submittedAt` | timestamptz | nullable; set when status flips to 'submitted' |

Drafts are editable. Submitted entries are locked but deletable (delete + start new is the supported "edit" path for submissions).

#### `partner_project_ratings`

| column | type | notes |
|---|---|---|
| `partnerId` | uuid NOT NULL FK → partners.id | |
| `courseCode` | text NOT NULL FK → courses.code | |
| `projectIndex` | integer NOT NULL | index into `courses.majorProjects` jsonb array |
| `projectTextSnapshot` | text NOT NULL | snapshot at rating time so the rating stays meaningful if course sheet edits the project description |
| `relevanceRating` | integer NOT NULL | 1–5 |
| `comment` | text | nullable |
| `createdAt` | timestamptz NOT NULL DEFAULT now() | |
| `updatedAt` | timestamptz NOT NULL DEFAULT now() | |

PK: `(partnerId, courseCode, projectIndex)`. One rating per partner per project.

#### `synthesis_runs`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `careerTargetId` | text NOT NULL FK → careerTargets.id | |
| `submissionCount` | integer NOT NULL | how many submissions fed this run |
| `result` | jsonb NOT NULL | aggregated insights + proposed KUD diffs (schema below) |
| `model` | text NOT NULL | |
| `costUsdCents` | integer NOT NULL | |
| `createdAt` | timestamptz NOT NULL DEFAULT now() | |

Most recent run per `careerTargetId` is the live one. A run is "stale" when current submission count exceeds the cached `submissionCount`, or the run is more than 30 days old. Older runs are kept for history.

`result` jsonb shape:

```ts
{
  aggregatedJobTitles: { title: string; count: number; partnerIds: string[] }[];
  responsibilityThemes: { theme: string; quotedFrom: { partnerId: string; snippet: string }[] }[];
  commonRequiredSkills: { skill: string; count: number }[];
  commonNiceToHaveSkills: { skill: string; count: number }[];
  interviewQuestionThemes: { theme: string; examples: string[] }[];
  salaryDistribution: { p25?: number; p50?: number; p75?: number; n: number };
  sampleQuotes: { partnerId: string; quote: string }[];
  proposedKUDEdits: {
    descriptor: 'know' | 'understand' | 'do';
    type: 'addition' | 'edit';
    targetDescriptorIndex?: number; // for edits
    proposedText: string;
    rationale: string;
    supportingPartnerIds: string[];
  }[];
}
```

#### `project_comment_summaries`

| column | type | notes |
|---|---|---|
| `courseCode` | text NOT NULL FK → courses.code | |
| `projectIndex` | integer NOT NULL | |
| `themes` | jsonb (string[]) NOT NULL | LLM-extracted recurring themes from project comments |
| `commentCountAtRun` | integer NOT NULL | comment count when this summary was generated; used for staleness |
| `costUsdCents` | integer NOT NULL | |
| `createdAt` | timestamptz NOT NULL DEFAULT now() | |
| `updatedAt` | timestamptz NOT NULL DEFAULT now() | |

PK: `(courseCode, projectIndex)`. Side cache for the project-comment LLM summarization; regenerated when the underlying comment count grows past `commentCountAtRun`.

#### `partner_events`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `partnerId` | uuid FK → partners.id | nullable for admin-side actions |
| `eventType` | text NOT NULL | enum: 'invited', 'opened', 'started_submission', 'submitted_position', 'rated_project', 'admin_imported_csv', 'admin_resent_invite', 'admin_deactivated', 'admin_reactivated' |
| `metadata` | jsonb | event-specific payload |
| `createdAt` | timestamptz NOT NULL DEFAULT now() | |

Lightweight audit log for engagement signal and operational debugging.

### Auth model

- **Partner identity:** URL magic token → server validates against `partners.magicToken` and `partners.active = true` → issues 24h httpOnly cookie session backed by `partner_sessions`. All `/api/partners/*` calls accept either valid session cookie OR valid token in URL.
- **Faculty identity:** Reuse the existing admin auth pattern from `/api/admin/*`. No new auth surface introduced.
- **Rate limiting:** Reuse `lib/rate-limit` with new buckets. Per-partner caps: 50 submission writes/day, 200 rating writes/day. These are well above any real use; they exist to block accidental scripts.
- **Token security:** 32-char URL-safe random from `crypto.randomBytes(24).toString('base64url')`. Tokens never logged. Deactivation immediately invalidates both token and any active sessions.

## Partner experience

### Email + landing

Faculty sends invites via admin CSV import. Email comes from Resend with a single CTA — *"Tell us about the roles you hire GC grads into."* Link goes to `/partners/[token]`.

First click: token validated → session cookie set → `partner.firstOpenedAt` set (if null) → `partner_events.opened` row → land on `/partners/[token]`.

The single landing route `/partners/[token]` renders either the welcome screen (no submissions and no ratings yet) or the partner dashboard (any activity exists). No separate `/welcome` route — same URL, content branches on partner state.

### Welcome screen

One screen. Three sentences of context, estimated time ("about 10 min per position you describe, plus ~5 min if you want to rate student projects"), and three CTAs:

- **Describe a position you hire for** → Flow A
- **Rate student projects** → Flow B
- **See my submissions** → partner dashboard (only shown if they have any)

Order is free. Both flows are repeatable. They can leave and return via the same link.

### Flow A — Position submission

Three steps, one screen each, top progress bar.

**Step 1 — Pick the closest match.** Career-target cards (name + `shortDefinition` + `industryContexts` chips). They pick one. Bottom of page: *"None of these quite fit — let me describe it"* opens a free-text label field, which sets `unmappedTargetLabel` and leaves `careerTargetId` null. Copy uses *"closest match"* framing throughout, never *"select your category"*.

**Step 2 — Describe the position.** Single scrollable form, sectioned:

- *Position basics* — job title (text, required), responsibilities summary (textarea)
- *Compensation* — salary range low / high (two number inputs, optional) + currency dropdown (default USD)
- *What you look for* — required skills (tag input), nice-to-have skills (tag input)
- *How you screen* — interview questions (repeatable text rows, "+ add another"), additional notes (textarea)

Only `positionTitle` is required. Missing fields don't feed synthesis on those axes — better to have partial data than none.

Top-right: *Save draft*. Bottom: *Submit*. Submit shows a confirmation modal: *"You can add another position, rate student projects, or finish up."*

**Step 3 — Confirmation.** Three buttons: add another position, rate student projects, "I'm done."

### Flow B — Project ranking

Single page. Vertical list of project cards. Each card shows:

- Course code + title
- Project description (string from `courses.majorProjects[projectIndex]`)
- 1–5 star control labeled *"How relevant is this to skills you'd hire for?"*
- Optional comment box (collapsed by default; "Add a comment" expands)

**Pre-filtering:** Default view shows ~10–15 projects filtered to be relevant to the career targets the partner is associated with (from `partner.careerTargetHints` if set, plus any career targets they've already submitted positions for). Bottom of page: *"Show more projects"* loads the rest, grouped by career target.

`projectTextSnapshot` is captured at first rating so the rating stays interpretable even if the underlying course sheet edits the project description.

Save is per-row: rating changes debounced PATCH to the server. No "submit" button on this flow; the partner just rates what they want and leaves. Returning to this page shows their existing ratings.

### Partner dashboard (`/partners/[token]`)

Reachable any time. Shows:

- Name + company at top
- Three summary cards: submissions count (with *Add another position*), project ratings count (with *Rate more projects*), and *I'm done* (shows a thanks page; the partner can still return via the same link anytime — `lastActiveAt` is updated on every interaction regardless)
- Below cards: list of their submissions with status pills (Draft / Submitted), Edit buttons (drafts only), Delete buttons (drafts and submissions both)

## Faculty admin surface

Four pages under `/admin/synthesis/`:

### 1. Partners (`/admin/synthesis/partners`)

Table of all partners: name, company, weight, invited date, last active, # submissions, # ratings, status pills. Per-row actions: edit (name/company/weight/notes), resend invite email, deactivate/reactivate. Top-right: *Import CSV* button.

CSV import flow: modal accepts CSV with columns `email,firstName,lastName,company,roleTitle,weight,careerTargetHints` (last three optional). Preview screen shows row-level validation (bad email format, duplicate email, unknown career target ID in hints). On confirm: insert rows, generate magic tokens, send invite emails via Resend, log `admin_imported_csv` event with row count.

### 2. Submissions firehose (`/admin/synthesis/submissions`)

Reverse-chronological list of every `submitted` submission across all partners. Filters: career target, partner, has-salary, date range. Each row expands to show full submission text with full attribution. CSV export for any filter. This is the "raw signal" view — what you read when you want unfiltered partner voice without AI in the middle.

### 3. Per-target synthesis (`/admin/synthesis/targets/[targetId]`)

The headline page. Per career target:

- **Header stats:** # submissions, # unique partners, weighted submission sum (sum of `partners.weight` across contributing partners), salary distribution (sparkline + p25/p50/p75), nearby `unmappedTargetLabel` values from "none of these fit" submissions (so you spot emerging targets).
- **AI-synthesized panel:** aggregated job titles, responsibility themes, common required skills, common nice-to-haves, interview question themes, sample verbatim quotes (with attribution).
- **Proposed KUD diffs panel:** for each K/U/D descriptor on this target, AI proposes additions and edits with rationale. Each proposal: proposed text, "supported by N partners" link, *Copy to clipboard* button. Faculty pastes accepted edits into the curriculum tool manually.
- **Re-run synthesis button** (cost shown inline). Auto-runs when current submission count exceeds cached `submissionCount` by 5 or more (threshold configurable via `SYNTHESIS_STALENESS_THRESHOLD` env var, default 5); manual button for in-between.

### 4. Project ratings (`/admin/synthesis/projects`)

Heat-map-style view: courses × projects × average rating, weighted by `partners.weight`, with submission count. Mirrors the visual language of the existing coverage heat map for visual consistency. Click any cell → drawer with all individual ratings + comments for that project. For projects with ≥3 comments, an AI-generated "themes from comments" summary appears at the top of the drawer.

## AI synthesis pipeline

Lives in `lib/ai/synthesis/` alongside existing `lib/ai/` modules.

### Entry points

**`synthesizeTarget(targetId): Promise<SynthesisResult>`** — main per-target run.

1. Load the career target and its current K/U/D descriptors.
2. Load all `partner_submissions` where `status = 'submitted'` and `careerTargetId = targetId`. Exclude submissions where `partners.weight = 0`.
3. Join `partners` to get name + company + weight per submission.
4. Build a structured prompt:
   - System message: defines the task — synthesize partner input into aggregated insights + propose specific edits to current KUD descriptors. Output is structured JSON matching the `result` shape above.
   - User message: lists current K/U/D descriptors for the target, then an enumerated list of submissions in the form `Partner: {firstName} {lastName} ({company}, weight: {N}). Position: {positionTitle}. Responsibilities: {responsibilities}. Required skills: {requiredSkills.join(', ')}. ...`. Higher-weighted partners are explicitly flagged in the instructions: *"Give proportionally more weight to higher-weighted partners' input."*
5. Call LLM with JSON output mode. Validate response with Zod against `SynthesisResult` schema.
6. Write `synthesis_runs` row with the result, model, cost.
7. Log `partner_events` with type `synthesis_run_completed` and metadata `{ targetId, cost, submissionCount }`.

**`stalenessCheck(targetId): { stale: boolean; reason?: string }`** — used by the dashboard to render "show cached" vs. "needs re-run" badge.

- Stale if: most recent run's `submissionCount` < current submission count for this target, OR run is > 30 days old, OR no run exists.

**`aggregateProjectRatings(): ProjectAggregate[]`** — pure SQL aggregation (no LLM) of weighted average ratings per `(courseCode, projectIndex)`.

**`summarizeProjectComments(courseCode, projectIndex): Promise<{ themes: string[] }>`** — one LLM call per project that has ≥3 comments. Result cached on a small `project_comment_summaries` table keyed on `(courseCode, projectIndex)` with a `commentCountAtRun` column for staleness detection (re-run when current comment count exceeds cached count).

### Model & provider

Same provider abstraction as `lib/ai/`. Default to OpenAI's cheapest competent JSON-mode model for synthesis (this is mostly summarization). Anthropic via env flag. Cost tracked through the existing `daily_cost` table and per-run `costUsdCents` column. Daily cap configurable via env; over-cap → re-run button disabled with explanation banner.

### Prompt-design principle

Real partner names and companies are passed to the synthesis LLM, alongside an explicit `weight` integer. The synthesis instructions tell the model to weight contributions proportionally. Faculty controls the weights via the admin UI; the LLM does not infer importance from brand recognition alone. No automated write-back to `careerTargets` or `subCompetencies` exists in v1 — faculty is the gate for every change that hits real career targets.

## Operations

### Email — Resend

One env var: `RESEND_API_KEY`. Resend free tier (~3k emails/month) covers hundreds of partners plus occasional resends. Templates live in `lib/email/templates/` as React Email components. Three templates for v1:

- `partner-invite` — sent on CSV import
- `partner-reminder` — faculty-triggered ad-hoc resend
- `synthesis-weekly-digest` — *deferred to v1.1*

### Cost guards

Reuse the existing `daily_cost` table. Synthesis costs increment the same counter as curriculum-tool prototype runs (single budget across both surfaces). Daily cap env var: `AI_DAILY_CAP_USD_CENTS`. When exceeded, the re-run synthesis button is disabled with a clear explanation; partner-facing flows are unaffected (they don't call the LLM at submit time).

### Abuse prevention

- 32-char URL-safe random tokens, cryptographic RNG, never logged.
- Per-partner rate limits (50 submission writes/day, 200 rating writes/day).
- Deactivation immediately invalidates token and active sessions.
- No raw IP storage for partners (they're identified by token, not anonymous).

### Testing

Mirror existing `vitest` setup. Coverage:

- **Unit:** synthesis prompt builder, Zod schema validation, weighted-average aggregation, CSV parser, magic-token generation.
- **Integration:** CSV import end-to-end (mocked Resend), magic-link auth flow, draft → submit state transition, project rating upsert.
- **E2E (one happy path):** seeded test token → welcome → submit a position → rate two projects → check synthesis dashboard shows them.

## Build sequencing

This is a chunky build. Each step is independently shippable to a small pilot group:

1. **Partner table + CSV import + invite email** — admin can invite partners; partners receive emails. No partner UI yet.
2. **Magic-link auth + partner dashboard shell** — partners can click through, see welcome page and empty dashboard.
3. **Submission flow A (draft + submit)** — partners can describe positions; drafts persist.
4. **Admin partners page + submissions firehose** — faculty can see who submitted what.
5. **Project rating flow B** — partners can rate projects; ratings persist.
6. **Synthesis pipeline + per-target page** — AI synthesis live; faculty can read insights and proposed diffs.
7. **Project ratings heat map** — final admin view; weighted aggregation visualized.

A pilot with 5–10 partners can run after step 3. The full hundreds-of-partners launch should wait until step 6 so synthesis is available when raw volume becomes hard to read.

## Deferred to v2+

- Karpathy-wiki cross-target synthesis (themes across all targets at once).
- Auto-write-back of accepted KUD diffs into curriculum tool tables.
- Per-submission AI condensation at submit time.
- Weekly digest email to faculty.
- Partner self-service profile editing.
- Multi-language support.
- Tournament-style or multi-axis project ranking (current v1 is single-axis 1–5 relevance).
