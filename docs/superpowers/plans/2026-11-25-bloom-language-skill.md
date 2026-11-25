# Bloom Language Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the interview and writing prompts one shared instruction module so that outcomes, suggested objectives and interview questions use the revised Bloom taxonomy's 19 process names where they fit, without changing any score.

**Architecture:** A new shared prompt module, `lib/ai/prompts/shared/bloom-language.md`, is pulled into five prompts through the existing frontmatter `includes` mechanism (`lib/ai/prompts/load.ts`). Two of those prompts get small targeted edits. A read-only harness on free campus models compares scores before and after, to show the wording does not inflate levels. Only prompt files and tests change: no schema, migration or app code.

**Tech Stack:** Markdown prompt files, the existing `loadPrompt` loader, Vitest, tsx scripts, and RCD campus models (free).

**Spec:** `docs/superpowers/specs/2026-11-25-bloom-language-skill-design.md` (owner approved 2026-11-25).

## Global Constraints

- **The module must never raise a score** (spec "Anti-goal"). It names the process the evidence shows, never a higher one; when the evidence is unclear, use the plainer process or none. In a prompt that also scores, Bloom wording describes the evidence and never stands in for it: a verb in materials or in a written statement is not evidence of a level.
- **The five in-scope prompts:** `capture-chat-agent`, `capture-synthesis`, `objective-evidence-guide`, `synthesize-course-profile`, `wiki-update`. No other prompt includes the module.
- **No change** to scoring rules, the K/U/D anchors (`shared/depth-scale.md`, `shared/kud-rubric.md`), JSON schemas, the database, or `lib/builder/bloom.ts`.
- **Faculty-facing wording never contains level codes** (K2, U4, D3).
- **The name clash:** where "understand" would be ambiguous, write the specific Bloom process (explaining, inferring, comparing).
- **Do wording** follows Background §5's Do table, including its gaps: nothing in Bloom fits "with a reference"; nothing fits "guides others".
- **The 19 process names, exactly as in Krathwohl 2002 Table 3:** recognizing, recalling, interpreting, exemplifying, classifying, summarizing, inferring, comparing, explaining, executing, implementing, differentiating, organizing, attributing, checking, critiquing, generating, planning, producing.
- **No paid AI.** Verification runs only on RCD campus models (`deepseek-v4.1-flash-1017`, `qwen3.8-27b-fp8`). No live DB writes; `interview-bench` is scratch-only by design.
- **Deploy needs the owner's yes**, sent with the Task 5 results. US spelling, plain language.

## Review Focus

1. **Score inflation through wording.** In `capture-synthesis`, which writes statements and scores in one call, levels must not rise once the module is added. Pinned by Task 5's drift measure, with a pre-committed threshold.
2. **Prompt length on campus models.** The module adds tokens to every in-scope call, and Spark accepts only about 45K-token requests. Pinned by a word cap in Task 1's test.
3. **Leaks into prompts that only score or are legacy.** `program-score-coverage`, `what-if-estimate`, `kud-chat`, `extract-course-kud` and `position-*` must not include the module. Pinned by Task 2's negative test.
4. **Stale prompt after deploy.** `loadPrompt` memoizes per process, so the change takes effect only after the app restarts. A deploy note in Task 6 makes this explicit; no code change is needed.
5. **Interview quality regressions.** A Bloom-heavy interviewer could ask stilted questions or skip searches. Pinned by Task 5's `interview-bench` run, which also writes questions out for a person to read.

---

### Task 1: The shared module

**Files:**
- Create: `lib/ai/prompts/shared/bloom-language.md`
- Test: `lib/ai/prompts/__tests__/bloom-language.test.ts`

**Interfaces:**
- Produces: the file `shared/bloom-language.md`, whose body starts with the heading `# Bloom language`. Task 2 tests use that heading as the marker.

