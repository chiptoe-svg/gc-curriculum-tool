# Explore, rethought — a course-change thinking partner

**Date:** 2026-07-07
**Status:** Design approved (brainstorm) — implementation plan not yet written.
**Supersedes:** the current "Explore v1" (`/explore/[code]` custom-target / downstream / what-if machinery, live 2026-05-24). This is a re-grounding + rebuild, not a patch.

---

## Why revisit

Explore was built early (2026-05-24), before the tool crystallized around Q1/Q2 — before `/program` had the real career-target × competency coverage matrix, before `/program/scaffolding`, before Capture recorded `incoming_expectations` structurally, before the cross-course evidence spine, and before standalone `/ask`. As a result its three modes (custom-target authoring, downstream auto-detection, what-if) each shadow-overlap something newer and more load-bearing, on a **parallel data model** (`courseExploreTargets` / `courseExploreAnalyses` / `courseExploreWhatIfs`) separate from the canonical `career_targets` + coverage + prereq engines. Two concerns drove the revisit (operator, 2026-07-06):

1. **Right idea, underbuilt** — the *concept* of a per-course place to explore "how do I make this course better" is valuable but was never thought through.
2. **Implementation quality** — an 858-line client, 8 routes, 3 dedicated tables, a parallel target store.

## The reframe

**Capture = the snapshot** (what the course *is*, scored on student evidence). **Explore = the playground for making it *better*** (what it *could be*, and the predicted effects). The two never share scores: Explore traffics in **predicted, not-yet-evidenced** depth, which Capture forbids — so predictions live in a hypothetical layer, always labeled, and **never written back into the evidenced snapshot**. When a change is really implemented and produces student work, it re-enters through Capture the normal way.

## Identity — a thinking partner, not an oracle

The priority is **thought partner and idea-bouncer**, with upstream/downstream awareness and *good-enough* impact sense (explicitly "OK if not perfect"). Its honest value is **better reasoning about a change**, not accurate forecasting — success is "this made me reason better and caught something I'd have overlooked," not "the D3→D4 prediction was right" (unknowable in advance). Prediction is welcome but held loosely and worn on its sleeve, never dressed as measurement. Predicting attainment from a plan is the one thing the rest of the tool is most humble about; Explore honors that by being a *co-thinker* whose numbers are always "my rough read, worth checking."

## Form — one conversational agent, two directions

A **course-anchored chat agent** (the same agent framework behind `/ask` and curriculum-chat) whose whole job is helping a faculty member think through a change. Two conversational intents over one toolset:

- **Predict** — "here's my change, what happens?" (you bring the change → it reasons about implications).
- **Suggest** — "here's my goal, what should I do?" (you bring a goal → it bounces candidate changes, each optionally gut-checked with the impact tool).

These are not two pipelines — they are one agent pointed in two directions. The full loop (**goal → ideas → tweak → gut-check impact → iterate**) emerges in conversation. The change stays **conversational** — there is no mandatory "fill in a structured change form" front door; the agent pins down structure itself when it needs to estimate impact and checks it with you.

## What it knows — the upstream/downstream grounding

This is what makes it more than generic chat. The agent is handed, and can pull on demand:

- the **focal course's** snapshot — its competencies, KUD depths, and `incoming_expectations`;
- its **upstream/downstream neighbors** via the prereq edges (`prerequisite-edge-queries.ts`), plus those neighbors' snapshots and incoming-expectations;
- the **evidence spine** — the real assignments / rubrics / syllabi across all courses, already shipped and semantically searchable (the `program` Weaviate tenant + `search_curriculum` tool);
- the **wiki** narrative layer (`read_wiki` / `search_wiki`).

So when it says "that squeezes color management, which GC 3800 assumes students bring," it is reading GC 3800's actual materials, not guessing.

## How prediction fits — one optional tool, held loosely

When a concrete impact estimate would sharpen the conversation, the agent calls a light **impact tool**. Internally it:

