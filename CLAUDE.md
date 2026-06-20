# GC Curriculum Tool — Session Bootstrap

Orientation for Claude Code sessions on this repo. **Read [`docs/STATE.md`](./docs/STATE.md) before any feature work, schema change, AI function add, deployment change, or new spec/plan.** For trivial fixes (typos, copy edits, single-line bugfixes, internal refactors) skip the ritual and just work.

---

## What this is

A curriculum-design and analysis tool for the Clemson Department of Graphic Communications. It serves as the living record of the GC department's curriculum — what it is, what it is becoming, and how well it builds toward defined career destinations. Two questions drive everything:

> **Q1.** How well does the GC curriculum build students toward the careers we claim to prepare them for?
>
> **Q2.** For any individual course, do the prerequisites students walk in with actually support what the course expects?

Vision in full: [`docs/superpowers/vision/gc-curriculum-tool-vision.html`](./docs/superpowers/vision/gc-curriculum-tool-vision.html). Today's deployment state and what's next: [`docs/STATE.md`](./docs/STATE.md).

---

## Framework — KUD+ at a glance

Every coverage judgment in the tool factors into three categories, each scored 0–5 on a depth scale anchored to student-side evidence (not syllabus aspiration):

- **Know (K)** — recall and identification of content. Probe: "What is X?" / "Name X." / "Which of these is X?"
- **Understand (U)** — reasoning about the why. Probe: "Why does X work?" / "What follows from X?" / "When would you use X vs. Y?"
- **Do (D)** — behavioral output. Probe: "Make X. Produce X. Demonstrate X."

**Depth scale (same shape per dimension):**

```
0  Not present
1  Exposure / restates the explanation / performs with direction
2  Recognize / explains in own words / performs with reference
3  Recall / predicts consequences / performs independently in familiar conditions
4  Use correct terminology / reasons through novel cases / adapts to new conditions
5  Fluent + edge cases / critiques + extends / performs creatively, guides others
```

Authoritative rubric: `lib/ai/prompts/shared/depth-scale.md` (every scoring prompt includes it).

**Three load-bearing rules:**

1. **Evidence-above-zero.** Any K, U, or D score above 1 (above 0 for U and D) requires evidence of student attainment — assessment items for K, student-produced reasoning for U, graded artifacts for D. Aspirational syllabus verbs do not by themselves justify a score above U1 or D0.
2. **Foundational competencies (Agency, Attention to Detail, Resilience, Curiosity, Communication) score on D only.** K and U are stored as `null` (not zero) and hidden in the UI — zero would imply "the course tried to develop this and failed."
3. **Dissociation cases matter.** K-high/U-low = jargon without rationale. U-high/D-low = theory without craft. D-high/U-low = craft without articulation. K1-only with U0/D0 = mentioned in passing, never engaged. The depth scales make these visible; binary "covered/not covered" collapses them.

Academic background, theoretical justification, and the relationship to Bloom + Wiggins/McTighe: [`docs/background.html`](./docs/background.html). Why we don't use Bloom for curriculum mapping (it's the right tool for assessment design, wrong granularity for cross-program mapping): same doc.

**Problem-solving as program-level emergent property.** Problem-solving is not a transferable generic skill; it's the operation of well-organized domain knowledge under conditions that require deployment, developed through repeated cycles of productive failure × structured reflection × depth. Full research synthesis: [`docs/problem-solving-deep-dive.html`](./docs/problem-solving-deep-dive.html). The Phase 1B Scaffolding Analysis ([spec](./docs/superpowers/specs/2026-05-25-scaffolding-analysis-design.md)) operationalizes this at program scale.

**3-Act program structure** (proposed, not institutional policy): Act 1 Foundations & Agency → Act 2 Integration & Mastery (the mid-Junior "aha" moment, GC 4400 / GC 4060) → Act 3 Specialty & Application. Used as analytical waypoints in scaffolding diagnostics. Research synthesis: [`docs/three-act-deep-dive.html`](./docs/three-act-deep-dive.html).

---

## Architecture (the one-paragraph version)

Next.js 15 (App Router, Turbopack) + TypeScript strict + Drizzle on local Postgres 17 (`127.0.0.1:5433`) + Tailwind + shadcn + Vitest. **Local-only deployment** (Vercel + Neon + Resend retired 2026-06-04): a single Mac runs the whole app, bound `0.0.0.0:3000`, exposed to the internet via a Tailscale Funnel (HTTPS) and on the Clemson LAN over HTTP. Faculty surfaces (`/capture`, `/explore`, `/program`, `/admin`, `/settings`, `/wiki`, `/ask`, `/courses`) are gated by HTTP Basic Auth through middleware; the partner-facing `/partners/*` magic-link survey plus the public read-only `/` and `/view/*` are open (`PUBLIC_PREFIXES`). The LLM provider is selected by `AI_PROVIDER` (`openai` | `anthropic` | `local` omlx/Qwen3.6 | `campus` Qwen) — currently `openai`; embeddings always use the campus Qwen endpoint; Docling does PDF extraction. The OpenAI strict-schema discipline applies whenever `AI_PROVIDER=openai`. (The legacy `/preview/*` M-trial surface was removed 2026-06-02.) Setup: [`docs/superpowers/running-locally.md`](./docs/superpowers/running-locally.md). Full current-state inventory: [`docs/STATE.md`](./docs/STATE.md).