- [ ] **Step 1: Write the failing test.** Read the file with `readFileSync`, normalize whitespace, and assert:
  - `it('lists all 19 revised-Bloom processes')`: every name in the Global Constraints list appears, case-insensitively.
  - `it('starts its body with the marker heading')`: `/^# Bloom language/m`.
  - `it('forbids raising a level')`: contains "never" near "higher" (regex `/never[^.]{0,80}higher/i`), and the sentence "A verb in course materials or in a written statement is not evidence of a level."
  - `it('sets the name-clash convention')`: mentions "understand" and tells the writer to name the specific process (`/explaining|inferring|comparing/`).
  - `it('forbids level codes in faculty-facing wording')`: matches `/level codes/i`.
  - `it('gives Do wording with conditions and its gaps')`: contains "executing", "implementing", "independently", "with a reference", and "guides others".
  - `it('covers foundational competencies')`: matches `/foundational/i`.
  - `it('stays short')`: body word count ≤ 900.
- [ ] **Step 2: Run it.** `pnpm vitest run lib/ai/prompts/__tests__/bloom-language.test.ts`. Expected: FAIL, file not found.
- [ ] **Step 3: Write `shared/bloom-language.md`** with the seven parts in the spec's "The module — contents" section, in that order: when to use it; the 19 processes grouped under the six categories, each with a one-line plain gloss; fit to the evidence (verb + content + condition); the name clash; Do wording; never inflate, with one wrong and one right example; foundational competencies. No frontmatter is needed.
  - The glosses are your own words. Krathwohl 2002 gives names only.
  - The executing and implementing glosses follow Larsen et al. 2022 p. 8: a familiar routine task versus selecting a method for an unfamiliar problem.
- [ ] **Step 4: Run the test.** Same command. Expected: PASS, 8 tests.
- [ ] **Step 5: Commit.** `git add lib/ai/prompts/shared/bloom-language.md lib/ai/prompts/__tests__/bloom-language.test.ts`, then `git commit -m "feat(prompts): shared Bloom language module"`.

### Task 2: Include the module in exactly the five prompts

**Files:**
- Modify the frontmatter `includes:` of `lib/ai/prompts/capture-chat-agent.md`, `capture-synthesis.md`, `objective-evidence-guide.md`, `synthesize-course-profile.md` and `wiki-update.md`. Add an `includes:` block where a file has none, keeping the existing entries.
- Test: `lib/ai/prompts/__tests__/bloom-language-includes.test.ts`

**Interfaces:**
- Consumes: Task 1's marker heading `# Bloom language`.
- Produces: `loadPrompt(name)` output contains the module for the five in-scope names.

- [ ] **Step 1: Write the failing test.**
  - `it.each(IN_SCOPE)('%s includes the Bloom module')`: `expect(await loadPrompt(name)).toMatch(/^# Bloom language/m)`.
  - `it.each(OUT_OF_SCOPE)('%s does not')`, where OUT_OF_SCOPE is `['program-score-coverage','what-if-estimate','decompose-prereq-gap','prereq-edge-seed','kud-chat','extract-course-kud','position-interview-agent','position-synthesis','position-rated-items','jd-extract','capture-stress-test']`.
  - `it('keeps depth-scale in the prompts that already had it')`: `capture-chat-agent` and `capture-synthesis` still contain the depth-scale module's first heading. Read that heading from `shared/depth-scale.md` in the test; don't hard-code it.
- [ ] **Step 2: Run it.** `pnpm vitest run lib/ai/prompts/__tests__/bloom-language-includes.test.ts`. Expected: the in-scope cases FAIL.
- [ ] **Step 3: Add `- shared/bloom-language.md`** to the five files' `includes:`. Put it after `shared/depth-scale.md` where that exists, so the scale is read first.
- [ ] **Step 4: Run** this test and Task 1's. Expected: all PASS.
- [ ] **Step 5: Commit** the five prompt files and the test: `feat(prompts): include Bloom language in the interview and writing prompts`.

### Task 3: Interview prompt edits

**Files:**
- Modify: `lib/ai/prompts/capture-chat-agent.md`, the section `## 4. Bloom's-level / KUD-depth probe per major assignment` (around line 608) and `# Optional output: revised learning objectives draft` (around line 900).
- Test: add a `describe('Bloom language')` block to `lib/ai/prompts/__tests__/capture-chat-agent-brief.test.ts`.

