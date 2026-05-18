# GC Curriculum Tool

A curriculum design tool for the Clemson University Department of Graphic Communications. It serves as the living record of the GC department's curriculum — what it currently is, what it is becoming, and how well it builds toward defined career targets.

## Status

**Pre-implementation.** This repository currently contains the source specification and the v1 implementation design. Code lands once M0 begins.

## Documents

**📄 Live HTML previews** (rendered via GitHub Pages):

- **[v1 Implementation Design](https://chiptoe-svg.github.io/gc-curriculum-tool/docs/superpowers/specs/2026-05-17-gc-curriculum-tool-v1-design.html)** — design for Builds 1–3 with sidebar navigation.
- **[Source Specification](https://chiptoe-svg.github.io/gc-curriculum-tool/gc-curriculum-tool-spec.html)** — full curriculum tool spec.

**Source files:**

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
