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
> 🧪 **[Legacy M-trial prototype →](https://gc-curriculum-tool.vercel.app/preview/4QcseN0pvlpd35gb)** — the public-accessible original three-tool slice (Course Builder · Prereq Analyzer · Career-Target Alignment). The active build (CourseCapture · Explore · Program) is faculty-internal on the Clemson LAN.

## Status

**Hybrid deploy shipped (Phase 2).** Same codebase, two runtime personalities. Faculty surfaces (`/capture`, `/explore`, `/program`, `/admin`, `/settings`) run on a local Mac on the Clemson LAN behind HTTP Basic Auth, using local omlx (Qwen3.6 family) for LLM calls and Docling for PDF extraction. Partner-facing surfaces (`/partners/*` magic-link survey, `/preview/*` legacy M-trial) run on Vercel against OpenAI. Same Neon Postgres backs both.

**CourseCapture v1 live.** Audit-conversation workflow at `/capture/<course-code>` that combines catalog values, Canvas imports, uploaded materials, linked Google Docs/Sheets/Slides + Drive PDFs, and voice/chat audit, then produces an immutable Course Outcome Profile snapshot. Faculty are actively running audits.

**Explore v1 live.** Prescriptive alignment + what-if scenarios at `/explore/<course-code>`: custom-target authoring, downstream-target auto-detection, and counterfactual comparisons.

**Program Coverage Matrix (Phase 1A) live.** `/program` renders snapshots × career-target sub-competencies as a depth-aware heat map with on-demand AI scoring.

**Industry Partner Input — Plans 1 + 3 shipped.** Magic-link survey for industry partners (CSV import, invites, draft/submit/delete flow) plus AI synthesis layer at `/admin/synthesis` that aggregates per-target themes, salary distributions, partner quotes, and proposed KUD edits. **[Pilot writeup →](https://chiptoe-svg.github.io/gc-curriculum-tool/docs/superpowers/pilot/2026-05-19-industry-partner-input-pilot.html)** Plan 2 (admin views + project ratings) still ahead.

**CourseCapture v2 Stage 1 (Foundation) shipped.** Append-only `capture_messages` log keyed by session, provider abstraction extended with `completeWithTools` across OpenAI / Anthropic / Local / Fake (Vercel AI SDK v6), and per-course `audit_mode` toggle. Stage 2 (Ingestion: per-material chunker + Weaviate-backed retrieval) waits on the local Weaviate instance.

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
- **Problem-solving deep-dive:** [`docs/problem-solving-deep-dive.md`](./docs/problem-solving-deep-dive.md) — research synthesis behind the Phase 1B Scaffolding Analysis.
- **3-Act deep-dive:** [`docs/three-act-deep-dive.md`](./docs/three-act-deep-dive.md) — research synthesis for the proposed Act 1/2/3 program structure.
- **Source spec:** [`gc-curriculum-tool-spec.md`](./gc-curriculum-tool-spec.md) — original full requirements.

## Stack

- **Next.js 15** (App Router, Turbopack, TypeScript strict)
- **Neon Postgres** via **Drizzle ORM**
- **Tailwind CSS** + **shadcn/ui** + **base-ui**
- **Vitest** for unit + integration tests
- **AI providers** (`lib/ai/provider.ts`): OpenAI / Anthropic / Local omlx / Fake — pick via env. Tool-using path via Vercel AI SDK v6 (`completeWithTools`).
- **Docling-serve** for PDF extraction on the local Mac (CPU mode); **unpdf** fallback on Vercel.
- **Weaviate** (planned, Stage 2) — multi-tenant hybrid retrieval over per-course materials.
- **launchd** manages the local Next.js + Docling-serve processes; restart on crash.
- **Vercel** hosts the partner / preview side.

## Repo origin

This repo was created from the design phase of a working session with Claude Code on 2026-05-17, before any code was written. The spec → plan → implementation workflow is captured in `docs/superpowers/`.
