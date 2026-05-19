# GC Curriculum Tool

A curriculum design tool for the Clemson University Department of Graphic Communications. It serves as the living record of the GC department's curriculum — what it currently is, what it is becoming, and how well it builds toward defined career targets.

> 📖 **[Read the vision →](https://chiptoe-svg.github.io/gc-curriculum-tool/docs/superpowers/vision/gc-curriculum-tool-vision.html)** — what the full tool will be, the two questions it answers, illustrative visualizations of the end state, and how today's prototype fits.
>
> 🧪 **[Try the prototype →](https://gc-curriculum-tool.vercel.app/preview/4QcseN0pvlpd35gb)** — runs real analysis on real GC courses pulled from the shared course sheet.

## Status

**M-trial live.** The faculty-facing prototype is deployed: course picker backed by the shared Google Sheet, AI-drafted KUD outcomes, coverage scoring against career targets, scaffolding evaluation, prerequisite-gap analysis, and per-judgment "Why?" expanders + flag-with-note. Phase 1 (program-wide views) starts after trial feedback settles.

**Industry Partner Input — Plan 1 shipped.** Magic-link survey is live behind the scenes: admin can CSV-import partners and send invites; partners land on a welcome screen, pick the closest career-target match, and submit a position description (draft + submit + delete). Plans 2 (admin views + project ratings) and 3 (AI synthesis layer) still ahead. **[Read the pilot writeup →](https://chiptoe-svg.github.io/gc-curriculum-tool/docs/superpowers/pilot/2026-05-19-industry-partner-input-pilot.html)**

## Documents

**📄 Live HTML previews** (rendered via GitHub Pages):

- **[Vision](https://chiptoe-svg.github.io/gc-curriculum-tool/docs/superpowers/vision/gc-curriculum-tool-vision.html)** ← the high-level picture; what the tool is and isn't, the 3-Act program structure, the Problem-Solver pyramid, and the end-state visualizations.
- **[v1 Implementation Design](https://chiptoe-svg.github.io/gc-curriculum-tool/docs/superpowers/specs/2026-05-17-gc-curriculum-tool-v1-design.html)** — technical design for Builds 1–3 with sidebar navigation.
- **[Source Specification](https://chiptoe-svg.github.io/gc-curriculum-tool/gc-curriculum-tool-spec.html)** — full curriculum tool spec.

**Source files:**

- **Vision:** [`docs/superpowers/vision/gc-curriculum-tool-vision.md`](./docs/superpowers/vision/gc-curriculum-tool-vision.md)
- **Source specification:** [`gc-curriculum-tool-spec.md`](./gc-curriculum-tool-spec.md) — full requirements (data model, all 7 builds, assessment framework, career target definitions).
- **v1 implementation design:** [`docs/superpowers/specs/2026-05-17-gc-curriculum-tool-v1-design.md`](./docs/superpowers/specs/2026-05-17-gc-curriculum-tool-v1-design.md) — design covering Builds 1–3 only.

## v1 Scope

Builds 1–3 from the source spec:

1. **Foundation** — career targets, sub-competencies, course identity records, basic navigation.
2. **Course Content** — KUD outcomes, projects, syllabus storage, AI-assisted drafting from syllabus.
3. **Coverage Analysis** — AI-evaluated coverage scores per (course × sub-competency) with visible reasoning, dispute mechanism, and heat map view.

Out of v1: Proposals, Curriculum Map, Sankey/Sequence visualizations, Resource Summary, Presentation View, Assessment Framework. Each gets its own design doc when ready.

## Stack (planned for v1)

- **Next.js 15** (App Router, TypeScript)
- **Postgres** via Neon
- **Drizzle ORM**
- **Tailwind CSS** + **shadcn/ui**
- **AI:** OpenAI default, Anthropic via provider abstraction
- **O\*NET Web Services API** for SOC-anchored career target seeding
- **Vercel** for hosting

See the v1 design doc for full architectural rationale.

## Repo origin

This repo was created from the design phase of a working session with Claude Code on 2026-05-17, before any code was written. The spec → design → implementation plan workflow is documented in `docs/superpowers/specs/`.
