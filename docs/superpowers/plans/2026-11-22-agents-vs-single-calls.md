# Agents vs Single Calls — Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure, for scoring and then wiki pages, whether a tool-using agent or a single call plus an independent checker beats today's single call — campus models first — and report against a pre-committed decision rule.

**Architecture:** A generic Pi task loop (new, beside the live interview loop, which is not touched) runs any structured task with tools and a `submit` tool. Benchmark arms wrap today's production calls (single), the Pi task loop (agent), and a checker that gathers evidence itself while code applies the caps. Harness scripts under `scripts/bench/` run arms × models × cases × runs against the bench DB copy, compute code-checked measures, write blinded A/B pairs for a Claude Opus judge, and tally results.

**Tech Stack:** TypeScript (tsx), Pi (`@mariozechner/pi-*`, as in `lib/ai/agent/pi/turn.ts`), Drizzle/Postgres bench copy, Vitest, `lib/ai/prices.ts`.

**Spec:** `docs/superpowers/specs/2026-11-22-agents-vs-single-calls-design.md`

## Global Constraints

- Never write to the live database (`gc_curriculum`). Harnesses refuse any `DATABASE_URL` whose database name lacks `bench` or `scratch`; scores and wiki pages are never written anywhere but the harness output files; the wiki repo is read, never written.
- Campus arms run with no OpenAI key reachable (follow `role-judge.ts`: throw if `OPENAI_API_KEY` is set unless `--paid`). A paid (Terra) arm requires `--paid` **and** `--max-credits <n>`, computes credits with `costCredits` from `lib/ai/prices.ts` after every call, and stops at the ceiling. Paid arms are run only after the owner's yes for that run, starting with a one-case probe. Total ceiling for all Terra arms: **20 credits**.
- Batch by model: all runs of one model, then the next — never interleave models (shared cluster).
- Campus models: DeepSeek Flash low (`deepseek-v4.1-flash-1017:low`) and Qwen3.8 (`qwen3.8-27b-fp8`, reasoning off). Tool-call cap per agent task: **6**.
- Cases — scoring: the 10 held-out courses of the 2026-11-01 Judge run, all their stored competencies, **3 runs per arm**. Wiki: the 14 pages of the 2026-11-19 review plus the problem-solving page.
- Outputs to `~/.local/share/gc-curriculum-tool/agent-bench/<YYYY-MM-DD>-<activity>/`; results summarized in `docs/benchmarks/`.
- **Pre-committed decision rule (verbatim from the spec):** an agent arm is adopted for an activity only if it has **fewer evidence-rule breaks (or factual errors) than the current live setup AND is not worse in blind review** (Opus preference ≥ 50% excluding ties), with stability no lower than the baseline's.
- Blind review: A/B randomized per case with a seeded RNG; the key file is never shown to the judge; the judge compares against the course files and profile (scoring) or the snapshot (wiki), never against Sol as truth; a second blind judge on a 20% sample.
- US spelling; never print secrets (`node ~/.claude/dashboard/read-env.mjs` style reads only).

## Review Focus

1. A campus model that ignores the tools or never calls `submit` — the loop must force `submit` at the tool cap and record the case as completed-with-forced-submit, not crash or hang.
2. Quotes that differ from the source only in whitespace, curly vs straight quotes, dashes or line breaks — `findQuote` must normalize, and still reject a paraphrase.
3. A course with no indexed materials (empty search results) — the agent still submits; the cell is scored on the profile alone and counted, not dropped.
4. Gateway errors mid-run (5xx, timeouts) — retried with backoff; a checkpoint lets a re-run resume without repeating finished cases.
5. Judge position bias — A/B order randomized per case; the tally reports how often A won overall so a bias is visible.

---

### Task 1: Generic Pi task loop

**Files:**
- Create: `lib/ai/agent/pi/task.ts`
- Test: `tests/lib/ai/agent/pi/task.test.ts` (mock Pi the way `tests/lib/ai/agent/pi/turn.test.ts` does)

**Interfaces:**
- Consumes: `PiEndpoint`, `piReasoningSetup`, `PI_MAX_TOKENS` from `lib/ai/agent/pi/turn.ts`; `ToolDefinition` (as returned by `buildAuditTools`); `costUsdCents`, `costCredits`, `TokenCounts` from `lib/ai/prices.ts`.
- Produces:
  ```ts
  export interface PiTaskInput { systemPrompt: string; userMessage: string; tools: ToolDefinition[];
    submitSchema: Record<string, unknown>; submitDescription: string; endpoint: PiEndpoint; maxToolCalls?: number /* default 6 */ }
  export interface PiTaskResult<T> { value: T; toolCalls: Array<{ name: string; args: unknown }>; forcedSubmit: boolean;
    requests: number; tokens: TokenCounts; usdUnits: number; credits: number | null; ms: number }
  export async function runPiTask<T>(input: PiTaskInput): Promise<PiTaskResult<T>>
  ```
  The `submit` tool is named `submit`; its parameters are `submitSchema`; `value` is its parsed arguments.

