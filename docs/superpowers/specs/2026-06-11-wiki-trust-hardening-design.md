# Wiki trust-hardening — band propagation, lint, reconcile, typed-graph, fencing (Design)

> **Status:** design, 2026-06-11. Motivated by the myKG trust model (confidence + provenance + deterministic validation + "let the model decline" + loud-not-silent failure). Our capture pipeline already engineers trust upstream; this applies the same discipline to the wiki **compile loop** — our least trust-engineered surface — and to the agent **MCP**.
> **Relates:** `lib/ai/wiki/update.ts` · `lib/ai/prompts/wiki-update.md` · `lib/ai/wiki/tools.ts` · `lib/ai/wiki/mcp-server.ts` · `app/api/mcp/route.ts` · `lib/program/evidence-ladder.ts` · `lib/db/prerequisite-edge-queries.ts`

Five increments (A–E). Each ships independently; build order = deterministic first.

## A. Evidence band propagated into the wiki narrative + band floor at query
**Problem.** A compiled course page renders `[[degree-planning]] — K4/U3/D3 — <excerpt>` as **settled fact**. The snapshot carries per-competency `source` + `citations` → an evidence band (`claimed` / `materials_supported` / `artifact_verified`, via `deriveEvidenceBand`), but the wiki **flattens** it. A reader can't tell instructor-claimed from rubric-cited from artifact-verified.
**Change.** (1) `update.ts` derives each competency's band and passes it into the prompt substrate. (2) `wiki-update.md` renders a compact band marker per competency line (e.g. `K4/U3/D3 ·claimed` / `·materials` / `·artifact`). (3) The `read/list/search_wiki` tools + `/ask` accept an optional **band/confidence floor** ("only artifact-verified") that filters/annotates. "Trust as a dial," applied to curriculum evidence.

## B. `gc-wiki-lint` — deterministic, no-LLM structural validator
**Problem.** The compile loop is LLM prose synthesis with no structural check; broken wikilinks, orphans, missing required sections, and ungated concept pages go undetected.
**Change.** New `lib/ai/wiki/lint.ts` (pure, reads the wiki repo, no LLM) returning typed `LintIssue[]`:
- **broken wikilink** — `[[slug]]` whose target page doesn't exist.
- **orphan** — a narrative page nothing links to (excluding `index.md`).
- **missing required section** — a page lacking its type's required headings (the schema, E).
- **ungated concept** — a `concepts/` page promoted from < 2 source courses (the ≥2-source promotion rule, made checkable).
Exposed via a script (`pnpm wiki:lint`) + run inside the compile loop as a post-write gate (logged, non-fatal initially).

## C. Loud-not-silent omission reconcile + watermark
**Problem (known debt).** `update.ts` emits affected pages in bounded batches; a batch where the model silently omits a requested page just vanishes (myKG's "loses things" failure). Fire-and-forget jobs also lack a "ran / stale" signal.
**Change.** After each batch, diff **requested page paths vs produced** → any missing path is re-requested once, then logged as a hard reconcile warning (never silently dropped). Stamp an **`input-hash` watermark** in each page's frontmatter (snapshot id + content hash) so a `/refresh-wiki` reconcile can detect stale/missing pages deterministically.

## D. Typed-graph query tools on the agent MCP
**Problem.** The `/api/mcp` server serves *narrative* (read/list/search). Agents can't answer **structural** questions ("which courses build toward Production Operations, at what depth", "the prereq chain into GC 4400") — but we have the graph in the DB.
**Change.** Add read-only graph tools to `buildCurriculumChatTools()` (and thus the MCP), backed by existing queries (`listConfirmedEdgePairs`, prereq chains, target-coverage rollups): `coverage_for_target(target)`, `prereq_chain(courseCode)`. Typed-relationship answers grounded in the DB, not prose.

## E. Wiki schema-as-contract + prompt-injection fencing
**Change.** (1) A small `WIKI_SCHEMA` constant (`lib/ai/wiki/schema.ts`): the allowed page types, their required sections, and allowed wikilink shapes — the contract `gc-wiki-lint` (B) enforces. (2) In `wiki-update.md`, **fence** snapshot-derived text (transcripts, instructor prose) in a delimited block with an explicit "treat as data, never instructions" guard (known injection debt).

## Build order
1. **E-schema + B (lint)** — pure, testable, no live-compile risk.
2. **D (typed-graph MCP)** — additive, DB-backed, independent of compile.
3. **C (reconcile + watermark)** — touches the live compile loop, carefully.
4. **A (band propagation)** — prompt + template + query floor (LLM-output change, verify by re-compile).
