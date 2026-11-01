# Local models: role benchmark and "Only use local LLM models" switch

**Date:** 2026-11-01. **Status:** approved by the owner 2026-11-01.
**Builds on:** model roles ([`2026-10-27-model-roles-design.md`](./2026-10-27-model-roles-design.md)), the 2026-10-05 model evaluation (`docs/superpowers/audits/2026-10-05-model-evaluation.md`), the interview harness spike (`docs/superpowers/audits/2026-10-28-interview-harness-spike.md`, branch `spike/interview-harness`).

## Why

Every AI role except material import runs on OpenAI models through RCD's shared credits. The credits ran out on 2026-10-30 and paused live interviews. RCD also hosts campus models at no cost: `tiger` (GLM-5.3 today), `cub` (Qwen3.8-27B today), `deepseek-v4.1-flash-1017` and `gptoss-120b`. The owner wants campus models wherever they do the job as well, and a paid model only where they don't.

Some instructors will also want a guarantee that nothing about their course is sent to OpenAI. Today's Triage checkbox ("Use local/free models") covers material import only, but reads as covering everything.

## Three parts, in this order

1. **Role benchmark.** Find the best campus model for each role (Judge, Converse, Write, Extract) for free, and spend credits only on roles the campus models can't settle.
2. **Role routing and the course switch.** Let each role run on campus or OpenAI, and add a per-course "Only use local LLM models" switch that covers every AI call for that course.
3. **Pi for Converse.** Move the interview (and later the other agents) to the Pi harness with the search and citation checks, so a campus model can run it reliably.

Parts 2 and 3 can be built while part 1 runs. Each part gets its own plan.

## Part 1: role benchmark

### Rules