---

## Doc map

- [`docs/STATE.md`](./docs/STATE.md) — **read first for any non-trivial work.** What's live, current arc, what's blocked, what to update on commit.
- [`docs/superpowers/README.md`](./docs/superpowers/README.md) — full doc index: specs, plans, pilot writeups.
- [`docs/superpowers/vision/`](./docs/superpowers/vision/) — vision document.
- [`docs/superpowers/specs/`](./docs/superpowers/specs/) — design documents (architectural rationale, decisions before implementation).
- [`docs/superpowers/plans/`](./docs/superpowers/plans/) — TDD-style implementation plans, one per increment.
- [`docs/superpowers/pilot/`](./docs/superpowers/pilot/) — milestone writeups and interactive previews.
- [`docs/superpowers/running-locally.md`](./docs/superpowers/running-locally.md) — local Mac setup.
- [`docs/background.html`](./docs/background.html) — KUD+ academic companion.
- [`docs/problem-solving-deep-dive.html`](./docs/problem-solving-deep-dive.html) — problem-solving research synthesis.
- [`docs/three-act-deep-dive.html`](./docs/three-act-deep-dive.html) — 3-Act structure research synthesis.
- [`docs/graduate-outcome-validation.html`](./docs/graduate-outcome-validation.html) — Graduate Outcome Criterion-Relevance Study: proposed external-alignment check against 268 GC graduates' destinations, with pre-committed failure criteria (retitled from "Validation" 2026-06-12 — the design establishes criterion relevance, not attainment or causal impact).
- [`docs/using-coursecapture-and-explore.html`](./docs/using-coursecapture-and-explore.html) — faculty-facing walkthrough (linked from in-app headers).
- [`gc-curriculum-tool-spec.md`](./gc-curriculum-tool-spec.md) — original source spec (May 2026; **architecturally superseded** — see its top banner for what replaced each piece).

**Doc format convention:** published docs in `docs/*.html` are authored **directly as HTML** — single source of truth, **no `.md` twins**. The problem-solving and 3-Act deep-dives used to be maintained as `.md` + hand-exported `.html` pairs; they drifted, so they were consolidated to HTML-only (2026-06-14). Edit the `.html` directly; do **not** reintroduce a `.md` copy of a published doc (that just recreates the drift). Markdown stays the format for repo-internal docs (`STATE.md`, `superpowers/specs|plans/*.md`, `README.md`), which have no HTML twin.

---

## CodeGraph (project-specific notes)

This project has CodeGraph initialized (`.codegraph/`, ~301 indexed files, TypeScript-heavy). Inherit the global CodeGraph protocol from `~/.claude/CLAUDE.md`:

- **Structural questions** (where is X defined, what calls X, signatures, what would break if I change X) → `codegraph_*` tools. Reads are sub-millisecond and grep-equivalent answers cost an order of magnitude more.
- **Literal-text queries** (string contents, log messages, comments) → grep is fine.
- For "how does X work" or unfamiliar-area onboarding: **`codegraph_context` first**, then a single `codegraph_explore` for source if needed. Don't delegate exploration to a subagent — that re-does the work codegraph already has.
- File-watcher debounces ~500ms behind writes. Run `codegraph sync` if you've just edited and immediately want to query. (`codegraph status` shows index health.)
- If `.codegraph/` is missing (fresh clone), ask before running `codegraph init -i`.

---

## Pre-implementation ritual

For features, schema changes, AI function adds, deployment changes, new specs/plans:

1. **Read [`docs/STATE.md`](./docs/STATE.md)** — the volatile snapshot.
2. **`codegraph_context`** on the surface you're touching. Hand it the task description, not a symbol name.
3. **If you're creating something new** (a feature, a component, a meaningful behavior change), use `superpowers:brainstorming` first to align on intent.
4. **If it's a multi-step build**, use `superpowers:writing-plans` to produce a dated plan in `docs/superpowers/plans/`, then execute via `superpowers:subagent-driven-development`.
5. Spec/plan files are append-only history — never edit an existing one; write a new one that supersedes.