- [ ] **Step 1: Write failing tests** — `returns the submit arguments as value`; `forces submit after maxToolCalls tool calls and sets forcedSubmit=true`; `counts tokens from every assistant message into TokenCounts exactly as turn.ts now feeds costUsdCents (read turn.ts on dev after the central-prices merge; cacheWrite semantics per lib/ai/prices.ts)`; `prices campus models at 0 usd and 0 credits`; `throws when the model never calls submit even after forcing`.
- [ ] **Step 2: Run** `pnpm vitest run tests/lib/ai/agent/pi/task.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement `runPiTask`** — follow `runPiTurn`'s Pi agent setup, streaming and token accounting, minus everything interview-specific (citations, search-first controls, `AuditResponse`). Do **not** modify `turn.ts` or `stream.ts` (live interview path).
- [ ] **Step 4: Run** the test file — Expected: PASS; also `pnpm vitest run tests/lib/ai/agent` still green; `pnpm tsc --noEmit` clean.
- [ ] **Step 5: Commit** `git add lib/ai/agent/pi/task.ts tests/lib/ai/agent/pi/task.test.ts && git commit -m "feat(bench): generic Pi task loop for agent benchmarks"`

### Task 2: Evidence checks in code

**Files:**
- Create: `scripts/bench/lib/evidence.ts`
- Test: `tests/scripts/bench/evidence.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function normalizeForQuote(s: string): string            // lowercases, unifies quotes/dashes, collapses whitespace
  export function findQuote(quote: string, sources: Array<{ id: string; text: string }>): { found: boolean; sourceId: string | null }
  export type Dim = 'k' | 'u' | 'd'
  export function evidenceBreaks(cell: { k: number | null; u: number | null; d: number; excerpt: string },
    sources: Array<{ id: string; text: string }>): Dim[]   // dims scored above floor (K>1, U>0, D>0) with no excerpt found in sources
  export function stability(runs: Array<{ k: number | null; u: number | null; d: number }>): number  // share of dims with identical band across runs, same definition as role-judge.ts
  ```
- [ ] **Step 1: Failing tests** — `findQuote matches across curly quotes, en dashes and line breaks`; `findQuote rejects a paraphrase`; `findQuote ignores quotes under 12 characters` (too short to ground); `evidenceBreaks flags D3 with an excerpt not in any source`; `evidenceBreaks does not flag K1/U0/D0`; `stability is 1 for identical runs and 0.5 for one of two dims differing` (match role-judge's definition — read its code and pin the same numbers).
- [ ] **Step 2: Run** `pnpm vitest run tests/scripts/bench/evidence.test.ts` — FAIL.
- [ ] **Step 3: Implement** the four functions.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(bench): code-checked evidence measures`.

### Task 3: The three scoring arms

**Files:**
- Create: `scripts/bench/lib/score-arms.ts`
- Test: `tests/scripts/bench/score-arms.test.ts` (mock `scoreSnapshotCompetencies`, `runPiTask`, `buildAuditTools`)