1. pins down what the change touches (which competencies / rubric-bearing artifact) and checks that reading with the faculty member;
2. estimates a **local KUD delta** on the focal course (the one generative guess — small, assumption-explicit, confidence-marked, faculty-overridable);
3. builds a scenario = the real program inputs with the focal course's depths overridden by the predicted values, and re-runs the **existing** pure engines — `computeGapsFromInputs` (`prereq-gaps.ts`) for downstream/upstream gap flips and `getMatrixData` (`program-coverage-queries.ts`) for career-target fit — then diffs against baseline.

**Epistemic discipline (light, not heavy):** the crisp quantitative flips come from the deterministic engines on the predicted delta (traceable, no invented numbers); the agent's own richer reasoning (displacement/opportunity cost, redundancy, coherence, second-order and non-KUD effects, "what to check") is offered as *interpretation*, cited to sources, and never states the canonical depth/coverage numbers as fact. Most turns won't call the tool at all — it exists for when a number helps, not as the centerpiece. Honest caveats surfaced in-product: the estimate is only as good as the one predicted delta (hence overridable); the computed flips only see *known* prereq edges (so "along N known dependencies," never implying completeness).

## What it reuses vs. retires

**Reuses:** the curriculum-chat/agent framework + `AskTab`-style chat shell; `search_curriculum` (spine) + `read_wiki`/`search_wiki` (wiki) tools; `computeGapsFromInputs` / `computeSufficiency` / `getMatrixData` as the impact tool's compute layer; the prereq-edge graph.

**Retires:** the custom-target / downstream / what-if machinery — the 7 target/analysis routes under `/api/explore/[code]/*` (`draft-custom`, `downstream-candidates`, `build-downstream`, `analyze`, `what-if`, `targets`, `targets/[id]`), the 3 AI functions (`explore-draft-target`, `explore-compare`, `explore-what-if`), the 3 tables (`courseExploreTargets`, `courseExploreAnalyses`, `courseExploreWhatIfs`), and the 858-line `ExploreClient`. Net: less code, one clear job.

**Repurposes (not deletes):** the 8th route, `/api/explore/[code]/chat` (today the `?tab=ask` endpoint mounting `AskTab`), becomes the entry point for the new thinking-partner agent — its role is absorbed and specialized rather than retired.

## Thin-v1 scope

**In:** the course-anchored thinking-partner agent (both predict and suggest directions); upstream/downstream + spine + wiki grounding; the optional impact tool (local delta → reuse gap/coverage engines). New: a specialized system prompt + a small set of agent tools (a "neighbor context" tool over prereq edges + neighbor snapshots/incoming-expectations, and the "impact estimate" tool); the spine/wiki tools already exist. A new anchored chat surface at `/explore/[code]` replacing the old client.

**Out (deferred — genuinely structured features, not the conversational core):**
- saving / comparing **named** scenarios (v1 conversations are ephemeral, like `/ask`);
- a structured **diff UI** for scenario-vs-baseline;
- **AI edge-discovery** writing candidate prereq edges back into the graph (the agent may *mention* a missing dependency in prose; it does not yet mutate the edge store);
- a structured **suggest pipeline** (ranked candidate generation as a first-class artifact) beyond the conversational form.

## Open questions / risks (carry into the plan)

- **The center is the local-delta credibility.** Everything the impact tool says hangs off one estimate; the whole design quarantines that uncertainty into a single, inspectable, faculty-overridable number. If it reads as generic in practice, the impact tool is the weak point — but the *thinking-partner* value (grounded reasoning over real neighbor materials) stands independently of it.
- **Computed ripple is thin where edges are sparse.** Prereq edges are coarse/incomplete, so clean downstream gap-flips will be the minority of value; most ripple insight comes from the agent's wiki+spine reasoning. Emphasis is on the reasoning, with the computed flips as a small trustworthy anchor.
- **Framing must stay "co-thinker, not oracle"** in copy and UX so a what-if is never mistaken for a forecast.
- **Retirement migration:** dropping/deprecating the `courseExplore*` tables + routes needs a clean migration and a check that nothing else reads them.

## Success criteria

Faculty report it helped them reason better about a change and surfaced considerations they'd have missed, grounded in the actual materials of neighboring courses — *not* prediction accuracy. A qualitative "does this read as insightful and grounded" bar, tested on a handful of real proposed changes on real captured courses before investing in the deferred structured features.
