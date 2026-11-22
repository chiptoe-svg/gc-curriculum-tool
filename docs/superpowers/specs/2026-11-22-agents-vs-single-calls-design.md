# Agents vs single calls for model work — design + benchmark (2026-11-22)

**Owner (2026-11-21):** "wondering if there is benefit to an agent being part of more of these model activities (instead of just an api call)"; scope "any and all — looking for the best results"; "proceed with agent design (with way to benchmark results)".

## Why
Today every model activity except the interview is one call: the model gets its inputs and answers once. It cannot look anything up and cannot check itself. Two measured problems point at that:
- **Scoring (Judge role):** the 2026-11-01 role benchmark kept scoring on OpenAI Sol because campus models broke the evidence rule (7 breaks vs 0 on 10 held-out courses) and over-scored by one level. A separate fact-check call cut breaks to 2 and also caught a borrowed-evidence score of Sol's (`scripts/bench/judge-factcheck.ts`). The scorer sees only the confirmed profile, never the course files.
- **Wiki pages (Write role):** the old problem-solving page carried a wrong count (10/8 vs 11/7) and stale target pages — errors a writer that can check its numbers would catch.

The interview already runs as an agent (Pi loop with search/cite controls) and that is what made Terra search reliably. The real constraint is the RCD gateway's shared OpenAI credit pool, so an agent that lets a **free campus model** match OpenAI quality is worth more than one that makes OpenAI slightly better.

## Goals
- Learn, per activity, whether an agent beats today's single call on quality, at what cost in calls, credits and time.
- Find any activity where a campus agent matches or beats the current OpenAI single call (moves work off the credit pool).
- Leave reusable benchmark harnesses so the next model or prompt change is measured the same way.

**Non-goals:** changing anything live in this phase; agents for extraction (already campus, works); multi-agent debate setups.
**Anti-goals:** a "win" that comes from the judge favoring longer or more confident output; any paid run without an estimate, the owner's yes and a hard credit ceiling; anything that writes to the live database.

## Approaches (per activity)
1. **Single call (today) — the baseline.**
2. **Tool agent:** the model gets tools and must use them before submitting: for scoring, `search_materials` / `fetch_material_section` (the interview's tools over the course files) and `check_quote` (code confirms a quote exists verbatim in the profile or a file and reports its kind: assessment item, student reasoning, graded task); for wiki pages, a `read_snapshot_facts` tool returning the exact counts and lists the page states, and `check_page` (code compares every number and course list on the draft against those facts). Runs on the existing Pi loop (`lib/ai/agent/pi/`), with a cap on tool calls.
3. **Single call + checker:** the baseline answer, then a separate checker that never sees the answer's reasoning, gathers evidence itself with the same tools, and caps or flags (generalizes `judge-factcheck.ts`; code applies the cap, not the model).

**Recommendation:** test 2 and 3 against 1. Approach 3 is cheaper and keeps today's stable single-call scoring; approach 2 may matter more for campus models. Debate / multi-agent voting is left out: several times the calls for a gain no measurement here suggests.

## Benchmark (how results are judged)
Order: **scoring first, then wiki pages** (biggest measured gaps). Per activity, a harness in `scripts/bench/` extending the existing ones (`role-judge.ts`, `judge-factcheck.ts`, `role-write.ts`): bench DB copy only (`gc_curriculum_bench`), never writes live, no OpenAI key in campus runs.

**Arms:** {single, tool agent, single + checker} × {campus model, Terra}. Campus model = the best campus scorer from 2026-11-01 (DeepSeek Flash low) plus Qwen3.8 as a second. **Campus arms run first (free).** Terra arms only for activities where a campus arm comes within reach, each with a probe, an estimate, the owner's yes and `--max-credits`.

**Cases:** scoring — the 10 held-out courses from the 2026-11-01 run (frozen set), all their stored competencies, 3 runs per arm (stability). Wiki — the 14 pages from the 2026-11-19 review plus the problem-solving page.

**Measures (scoring):**
- *Evidence-rule breaks* (code-checked: a score above the floor with no grounded quote of the right kind) — primary.
- *Grounding:* share of evidence quotes found verbatim in the profile or files.
- *Stability:* band agreement across the 3 runs.
- *Blind quality:* Claude Opus, pairwise and blind (A/B randomized per case, key held by the controller), judges each cell against the course files and profile using the depth scale — not against Sol, which is a reference, not truth. A second blind judge on a 20% sample to check agreement.
- *Cost:* calls, tokens, credits (from `lib/ai/prices.ts`), seconds per course.

**Measures (wiki):** factual errors found by code against the snapshot (counts, course lists, stale targets) — primary; blind Opus pairwise preference against the snapshot; lint errors; cost.

**Pre-committed decision rule** (written before any run): an agent arm is adopted for an activity only if it has **fewer evidence-rule breaks (or factual errors) than the current live setup AND is not worse in blind review** (Opus preference ≥ 50% excluding ties), with stability no lower than the baseline's. A campus arm that meets the rule against live Terra/Sol is the strongest outcome (moves the activity off the credit pool). Results go in `docs/benchmarks/` as before.

## Left to the builder
Harness structure, how tools are exposed to the campus endpoint (Pi already speaks to it), the exact tool-call cap (start at 6), and the report format — following the existing bench scripts.

## Order of work
1. Scoring harness + campus arms + blind review → report to the owner.
2. Wiki harness + campus arms → report.
3. Terra arms where warranted (owner's yes each time).
4. Only then: a design for turning a winning arm on live.
