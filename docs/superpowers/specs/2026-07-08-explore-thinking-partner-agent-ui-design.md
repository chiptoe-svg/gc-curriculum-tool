# Explore — Thinking-Partner Agent + Chat UI (Plan 2)

**Date:** 2026-07-08
**Status:** Design approved (brainstorm) — implementation plan not yet written.
**Parent design:** [`2026-07-07-explore-thinking-partner-design.md`](./2026-07-07-explore-thinking-partner-design.md) settled the *intent* (co-thinker identity, grounding, impact tool, save/compare, retirement). This spec is **Plan 2** — the user-facing agent + chat UI + retirement of the old machinery. It builds on the merged Plan-1 domain core (`lib/ai/explore/*`, `course_explore_scenarios`) and unblocks #188 (adopt).

---

## What this is

The capstone of the Explore rethink: replace the old custom-target/downstream/what-if machinery with a **course-anchored thinking-partner chat agent** that helps faculty reason about course changes — grounded in the real curriculum, with the Plan-1 impact engine available as a tool. After this lands, the new agent is the *whole* `/explore` experience.

## Chat UX model — chat + inline scenario cards

The agent chats in prose, but when its impact tool produces a `Scenario`, the UI renders a **structured card inline** in the conversation — keeping conversational primacy while giving the first-class `Scenario` a scannable home:

```
agent: Adding a graded trapping lab would develop your prepress
       competency and likely feed GC 4440. Here's my read —
 ┌─ Scenario · "trapping lab" ──────────────────────────┐
 │ CHANGE  graded lab · rubric: registration, separations│
 │ PREDICTED   prepress   D3 → 4   (medium)             │
 │             registration K2 → 3 (medium)             │
 │ RIPPLE  ↓ GC 4440 · trapping: gap → met              │
 │         → career Prepress Tech · Trapping: work→high  │
 │         ↑ new demand: color-models K3                 │
 │ [ Save ]  [ Compare ]  [ Adopt · soon ]              │
 └───────────────────────────────────────────────────────┘
       …though it'd squeeze the color-management weeks —
       worth checking against GC 3800.
```

The card is a scannable rendering of the `Scenario`; the agent's surrounding prose carries the richer wiki-grounded reasoning (displacement, coherence, what-to-check) the ledger can't.

## The agent

A **new sibling agent** `streamExploreAgent` (`lib/ai/explore/agent.ts`), mirroring `streamCurriculumChat`'s (`lib/ai/wiki/chat.ts`) streaming/tool-loop framework — a clean separation from the read-only Q&A agent rather than overloading it with a mode. Whether to extract a shared tool-loop runner vs. lightly duplicate the boilerplate is a plan-time call once it's in view.

**Reused grounding tools** — `read_wiki`/`search_wiki` (`buildCurriculumChatTools`), `search_curriculum` (the evidence spine — real assignments/rubrics), and the graph tools (`coverage_for_target`/`prereq_chain`, `buildCurriculumGraphTools`). The agent ranges over the wiki + real materials + typed graph.

**New explore tools:**
- `neighbor_context(courseCode)` — focal + up/downstream snapshots + incoming-expectations (the Plan-1 `assembleNeighborContext` + the DB-backed neighbor load in `run-impact.ts`).
- `estimate_impact(changeProse)` — runs Plan-1 `runImpact` → returns a `Scenario` (change-object + predicted deltas + computed ripple). Called when a concrete impact read sharpens the conversation; its result is what the UI renders as a card. Records cost (`runImpact` already carries telemetry via `estimateLocalDelta`).
- `save_scenario` / `list_scenarios` / `compare_scenarios` — over the Plan-1 repo (`explore-scenario-queries.ts`) + `compareScenarios`.

**System prompt** (`lib/ai/prompts/explore-agent.md`) — the course-change thinking partner: **co-thinker, not oracle**; both directions (*predict*: "here's my change" / *suggest*: "here's my goal → bounce ideas"); predictions held loosely and labeled hypotheses; grounded in neighbors + spine + wiki; the full loop (goal → ideas → tweak → gut-check impact → iterate) emerges in conversation. It reasons expansively but only the `estimate_impact` tool mints the quantitative deltas/ripple — the agent never states its own numbers as fact (the measured-vs-interpretive discipline from the parent spec).