For trivial fixes (typos, copy edits, single-line bugfixes, internal refactors that don't change anything tracked by STATE.md), skip the ritual.

---

## Update protocol — keeping STATE.md honest

If your commit touches **routes, schema, AI function IDs, env vars, deployment surface, plan/spec status, or "What's live"** — update [`docs/STATE.md`](./docs/STATE.md) in the same commit. The list of triggers is canonicalized at the bottom of STATE.md under "What this file tracks." A non-blocking `pre-commit` hook (`.githooks/`, self-installs via `pnpm install`) nags when you change one of those diff-shaped surfaces without staging STATE.md.

**Decisions aren't diffs.** The hook and the trigger list catch *changes* (a new route, a schema edit) because those leave a diff. They are blind to the highest-loss category: a decision to **defer / hold / skip / not-fix** something, which leaves no diff at all. Whenever you consciously choose not to do something, write it into STATE.md **Deferred / debt** in that same commit — a review/audit report counts only as the backing detail; the one-line pointer in Deferred/debt is what a maintainer actually finds. (`Deferred work / debt` is now an explicit trigger in STATE.md.)

For a periodic full reconciliation (e.g., after a sprint or a stretch of merges), run **`/refresh-state`**. It walks git log since the last-verified hash, re-derives what's live from the repo, and rewrites STATE.md.

Trivial commits do not update STATE.md.

### Session-end reconciliation ritual

The pre-implementation ritual guards the *start* of work; this guards the *end*, when context is freshest and most about to be lost. Before wrapping any substantive session (and before a long task ends or context compacts), sweep:

1. **Decisions / deferrals** — did you defer, hold, skip, or choose-A-over-B anything? → STATE.md **Deferred / debt** (the no-diff category; nothing else will catch it).
2. **Tracked surfaces** — did any route / schema / migration / AI function / env var / deployment surface / "What's live" change land without its STATE.md update? → reconcile now.
3. **In-flight state** — if work is mid-stream or on an unmerged branch, is the "what's done / what's next / what's blocked / actions needed" written somewhere durable (STATE.md, a committed report), not just in this conversation?
4. **Rationale worth keeping** — any "why we did it this way" that a future reader would need and can't reconstruct from the diff? → write it next to the change (spec, code comment, or Deferred/debt note).

This is a checklist, not automation — it works because it fires at the moment the threads are in hand, the way checklists prevent invisible-omission errors everywhere else.

---

## Operational notes

- **Port registry.** Check `~/.dev-ports.yaml` before binding any port. Docling-serve owns `5001` (registered). Register what you start, kill + remove when done. Never touch processes that aren't yours.
- **Subagent model defaults.** Default to Sonnet or Haiku for delegated tasks; use Opus only when real judgment is required. Make the cost/performance tradeoff explicit before every Agent dispatch.
- **Pushing to main.** When the user says "push", push. The safety-classifier prompt that sometimes blocks the first attempt is a rail, not a "maybe they don't want this" signal.
- **`.gitignore` anchoring.** Generic dir names (`coverage/`, `dist/`, `build/`) should be anchored with a leading slash unless you genuinely want them ignored at every depth. The unanchored `coverage/` once silently swallowed `app/api/program/coverage/`; the rule is now `/coverage/`. If files exist locally but `git status` is clean, run `git check-ignore -v <path>`.
- **OpenAI strict-mode JSON schemas.** OpenAI's strict structured-output validator requires every property in `properties` to be listed in `required`. Optional fields must be nullable union types (`type: ['string', 'null']`), NOT omitted from `required`. The Campus Qwen endpoint tolerates the absent-field form, so the bug is silent until `AI_PROVIDER` flips to `openai`. When changing provider or adding a new optional field to a strict schema: audit `required` vs. `properties` recursively (including `items` in arrays) — pattern documented in `lib/ai/agent/audit-response-schema.ts` and `lib/ai/analyze/capture-scores.ts`.
- **Typed Postgres bind parameters.** `CURRENT_DATE - ($1 * INTERVAL '1 day')` fails at runtime — the planner can't infer whether `$1` is `int`, `numeric`, etc. Use `MAKE_INTERVAL(days => $1::int)` for typed integer interval arithmetic. See `lib/rate-limit/daily-cap.ts:getDailyCostHistory`.
- **Docling xlsx output has base64 images inline.** Docling preserves embedded chart/logo images as `![](data:image/...;base64,...)` blobs that inflate token count 20–30× over actual content (a 522k-char "spreadsheet" can have only ~3k real words). The extractor passes `include_images=false` for xlsx MIME upstream; `compactSpreadsheetMarkdown` also strips `(data:image/...)` patterns as defense-in-depth. See `lib/courses/material-extractor.ts:DoclingExtractor.extract` and `lib/capture/spreadsheet-compact.ts:stripInlineBase64Images`.

---

## Skills + memory

- **Superpowers skills** at `~/.claude/skills/superpowers/*` cover brainstorming, writing plans, executing plans, debugging, TDD, code review, etc. The system reminder at session start lists the full set. Use the relevant skill rather than freelancing the process.
- **Auto memory** at `~/.claude/projects/-Users-admin-projects-curriculum-developer/memory/` — used for **feedback** (how the user wants to collaborate), **user** (role / perspective), and **reference** (pointers to external systems) types only. **Project state is NOT in memory** — it lives in [`docs/STATE.md`](./docs/STATE.md). If you find yourself about to save a project-state memory, update STATE.md instead.