**Interfaces:**
- Consumes: Task 1's module, which the prompt can now refer to as "the Bloom language guide above".

- [ ] **Step 1: Write the failing tests.** Slice each section by its heading, as the existing tests do, and normalize whitespace.
  - `it('probes the 19 processes, not only the six categories')`: section 4 mentions at least "executing", "implementing" and "critiquing", and refers to the Bloom language guide.
  - `it('drafts objectives as process + content + condition')`: the objectives section no longer contains `Use Bloom's action verbs (analyze, evaluate, create, etc.)`, and matches `/content/i` and `/condition/i`.
  - `it('still grounds objectives in materials evidence')`: still contains `Ground each objective in materials evidence`.
  - `it('asks about the process, not the level code')`: section 4 does not instruct the agent to say level codes to the instructor (`not.toMatch(/ask[^.]*\b[KUD][1-5]\b/i)`).
- [ ] **Step 2: Run it.** `pnpm vitest run lib/ai/prompts/__tests__/capture-chat-agent-brief.test.ts`. Expected: the new tests FAIL and the old ones PASS.
- [ ] **Step 3: Edit the two sections.**
  - **Section 4:** ask which Bloom process (from the guide) the assignment requires, and under what condition. Include one example question in the spec's style: comparing two proofs, critiquing versus differentiating.
  - **Objectives draft:** replace the verb rule with "Write each objective as a Bloom process from the guide + the content + the condition (e.g. independently, for an unfamiliar substrate)."
  - Keep the 4–7 limit, the numbered list and the evidence rule.
- [ ] **Step 4: Run** the test file. Expected: all PASS.
- [ ] **Step 5: Commit:** `feat(interview): Bloom-process probes and objective drafts`.

### Task 4: Synthesis anti-inflation rule

**Files:**
- Modify: `lib/ai/prompts/capture-synthesis.md`, next to the instructions on how levels are scored. Find the paragraph that tells the model how to assign K/U/D levels from evidence.
- Test: `lib/ai/prompts/__tests__/capture-synthesis-bloom.test.ts`

