# Program memory for the CourseCapture audit agent (Design)

> **Status:** design, 2026-06-11. Roadmap item #5 ("cross-course memory / faculty profiles"), reframed during brainstorming to **cross-instructor program memory**.
> **Relates:** `lib/ai/agent/audit-tools.ts` · `lib/ai/agent/audit-agent.ts` · `lib/ai/agent/audit-agent-stream.ts` · `lib/ai/prompts/capture-chat-agent.md` · `lib/ai/wiki/tools.ts` · `lib/ai/wiki/graph-tools.ts`

## Problem

While auditing course X, the CourseCapture audit agent is **course-local**: `buildAuditTools(courseCode)` gives it only the per-course material retrieval tools (`list_materials` / `fetch_material_section` / `search_materials`, scoped to the course's Weaviate tenant) plus same-course prior-session continuity (`session-briefing`). It cannot see what the program already establishes about the competencies in play — who else covers them, at what depth, where they're introduced, what the prerequisite chain is. So it can't probe handoffs, can't avoid re-establishing what's settled elsewhere, and can't calibrate depth against the program.

## Key finding (brainstorming)

That program-wide picture **already exists and is queryable** — no new data, store, or migration is warranted:
- **Coverage matrix** (`snapshot_target_coverage`) — cross-instructor K/U/D per competency/target.
- **Compiled wiki** — competency/target pages *are* the across-courses aggregate.
- **Typed-graph tools** (`coverage_for_target`, `prereq_chain`) — structural queries over the matrix + `prerequisite_edges`.

The `/ask` + MCP agents already query these. The single gap is that the **capture audit agent doesn't have them.** So the feature is a *connection*, not a structure.

## Change

Add the four existing program-query tools to `buildAuditTools` (full audit mode only — `simple` mode keeps the empty toolset):
- `search_wiki`, `read_wiki` (from `lib/ai/wiki/tools.ts`) — narrative program memory.
- `coverage_for_target`, `prereq_chain` (`buildCurriculumGraphTools()` from `lib/ai/wiki/graph-tools.ts`) — structural program memory.

All four are **read-only** and **FERPA-safe**: the wiki tools exclude `raw/` (no snapshot JSON / transcripts / student data); the graph tools return aggregate K/U/D, not student work.

**Tool-call budget:** bump `maxToolCalls` from 2 → 4 (both the streaming and non-streaming agent paths) so a turn can query materials *and* program memory.

**Prompt discipline (load-bearing — `capture-chat-agent.md`):** a new "Program memory" section that (a) says WHEN to reach for these tools (probe a handoff, avoid re-establishing something the program settles elsewhere, calibrate a depth claim against the program picture, connect prerequisites), and (b) fences the binding rule, mirroring the intended-skills reference-only discipline:

> Program memory is **reference, never evidence.** "The program covers X in another course" is NOT evidence that *this* course's students can do X — it never raises a K/U/D score here. This course's scores come only from this course's own materials + transcript (the evidence-above-zero rule is unchanged). Use program memory to ask better questions, not to fill in attainment.

## Non-goals
- No new table / accumulated "memory" store (the matrix + wiki + graph are the source of truth).
- No per-faculty profile layer (this is program-wide / cross-instructor, not per-instructor).
- No change to the coverage matrix, wiki compile, or scoring.
- `list_wiki` is intentionally NOT added (enumerating all pages mid-audit is noise; search + read cover targeted lookup).

## Testing
- `audit-tools.test.ts`: assert the full-mode toolset now includes `search_wiki`, `read_wiki`, `coverage_for_target`, `prereq_chain` alongside the three material tools (and that `simple` mode stays empty).
- tsc + full suite green.

## Risks
- **Attainment laundering** — mitigated by the reference-only prompt fence (above); the deterministic scorer is unchanged and still requires this course's own evidence.
- **Latency/cost** — one or two extra read-only tool calls per turn in full mode; bounded by `maxToolCalls`. Acceptable; capture is not a hot path.