**Interfaces:**
- Consumes: `scoreSnapshotCompetencies` (`lib/ai/analyze/program-score-coverage.ts`, with `modelOverride` / `reasoningEffortOverride` as `role-judge.ts` passes them); `runPiTask` (Task 1); `buildAuditTools(courseCode)` — use only `search_materials` and `fetch_material_section`; `findQuote` (Task 2); `loadPrompt` for `program-score-coverage` (same system prompt as the single call).
- Produces:
  ```ts
  export interface ScoreCase { course: string; snapshotId: string; profile: unknown; competencies: CompetencyInput[] /* as scoreSnapshotCompetencies takes */ }
  export interface Cell { sub: string; k: number | null; u: number | null; d: number; excerpt: string }
  export interface ArmResult { cells: Cell[]; calls: number; tokens: TokenCounts; usdUnits: number; credits: number | null; ms: number; forcedSubmit?: boolean; toolCalls?: number }
  export type ArmName = 'single' | 'agent' | 'checker'
  export async function runScoreArm(arm: ArmName, c: ScoreCase, model: { id: string; level?: string; endpoint: PiEndpoint }): Promise<ArmResult>
  ```
  - `single`: one `scoreSnapshotCompetencies` call (today's production call).
  - `agent`: `runPiTask` with the production system prompt + a short tool section, tools `search_materials`, `fetch_material_section` and a code tool `check_quote({ quote })` → `findQuote` over the profile text plus any chunks fetched so far in this task; submit schema = the coverage result schema (reuse `coverageJsonSchema` — export it from `program-score-coverage.ts` without changing behavior).
  - `checker`: the `single` result, then per course one `runPiTask` checker that never sees the scores: given the profile, the competencies' K/U/D descriptors and the same tools, it returns per competency and dimension `{ quote: string | null, level: number }` (prompt adapted from `scripts/bench/judge-factcheck.ts`); code then applies the cap exactly as `judge-factcheck.ts` does (no grounded quote → floor; grounded → min(score, level)).
- [ ] **Step 1: Failing tests** — `single passes model overrides through and returns cells`; `agent offers exactly search_materials, fetch_material_section, check_quote and submit`; `check_quote finds text from a fetched chunk`; `checker never puts the single arm's scores in the checker prompt` (assert the prompt string contains none of the score fields); `checker caps D3 to the level of a grounded quote and drops an ungrounded D2 to 0`; `a course with no materials still returns cells` (search tool returns empty).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS; `pnpm tsc --noEmit` clean.
- [ ] **Step 5: Commit** `feat(bench): single, agent and checker scoring arms`.

### Task 4: Scoring harness

**Files:**
- Create: `scripts/bench/agent-judge.ts`
- Test: `tests/scripts/bench/agent-judge.test.ts` (pure helpers only: guards, credit ceiling, checkpoint resume)

**Interfaces:**
- Consumes: Tasks 2–3; case loading as in `role-judge.ts` (snapshot + stored post-fix Sol cells + `subCompetencies` + `getScoringFlags`); `costCredits`.
- Produces: CLI `pnpm exec tsx scripts/bench/agent-judge.ts --courses <codes> --arms single,agent,checker --models deepseek-v4.1-flash-1017:low,qwen3.8-27b-fp8:off --runs 3 --out <dir> [--paid --max-credits <n>] [--cases-probe 1]`; writes `<dir>/calls.json` (checkpointed after every call; a re-run skips finished `(model, arm, course, run)` keys), `<dir>/summary.md` (per arm × model: evidence breaks, grounding share, stability, calls, tokens, credits, s/course), and `<dir>/blind-pairs.json` + `<dir>/blind-key.json` (for each course × competency: the live baseline's cell vs each other arm's modal cell, A/B by seeded RNG, seed in the file).
- Exported helpers: `assertSafeDb(url: string): void`, `checkCreditCeiling(spent: number, max: number | null): void`, `pendingKeys(all, done): Key[]`.
- [ ] **Step 1: Failing tests** — `assertSafeDb throws for gc_curriculum and accepts gc_curriculum_bench / *_scratch`; `without --paid a set OPENAI_API_KEY throws`; `--paid without --max-credits throws`; `checkCreditCeiling throws once spent exceeds max`; `pendingKeys skips finished keys`; `blind pairs are reproducible for a fixed seed and randomize A/B`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (models outer loop, then arm, run, courses — courses of one run may run in parallel as role-judge does; `withBackoff` copied from role-judge for 5xx/timeouts). **Step 4: Run** — PASS.
- [ ] **Step 5: Smoke run, free:** one course, one run, all three arms, Qwen only, against the bench DB: `--courses "GC 3460" --runs 1 --models qwen3.8-27b-fp8:off`. Expected: `summary.md` with three rows, no errors, credits 0.
- [ ] **Step 6: Commit** `feat(bench): agents-vs-single-calls scoring harness`.

### Task 5: Blind judging + tally

**Files:**
- Create: `scripts/bench/lib/blind.ts` (`makePairs`, `unblind`), `scripts/bench/tally-blind.ts`, `docs/superpowers/plans/2026-11-22-blind-judge-prompt.md` (the judge's exact instructions)
- Test: `tests/scripts/bench/blind.test.ts`

**Interfaces:**
- Produces: `tally-blind.ts --pairs <file> --key <file> --verdicts <file> [--second <file>]` prints per arm × model: wins / losses / ties vs the live baseline, preference excluding ties, A-position win rate (bias check), agreement with the second judge on the overlap, and **the decision rule's verdict per arm** (breaks from `summary.md`, preference ≥ 50%, stability ≥ baseline).
- Judge prompt (doc): per pair, the judge reads the course profile and files (read-only SQL on the bench copy + the materials), scores nothing itself, picks A / B / tie for "which cell is the better-supported reading of what students actually do, per the depth scale", one-sentence reason; must not open the key; 20% second-judge sample drawn by `makePairs` with its own seed.
- [ ] **Steps:** failing tests (`unblind maps A/B back by key`; `tally applies the decision rule: fewer breaks + ≥50% + stability ≥ baseline → adopt, else not`; `A-position rate reported`) → FAIL → implement → PASS → commit `feat(bench): blind pairs and decision-rule tally`.

### Task 6: Run the scoring benchmark (campus) and report

- [ ] **Step 1:** Recover the 10 held-out course codes of the 2026-11-01 Judge run from its artifacts (search `~/.local/share/gc-curriculum-tool/` and the STATE.md entry's sources). If they cannot be found, choose 10 courses with post-2026-10-19 Sol cells, excluding role-judge's default five, and record the list and the reason in the ledger.
- [ ] **Step 2:** Full campus run: all 10 courses, 3 runs, arms `single,agent,checker`, both campus models (one model fully, then the other). Expected: 180 arm-runs (2 models × 3 arms × 10 courses × 3 runs), credits 0; error rate reported.
- [ ] **Step 3:** Dispatch the blind Opus judge with the Task 5 prompt over `blind-pairs.json`; dispatch the second judge on the 20% sample.
- [ ] **Step 4:** `tally-blind.ts` → write `docs/benchmarks/<date>-agents-for-scoring-campus.md` (frontmatter as the existing files: title, date, applies `role:judge`, summary) with the table, the decision-rule verdict per arm, and which Terra arms the result justifies with their estimates (single ~1, agent ~2–3, checker ~3–4 credits). Add a one-line pointer in STATE.md. **Stop and report to the owner;** Terra arms need the owner's yes.

### Task 7: Wiki arms and factual-error check

**Files:**
- Create: `scripts/bench/lib/wiki-facts.ts`, `scripts/bench/lib/wiki-arms.ts`
- Test: `tests/scripts/bench/wiki-facts.test.ts`, `tests/scripts/bench/wiki-arms.test.ts`

**Interfaces:**
- Consumes: the substrate loaders in `lib/ai/wiki/update.ts` (`loadCompetencySubstrate`, `loadTargetSubstrate`, `loadCourseInfo`, and whatever `updateWikiForSnapshot` / `generateProgramPagesFromSubstrate` feed the writer — read them; do not change them); `runPiTask`; the single-call path exactly as `scripts/bench/role-write.ts` invokes `wiki-update`.
- Produces:
  ```ts
  export interface PageFacts { pageId: string; counts: Record<string, number>; courseLists: Record<string, string[]>; targets: string[] }
  export async function pageFacts(pageId: string): Promise<PageFacts>            // from the substrate, not from any page text
  export function factualErrors(markdown: string, facts: PageFacts): Array<{ kind: 'count' | 'course-list' | 'stale-target'; detail: string }>
  export async function runWikiArm(arm: 'single' | 'agent' | 'checker', pageId: string, model: {...}): Promise<{ markdown: string; calls: number; tokens: TokenCounts; usdUnits: number; credits: number | null; ms: number }>
  ```
  Agent tools: `read_snapshot_facts()` → `PageFacts`; `check_page({ markdown })` → `factualErrors`. Checker: the single draft, then a `runPiTask` that sees the draft and `read_snapshot_facts`, returns corrected markdown; code re-runs `factualErrors` on it.
- [ ] **Step 1: Failing tests** — `factualErrors catches "10 of 18" when the facts say 11 of 18` (the 2026-11 problem-solving case: 10/8 vs 11/7); `factualErrors catches a course missing from a stated course list`; `factualErrors passes a page that matches its facts`; `agent offers exactly read_snapshot_facts, check_page and submit`.
- [ ] **Steps 2–5:** run FAIL → implement → PASS → commit `feat(bench): wiki arms and factual-error check`.

### Task 8: Wiki harness, campus run, report

**Files:**
- Create: `scripts/bench/agent-wiki.ts` (same CLI shape, guards, checkpointing, credit ceiling and blind-pair output as `agent-judge.ts`; measures: factual errors per page, lint errors via the existing wiki lint, blind preference, cost)
- [ ] **Step 1:** Tests for the wiki-specific pure helpers (case selection = the 14 pages of the 2026-11-19 review + the problem-solving page; outputs never written to the wiki repo — assert the harness has no `writeAndPush` import).
- [ ] **Step 2:** Free smoke run on one page; then the full campus run (15 pages × 3 runs × 3 arms × 2 models).
- [ ] **Step 3:** Blind judge (against the snapshot) + 20% second judge; `tally-blind.ts`; write `docs/benchmarks/<date>-agents-for-wiki-campus.md`; STATE.md pointer. **Stop and report;** Terra arms (est. single ~1.5, agent ~3–4, checker ~3–4 credits) need the owner's yes.

### Task 9 (owner-gated, per run): Terra arms

Only for arms the campus results justify. For each approved arm: `--paid --max-credits <approved ceiling>` with a **one-case probe first**; report the probe's measured credits and projected total before the full run; the running total across all Terra arms never exceeds 20 credits. Results appended to the same benchmark docs; decision-rule verdict against the live setup (scoring: Terra single call; wiki: Terra writer).