**Route:** `/api/explore/[code]/chat` is **repurposed** to stream `streamExploreAgent` instead of `streamCurriculumChat` (keeps the focal-course anchor + rate-limit + slug-auth it already has).

## The UI

Extend `AskTab` (`components/AskTab.tsx`) into an **`ExploreChat`** surface (or a thin wrapper). It keeps the conversation + tool-trail disclosure it already has, and adds inline **scenario-card** rendering:

- The NDJSON stream carries the `Scenario` object on an `estimate_impact` tool result; a new `ScenarioCard` component renders it — change summary, predicted deltas (with confidence), the ripple ledger (`downstream_gap` / `upstream_gap` / `career_fit` lines), and affordances.
- **Save / Compare** are wired to the repo + `compareScenarios` (a compare renders as a two-scenario diff card).
- **Adopt** is the **#188 hook** — a disabled "soon" affordance in this plan; it's the exact slot where close-the-loop adopt lands. No orphaned machinery — just a visible placeholder.

`/explore/[code]/page.tsx` renders `ExploreChat` in place of the old `ExploreClient`.

## Retirement of the old machinery

- **Tables:** `pg_dump` `course_explore_targets` / `course_explore_analyses` / `course_explore_what_ifs` to a backup file (they are empty/near-empty — an early prototype barely used), then drop via migration.
- **Routes (7):** `draft-custom`, `downstream-candidates`, `build-downstream`, `analyze`, `what-if`, `targets`, `targets/[id]` under `/api/explore/[code]/`.
- **AI functions (3):** `explore-draft-target`, `explore-compare`, `explore-what-if` (+ their prompts; `explore-what-if` is already superseded by `explore-local-delta`). Deregister from `function-settings.ts`.
- **Client:** the 858-line `ExploreClient` (+ its now-orphaned types/imports).
- **Repurposed, NOT deleted:** the `chat` route (now streams the explore agent).

Grep to confirm nothing else imports the retired modules before dropping. Update `docs/STATE.md` (routes, AI function IDs, tables, "What's live").

## v1 scope

**In:** `streamExploreAgent` + its tools; the repurposed chat route; `ExploreChat` + `ScenarioCard` with Save/Compare wired; retirement of the old machinery.

**Out (deferred):**
- **Adopt** build — #188 (the card's "soon" placeholder is its hook).
- The persistent side panel and the program-level reconciliation view.
- #194 (ripple data-coverage refinements) — improves the impact tool's ripple but doesn't block the agent; lands independently.

## Sequencing + why now

Plan 2 is the surface that gives #188's adopt its home (the card) and makes scenarios visible enough for #194 to matter. It retires the last of the old Explore and makes the thinking-partner the whole `/explore` experience.

## Testing approach

- **Agent tools** — unit-test the new tool wrappers (`neighbor_context`, `estimate_impact`, `save/list/compare`) against injected fakes / the Plan-1 pure cores; the tool *contracts*, not live AI.
- **ScenarioCard** — component tests (renders deltas + ripple + affordances; Save/Compare fire the right calls; Adopt is disabled).
- **Agent behavior** — validated the way Plan 1's harness validated the engine: a small script driving `streamExploreAgent` over a real course, eyeballed for grounded, co-thinker-quality output (not a unit test).
- **Retirement** — a grep/compile gate that nothing imports the retired modules; full suite green.

## Open questions carried to the plan

- **Streaming protocol for the card.** How the `Scenario` object rides the existing NDJSON stream (a new event type vs. a tool-result payload the client already receives) — an implementation detail to settle against the current `AskTab` stream parser.
- **Shared tool-loop runner** vs. duplicating `streamCurriculumChat`'s boilerplate — decide once the boilerplate is in view; don't over-refactor working code.
- **Suggest-direction richness.** v1 keeps *suggest* conversational (agent proposes ideas, optionally impact-checks them). A structured ranked-candidate generator is out of scope (parent spec's deferred list).