- **Campus models are free: test them broadly, with repeat runs.** Only OpenAI models on the gateway spend credits.
- **No paid call until the owner confirms on the RCD dashboard that the credits have reset.** An OK probe or status file is not enough (memory `feedback_probe_before_paid_batch.md`).
- **GPT baselines come from outputs already stored.** Live records were produced by Sol, and the 2026-10-05 runs saved Sol-low scoring. Copy them read-only into the scratch DB (`gc_curriculum_p2_scratch`); never write to live.
- **Record the model behind each alias** (the gateway's reported model per response), since `tiger` and `cub` will move.
- **Run each model as a batch** (all of one model, then the next), with low concurrency on the shared cluster.
- **Reuse the existing scripts.** Extend `scripts/reliability/model-eval.ts`, `profile-eval.ts`, `light-eval.ts` and `scripts/capture/interview-bench.ts` (which already has `--endpoint campus`) to call campus models directly through `CampusProvider`. Part 1 does not wait for part 2. *(Builder's call.)*
- **Blind checks are Claude Opus subagents** (owner, 2026-11-01). The checker's judgment decides each role, so it gets the most capable model. They use the Claude plan, not RCD credits.

### Candidates

| Role | Campus candidates | Baseline (stored, free) | Paid candidate (phase 2 only) |
|---|---|---|---|
| Judge | tiger, cub, deepseek flash | Sol low | Terra low |
| Converse | tiger, cub, deepseek flash; each on the current loop and on Pi | Sol medium (4 cases already run) | Terra low/medium + Pi |
| Write | tiger, cub, deepseek flash | Sol low | Terra low |
| Extract | tiger, cub, deepseek flash, gptoss-120b | gpt-5.4-mini / gptoss-120b | none planned |

### Reasoning level

Each campus model runs at more than one reasoning level, because the right level differs by model and by task. Lessons from CUassistant's advisor benchmarks on the same RCD models (`~/projects/CUassistant`, `src/config.ts`, `docs/superpowers/specs/2026-08-15-adaptive-thinking-router-design.md`, `2026-10-31-admin-method-check-design.md`):

- **The setting has to reach the model.** CUassistant found qwen3.8 turns had silently run at the template's default (xhigh) because the effort was never sent. Our `CampusProvider` sends only `reasoning_effort`, which is a gpt-oss setting. Qwen3.8 needs `chat_template_kwargs` (`enable_thinking`, `reasoning_effort` low|medium|xhigh), and GLM and DeepSeek have their own on/off switch.
- **First step, free:** probe each model at each level with one prompt. Confirm the setting changes reasoning tokens and latency, and record which knob each model honors, before any benchmark run.
- **qwen3.8-27b (`cub`):** low was best on RCD with thinking on (31/32 correct, p50 11 s) versus the default (29/32, 18 s) and xhigh (28/32, 31 s).
- **Thinking off vs on:** off was 2–5× faster and tied overall, but lost on comparisons and multi-step questions. DeepSeek Flash with thinking off wrote its verdict before comparing the numbers (3 of 8 wrong), and thinking on fixed it. Judge work is comparison-heavy, so test it with thinking on.
- **DeepSeek V4.1 Flash** scored 245/256 against qwen's 232/256 on CUassistant's full set, after prompt fixes made for it.
- **GLM-5.3:** no prior data. Our interview runs used the model's default.

Levels tested *(builder's call)*:

| Role | Levels per model |
|---|---|
| Judge | low, medium; thinking always on |
| Converse | off, low |
| Write | off, low |
| Extract | off; low only for a model that fails off |

xhigh is skipped: it was slower and no more accurate in CUassistant's runs. A role's chosen campus setting is stored as a model plus level, like the OpenAI roles.

### Test sets and how each is judged

| Role | Cases | Measures | Who judges |
|---|---|---|---|
| Judge: coverage scoring | The 5 course × target pairs from 2026-10-05, 5 runs each | Band agreement (same metric as 2026-10-05); evidence-above-zero breaks | Blind check of every cell where a candidate and Sol land in different bands, by a Claude subagent (a different model family), with the 2026-10-05 materials |
| Judge: course profile | 3 courses, 2 runs each | Share of competencies resting only on "inferred"; failures | Blind check of a sample of claims against the materials |
| Converse | The 9 interview cases in `scripts/capture/interview-bench-cases.json` | Searched, cited, bad citations, times sent back, seconds per turn | Owner reads a blind sheet (questions shown after the instructor's previous turn, model hidden) |
| Write | 6 real outputs, one per main Write function | Failures, length, speed | Owner reads a blind A/B sheet; a Claude pre-screen flags factual errors |
| Extract | About 20 digests and chunk notes | JSON failures, speed, missed key facts | Blind spot check by a Claude subagent against the source text |

### Deciding a role

- **Campus wins** if it meets the bar for its role *(builder's call; the owner can change any of these)*:
  - **Judge:** the blind check sides with the candidate at least as often as with Sol; no more evidence-above-zero breaks than Sol; band agreement no more than 10 points below Sol's.
  - **Converse:** searched and cited in at least as many cases as Sol; no bad citations; the owner's blind read rates its questions at least as good; at most 15 s per turn.
  - **Write:** the owner prefers it, or finds no difference, in at least half the pairs, and the pre-screen finds no factual errors Sol didn't make.
  - **Extract:** no more JSON failures (after one retry) and no more missed key facts than the baseline.
- **Campus clearly loses:** that role goes to phase 2.
- **For each role, also name the best campus model** even if OpenAI wins, because the course switch (part 2) needs a campus model for every role.

### Phase 2 (paid)

1. The owner confirms the reset on the RCD dashboard.
2. One probe call per paid configuration; estimate the full run's credits from it and get the owner's yes.
3. Run only the open roles, with the smallest set that settles each.

Outputs: a results page in `docs/superpowers/audits/`, plus one line in STATE.md per decision.

## Part 2: role routing and the course switch

### Role routing

- Each entry in `ROLE_SETTINGS` (`lib/ai/models.ts`) gains a provider: `openai` or `campus`. Moving a role to campus stays a one-line edit.
- A second table, `LOCAL_ROLE_SETTINGS`, names the campus model and effort each role uses when a course has the switch on. It is filled from the part 1 results.
- Campus model names live in `lib/ai/models.ts` with the OpenAI ones (the registry guard test covers them).
- `AI_PROVIDER` stays the global fallback for code that isn't role-aware. `CAMPUS_LLM_DEFAULT_MODEL` no longer overrides a role that names a campus model.

### The course switch

- **Label:** "Only use local LLM models for this course" (owner's wording), with a hover note that they run on Clemson's RCD servers and nothing is sent to OpenAI.
- **Where:** the Triage step (replacing today's "Use local/free models" checkbox) and the start of the interview. It is the same setting in both places.
- **Stored per course:** `courses.local_models_only` (boolean, default false) and `courses.local_models_only_changed_at` (timestamp). This is a schema change.
- **It stays as set (owner, 2026-11-01).** Once checked, it is still checked when anyone returns to the course. Anyone who can edit the course can uncheck it.
- **It applies from that point forward (owner, 2026-11-01).** Changing it doesn't redo earlier work; results made before keep their recorded model.
- **Changing it mid-interview:** the next turn runs on the newly chosen models with the whole conversation so far. With Pi the conversation carries across a model change. Unchecking sends the transcript so far to OpenAI from then on, which is what unchecking means.
- **When on, every AI call for that course uses `LOCAL_ROLE_SETTINGS`, with no fallback to OpenAI:**
  - All four roles, including the interview, scores, stress test, reconcile and check-in.
  - Material import, which is today's local-only path. The ingest mode is taken from the course setting.
  - Image transcription, which already runs on the Mac or campus.
  - Voice dictation: the OpenAI Whisper last-resort step is skipped.
  - Embeddings already use campus.
- **If campus is down,** the person sees "Local models are unavailable right now; your work is saved, please try again later", using the same alert as the credits message. Nothing is quietly sent elsewhere.
- **Calls that aren't about one course,** such as program-wide synthesis, partner routes and the wiki, follow the role defaults. Program scoring of a course × target pair honors that course's switch.
- Each AI call site that belongs to a course passes the course code to `getProviderForFunction` (31 call sites today; the plan lists which ones are course-scoped). **For course-scoped functions the course code is required by the type**, so a missing one fails to compile instead of being guessed at run time. *(Builder's call.)*
- **The switch isn't offered until every role has a campus model that passed part 1,** including the interview. If the interview passes only with Pi, the switch waits for Pi. An instructor who turns it on never gets a weaker interview than promised, or a refusal. *(Builder's call.)*
- **Already local, no change needed:** Docling extraction, image transcription (the Mac or the campus offload) and embeddings. The app doesn't use rag-core.
- **Earlier work:** reading it makes no AI call. It isn't reprocessed. Snapshots already record their model.

## Part 3: Pi for Converse

- Continue the spike branch (`spike/interview-harness`, Pi 1.4.0 with the search and citation checks) into a production design: the interview first, then the other chat agents.
- The interview part of the course switch depends on part 1's result. If a campus model passes on the current loop, the switch can ship before Pi. If it passes only with Pi, the interview part of the switch waits for Pi.
- Its own spec and plan follow part 1's Converse results.

## Non-goals

- No change to which model any role runs until the owner decides it from the part 1 results.
- No paid testing of roles the campus models already settle.
- No re-scoring of existing records in this work. If Judge moves to a campus model, a re-score is a separate decision, so old and new scores aren't mixed silently.

## Anti-goals

- **A course with the switch on sends anything to OpenAI.** Every route that can call a model for that course must be covered by a test.
- Credits spent before the owner confirms the reset.
- A role switches model on deploy without the owner's decision.