- [ ] **Step 1: Write the failing test.**
  - `it('states that Bloom wording is not evidence')`: the file contains "A verb in course materials or in a written statement is not evidence of a level."
  - `it('asks statements to name the process the evidence shows')`: matches `/statement[^.]*process the evidence shows/i`.
  - `it('leaves the output schema text unchanged')`: the JSON template block, from the first ```` ```json ```` fence to its closing fence, is byte-identical to the version at the plan's base commit. Store a fixture `lib/ai/prompts/__tests__/fixtures/capture-synthesis-schema.txt` captured before editing.
- [ ] **Step 2: Capture the fixture first, then run the test.** `pnpm vitest run lib/ai/prompts/__tests__/capture-synthesis-bloom.test.ts`. Expected: the first two FAIL and the schema test PASSES.
- [ ] **Step 3: Add two sentences.**
  - Beside the scoring instructions: "Bloom wording describes the evidence and never stands in for it. A verb in course materials or in a written statement is not evidence of a level."
  - Beside the statement field guidance: "Each statement names the process the evidence shows (see the Bloom language guide), never a higher one."
- [ ] **Step 4: Run** the test, the whole `lib/ai/prompts/__tests__` folder, and `pnpm tsc --noEmit`. Expected: all PASS and no type errors.
- [ ] **Step 5: Commit:** `feat(synthesis): Bloom wording never stands in for evidence`.

### Task 5: Verify on free campus models (no paid AI, no live writes)

**Files:**
- Create: `scripts/reliability/bloom-drift.ts`
  - Read-only, modeled on `scripts/reliability/profile-eval.ts`: `assembleSynthesisContext` + `generateCaptureProfileV2`, never saving.
  - The model comes from `--model` (a campus id only). The script refuses any model not in `CAMPUS_MODELS` (`lib/ai/models.ts`).
  - Writes JSON to `--out`.
- Create: `scripts/reliability/bloom-drift-compare.ts`. It reads two or more JSON outputs and prints the comparison.
- Test: `tests/scripts/reliability/bloom-drift-compare.test.ts`, for the pure comparison function.

**Interfaces:**
- Produces `compareRuns(a: DriftRun[], b: DriftRun[]): DriftReport`, where `DriftRun` is `{ course: string; run: number; label: string; cells: Array<{ competency: string; k: number|null; u: number|null; d: number|null }>; statements: string[] }`.
- `DriftReport` has:
  - `withinNoise`: the mean absolute level difference between runs of the same prompt version, per dimension;
  - `between`: the mean absolute difference between versions, per dimension;
  - `meanShift`: the signed mean change from old to new, per dimension;
  - `bloomShare`: the share of statements containing at least one of the 19 process names, old vs new.

- [ ] **Step 1: Write the failing tests for `compareRuns`.** Use hand-built runs.
  - Identical runs give zeros.
  - A uniform +1 on every U cell in the new version gives `meanShift.u === 1`.
  - `bloomShare` counts statements with at least one process name, case-insensitive.
  - Cells present in only one run are excluded and counted in `unmatched`.
- [ ] **Step 2: Run them.** `pnpm vitest run tests/scripts/reliability/bloom-drift-compare.test.ts`. Expected: FAIL, module missing.
- [ ] **Step 3: Implement** `compareRuns` and the two scripts. The comparison matches cells by competency id.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Measure.**
  - Create a worktree at the plan's base commit, which is the old prompts.
  - From both trees, run 2 passes each on courses `GC 3460`, `GC 3700`, `GC 3730` and `GC 1040`:
    `pnpm exec tsx --env-file=<main checkout>/.env.local scripts/reliability/bloom-drift.ts --model qwen3.8-27b-fp8 --runs 2 --out <scratchpad>/bloom-drift-<old|new>.json`
  - Then compare: `tsx scripts/reliability/bloom-drift-compare.ts <old> <new>`.
  - Expected, and pre-committed: for each dimension, `meanShift` is at most `withinNoise`, and is not positive by more than 0.25 of a level. `bloomShare` rises.
  - If any dimension fails, stop and report to the owner; do not deploy.
- [ ] **Step 6: Interview bench**, using `scripts/capture/interview-bench.ts`, which is scratch-only, with a campus model and `--loop pi`.
  - Run all cases on the old and new prompts, and write questions to `--out` in the scratchpad.
  - Expected: the search and cite shares are not lower on the new prompt.
  - Have a fresh Opus reader score the questions blind (old vs new shuffled, 0–5, "acceptable" yes/no), the same method as `interview-blind5/`. Expected: the acceptable share is not lower.
- [ ] **Step 7: Blind-read statements.** Have the same reader take 30 new statements and judge whether the named Bloom process matches the cited evidence. Report the share.
- [ ] **Step 8: Commit** the scripts and test: `test(reliability): Bloom wording drift harness (read-only, campus models)`. Results stay in the scratchpad and go into the Task 6 report; they are not committed.

### Task 6: Record and hand off for the deploy decision

**Files:**
- Modify: `docs/STATE.md`. Add one entry: built, verified with the numbers from Task 5, deploy pending the owner's yes. Note that the change is prompt files only, takes effect after an app restart (loadPrompt memoizes), and needs no migration.

- [ ] **Step 1: Write the STATE entry** with the Task 5 numbers: meanShift and withinNoise per dimension, bloomShare old vs new, bench search and cite shares, blind acceptable share, and the statement-fit share.
- [ ] **Step 2: Run the full prompt-test folder and typecheck.** `pnpm vitest run lib/ai/prompts/__tests__ tests/scripts/reliability && pnpm tsc --noEmit`. Expected: PASS.
- [ ] **Step 3: Commit:** `docs(state): Bloom language module built and verified; deploy pending owner`.
- [ ] **Step 4: Report to the owner** with the numbers and the deploy steps: merge to main, rebuild, restart. Deploy only on their yes, following the deploy chain rules (`|| exit` per step, fresh BUILD_ID check, interview idle).
