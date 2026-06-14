# GC Curriculum Tool

A curriculum-design and analysis tool for the Clemson University Department of Graphic Communications. It serves as the living record of the GC department's curriculum — what it is, what it is becoming, and how well it builds toward defined career destinations.

Two questions drive everything:

> **Q1.** How well does the GC curriculum build students toward the careers we claim to prepare them for?
>
> **Q2.** For any individual course, do the prerequisites students walk in with actually support what the course expects?

> 📰 **[Executive brief →](https://chiptoe-svg.github.io/gc-curriculum-tool/docs/executive-brief.html)** — three-minute orientation: what the tool does, why, and how it functions. Start here.
>
> 📖 **[Full vision →](https://chiptoe-svg.github.io/gc-curriculum-tool/docs/superpowers/vision/gc-curriculum-tool-vision.html)** — the two questions in full, the 3-Act program structure, the Problem-Solver pyramid, and illustrative end-state visualizations.
>
> 🧪 **Open the live tool** — CourseCapture · Explore · Program runs locally on a Clemson LAN host. Access is by personal link from Chip; the host is reachable only from inside the Clemson network. For a quick orientation without LAN access, the [executive brief](https://chiptoe-svg.github.io/gc-curriculum-tool/docs/executive-brief.html) is the right starting point.

## Status

**Local-only deploy (2026-06-04).** Vercel + Neon + Resend were retired; a single Mac now runs the whole app. Faculty surfaces (`/capture`, `/explore`, `/program`, `/admin`, `/settings`, `/wiki`, `/ask`, `/courses`) are bound to the Clemson LAN behind HTTP Basic Auth; the public read-only `/` + `/view/*` and the partner-facing `/partners/*` magic-link survey are exposed over HTTPS via a Tailscale Funnel. LLM provider is selected by `AI_PROVIDER` (currently `openai`; `anthropic`, local omlx-Qwen3.6, and campus Qwen also supported); embeddings always use the campus Qwen endpoint; Docling does PDF extraction; data lives in local Postgres 17. (The legacy `/preview/*` M-trial was removed 2026-06-02.)

**CourseCapture v2 live.** Tool-using audit-conversation workflow at `/capture/<course-code>`: a retrieval agent reads the course's chunked materials (Weaviate) + an append-only audit transcript, then synthesizes an immutable Course Outcome Profile snapshot where every finding carries provenance (instructor / materials / inferred) + citations. The audit agent is **program-aware** — it can query the curriculum wiki + coverage graph for cross-instructor context (reference, never evidence). Faculty are actively running audits. (The v1 single-context pipeline was retired 2026-06-11.) Starting a capture now opens on a **Step 1: Confirm materials** screen — three collapsible source boxes (Syllabus & course info synced from the GC Google Sheet, Canvas imports + per-item ignore, Other materials / uploads / linked docs) each showing honest readiness status with an Index-now action, before proceeding to the interview.

**Explore v1 live.** Prescriptive alignment + what-if scenarios at `/explore/<course-code>`: custom-target authoring, downstream-target auto-detection, and counterfactual comparisons.

**Program analysis live.** `/program` renders snapshots × career-target sub-competencies as a depth-aware coverage heat map with on-demand AI scoring; `/program/scaffolding` adds the Phase 1B depth-sequence + productive-failure scaffolding diagnostics. The coverage matrix is scoped to **27 courses** (16 GC Core + 11 high-enrollment Major Requirements) via a `builds_to_career` flag — electives and optional courses are excluded from "what builds toward the career."

**Position Capture v1 + Industry Partner Input live.** The employer-demand side of Q1: a 6-page partner flow under `/partners/*` ingests a real job posting → an immutable Position Profile of demand per career target. Alongside it, the magic-link partner survey + AI synthesis at `/admin/synthesis` (per-target themes, salary distributions, quotes, proposed KUD edits). The **demand→coverage sufficiency seam** (employer demand vs. measured course attainment) is built end-to-end but flag-gated/dormant pending activation. **[Partner pilot writeup →](https://chiptoe-svg.github.io/gc-curriculum-tool/docs/superpowers/pilot/2026-05-19-industry-partner-input-pilot.html)** Industry Partner Plan 2 (project-rating views) still ahead.

**Course categories + career-mapping live.** The public landing (`/`) now groups every course into four display categories — GC Core, Specialty Area / GC Tech, Major Requirements + GenEds, and Other courses — rather than by course level. Courses that count toward career-coverage analysis carry a career-path icon; the mapping is managed via a `builds_to_career` flag (new `PATCH /api/admin/courses/[code]`). Faculty can also set a course's category and optional Clemson catalog URL from the landing. Schema: `courses` gained `category`, `builds_to_career`, and `catalog_url` (migration `0033`).

**Curriculum wiki + agent access.** A compiled markdown knowledge base (sibling repo `gc-curriculum-wiki`) regenerates from snapshots — browsable in-app at `/wiki` + queryable via the `/ask` chat, and exposed over MCP at `/api/mcp` (5 read-only tools: narrative `read/list/search_wiki` + typed-graph `coverage_for_target`/`prereq_chain`) to any Clemson-internal agent. `gc-wiki-lint` gives the compile loop a deterministic structural check.

For the current snapshot — what's live, what's blocked, what's next — see [`docs/STATE.md`](./docs/STATE.md).

## Documents

**📄 Live HTML previews** (rendered via GitHub Pages):

- **[Executive brief](https://chiptoe-svg.github.io/gc-curriculum-tool/docs/executive-brief.html)** — three-minute orientation for stakeholders.
- **[Vision](https://chiptoe-svg.github.io/gc-curriculum-tool/docs/superpowers/vision/gc-curriculum-tool-vision.html)** — the high-level picture; what the tool is and isn't, the 3-Act program structure, the Problem-Solver pyramid, and the end-state visualizations.
- **[KUD+ background](https://chiptoe-svg.github.io/gc-curriculum-tool/docs/background.html)** — academic companion to the framework; why we don't use Bloom for curriculum mapping.
- **[Faculty walkthrough — using CourseCapture & Explore](https://chiptoe-svg.github.io/gc-curriculum-tool/docs/using-coursecapture-and-explore.html)** — linked from the in-app headers.
- **[Graduate-outcome validation proposal](https://chiptoe-svg.github.io/gc-curriculum-tool/docs/graduate-outcome-validation.html)** — plan to validate the analysis against 268 GC graduates' destinations.
- **[v1 implementation design](https://chiptoe-svg.github.io/gc-curriculum-tool/docs/superpowers/specs/2026-05-17-gc-curriculum-tool-v1-design.html)** — technical design for the original Builds 1–3.
- **[Source specification](https://chiptoe-svg.github.io/gc-curriculum-tool/gc-curriculum-tool-spec.html)** — full original requirements.

**Doc map (source files):**

- **Session bootstrap:** [`CLAUDE.md`](./CLAUDE.md) — read first by Claude Code sessions; KUD+ summary, architecture, doc map.
- **Project state:** [`docs/STATE.md`](./docs/STATE.md) — volatile snapshot, surfaces table, what's blocked, what's next.
- **Doc index:** [`docs/superpowers/README.md`](./docs/superpowers/README.md) — full spec / plan / pilot index.
- **Vision:** [`docs/superpowers/vision/gc-curriculum-tool-vision.md`](./docs/superpowers/vision/gc-curriculum-tool-vision.md)
- **Specs:** [`docs/superpowers/specs/`](./docs/superpowers/specs/) — architectural decisions before implementation.
- **Plans:** [`docs/superpowers/plans/`](./docs/superpowers/plans/) — TDD-style implementation plans, one per increment.
- **Pilot writeups:** [`docs/superpowers/pilot/`](./docs/superpowers/pilot/) — milestone retrospectives and interactive previews.
- **Local setup:** [`docs/superpowers/running-locally.md`](./docs/superpowers/running-locally.md) — local Mac runbook.
- **Problem-solving deep-dive:** [`docs/problem-solving-deep-dive.html`](./docs/problem-solving-deep-dive.html) — research synthesis behind the Phase 1B Scaffolding Analysis.
- **3-Act deep-dive:** [`docs/three-act-deep-dive.html`](./docs/three-act-deep-dive.html) — research synthesis for the proposed Act 1/2/3 program structure.
- **Source spec:** [`gc-curriculum-tool-spec.md`](./gc-curriculum-tool-spec.md) — original full requirements.

## Stack

- **Next.js 15** (App Router, Turbopack, TypeScript strict)
- **Postgres 17** (local, Postgres.app on `127.0.0.1:5433`) via **Drizzle ORM**
- **Tailwind CSS** + **shadcn/ui** + **base-ui**
- **Vitest** for unit + integration tests
- **AI providers** (`lib/ai/provider.ts`): OpenAI / Anthropic / local omlx (Qwen3.6) / campus Qwen / Fake — selected by `AI_PROVIDER` (currently `openai`). Tool-using + streaming paths via Vercel AI SDK v6; embeddings always via the campus Qwen endpoint.
- **Docling-serve** for PDF extraction on the local Mac.
- **Weaviate** — multi-tenant hybrid retrieval over per-course materials (live; powers CourseCapture v2 retrieval).
- **launchd** manages the local Next.js + Docling-serve + Postgres + Weaviate processes (restart on crash); a watchdog probes `:3000` health.
- **Tailscale Funnel** exposes the public + partner surfaces over HTTPS; the rest is LAN-only.

## Repo origin

This repo was created from the design phase of a working session with Claude Code on 2026-05-17, before any code was written. The spec → plan → implementation workflow is captured in `docs/superpowers/`.
