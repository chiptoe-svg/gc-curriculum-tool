# Model Roles Part 2 — Role Routing and the Local-Only Course Switch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each AI role run on OpenAI or on a named campus (RCD) model. Move the Extract functions the benchmark cleared onto campus Qwen3.8. Make campus safe for the interview. Then, once every role has a passing campus model, offer the per-course "Only use local LLM models for this course" switch.

**Architecture:**
- `ROLE_SETTINGS` gains a provider, and a `LOCAL_ROLE_SETTINGS` table names the campus model per role.
- `getProviderForFunction` takes a course context, so a course-scoped call can be routed by the course switch.
- The campus provider gains a runaway guard, streaming tool use, and the interview's citation repairs.
- **Stage 2a** (Tasks 1–7) ships on its own. **Stage 2b** (Tasks 8–10, the course switch) waits for its gate.

**Tech Stack:** Next.js 15, TypeScript strict, Drizzle/Postgres 17, OpenAI SDK against the RCD gateway, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-01-local-models-and-role-benchmark-design.md` (Part 2). Benchmark results are in `docs/STATE.md`, under "Local models and role benchmark".

## Global Constraints

- **Exact model ids, never the moving aliases:**
  - Campus: `qwen3.8-27b-fp8`, `deepseek-v4.1-flash-1017`, `glm-5.3`, `gptoss-120b`. Never `tiger` or `cub`.
  - All of them live in `lib/ai/models.ts`; the registry guard test covers them.
- **Reasoning wire formats**, from the 2026-11-01 probe, already encoded in `campusReasoningParams`:
  - Thinking off is sent as `chat_template_kwargs.enable_thinking=false` (GLM, Qwen3.8, DeepSeek).
  - Levels are sent as top-level `reasoning_effort` for GLM, DeepSeek and gpt-oss, and as `chat_template_kwargs.reasoning_effort` with thinking on for Qwen3.8.
- **Owner decisions (2026-11-01):**
  - **Extract:** `parse-profile-fields`, `materials-analysis` and `decompose-prereq-gap` move to campus `qwen3.8-27b-fp8`, thinking off, with the OpenAI fallback kept for courses without the switch.
  - **Extract, staying put:** `material-classify` stays on its paid model; `ingestion-checkin` and `jd-extract` stay until tested.
- **Judge:** scoring stays on OpenAI Sol, since no campus model passed.
- **Converse and Write routing:** pending the owner's blind reads. The tables carry the value `'pending'` until then, and pending means "keep OpenAI".
- **Switch copy, verbatim:**
  - Label: "Only use local LLM models for this course".
  - Hover note: "These run on Clemson's RCD servers; nothing is sent to OpenAI."
  - Campus-down message: "Local models are unavailable right now; your work is saved, please try again later."
- **Switch behavior:** stays as set, can be unchecked by anyone who can edit the course, applies from that point forward only, and never falls back to OpenAI.
- **Tests:** run vitest with `env -u DATABASE_URL`; real-DB tests run against the scratch DB only. Campus calls in tests are mocked; benchmarks use free campus models only.

## Gate for Stage 2b (Tasks 8–10)

The spec offers the switch only when every role has a campus model that passed Part 1. Today Judge has none: DeepSeek Flash lost to Sol on held-out courses even with the fact-check pass. Stage 2b starts only after one of these:
- a campus Judge passes a re-run;
- the owner accepts a weaker Judge for switched courses, as a written decision recorded in STATE.md.

Until then, Tasks 8–10 stay unstarted.

## Review Focus

1. **Missing reasoning knob:** a role names a campus model whose family has no known reasoning setting (gemma, qwen3.6). The call goes out with no reasoning field instead of throwing (Task 1, `unknown family sends no reasoning field`).
2. **Runaway reasoning:** a campus call that hits the token cap or time limit is retried once with thinking off, and fails cleanly the second time without silently switching provider (Task 3).
3. **Streaming interview on campus:** a streamed interview turn on campus emits the same events (`session`, deltas, `final`) as OpenAI, so the chat UI needs no change (Task 4).
4. **Invented messageId:** a campus interviewer quotes the instructor's latest answer correctly but invents the messageId. The quote is kept, re-pointed to the real message, and trimmed to 200 characters (Task 5).
5. **Missing course code:** a course-scoped function called without a course code fails to compile (Task 6, type test).

---

### Task 1: Role providers and campus models in the registry

**Files:**
- Modify: `lib/ai/models.ts`: add `RoleProvider = 'openai' | 'campus'`, a `provider` on `RoleSetting`, and a `CAMPUS_MODELS` list.
- Modify: `lib/ai/provider.ts`: `buildProvider` uses the role's provider.
- Modify: `lib/ai/campus.ts`: `campusReasoningParams` returns `{}` for an unknown family when the level is undefined. It still throws when a level is set.
- Test: `lib/ai/__tests__/model-registry.test.ts`, `lib/ai/__tests__/campus-reasoning.test.ts`, `lib/ai/__tests__/provider-role-routing.test.ts` (new).

**Interfaces:**
- Produces:
  - `RoleSetting { model: string; effort?: string; provider: RoleProvider; label; purpose }`
  - `CAMPUS_MODELS: readonly string[]`
  - `isCampusModel(id: string): boolean`

- [ ] Write failing tests:
  - `a role with provider campus builds a CampusProvider for its model`
  - `an openai role is unchanged`
  - `unknown family sends no reasoning field`
  - `the registry guard rejects a campus alias (tiger, cub) in lib/`
- [ ] Run them and see them fail. Implement. Run them and see them pass. Run the full `lib/ai` suite.
- [ ] Commit: `ai: roles name a provider; campus models in the registry`.

### Task 2: Per-function routing table, with Extract moves

**Files:**
- Modify: `lib/ai/function-settings.ts`. Per-function overrides already exist in `ai_function_settings`; add a code default `FUNCTION_PROVIDER_DEFAULTS` for `parse-profile-fields`, `materials-analysis` and `decompose-prereq-gap`: `{ provider: 'campus', model: 'qwen3.8-27b-fp8', reasoning: 'off' }`.
- Modify: the `/settings` display, so each function shows its provider and model.
- Test: `lib/ai/__tests__/function-routing.test.ts`.

**Interfaces:**
- Produces: `resolveForFunction(id)` returns `{ model, effort, provider, reasoning? }`.

- [ ] Write failing tests:
  - `the three Extract functions resolve to campus qwen3.8 off`
  - `material-classify, ingestion-checkin and jd-extract stay on OpenAI`
  - `a DB override still wins over the code default`
  - `campus failure on a routed Extract function falls back to OpenAI when the course has no switch` (mock campus throwing)
- [ ] Implement. Make the fallback a single wrapper in `provider.ts`; don't spread it across call sites. Verify, then commit: `ai: Extract functions cleared by the benchmark run on campus Qwen3.8`.

### Task 3: Runaway guard on campus calls

**Files:**
- Modify: `lib/ai/campus.ts`.
- Test: `lib/ai/__tests__/campus-runaway.test.ts`.

**Spec values:** a per-call token cap and time limit. Defaults: `max_tokens` 8000 for `complete`, a 90 s abort per request. A call that hits either is a failure and is retried once with thinking off; a second failure throws `CampusRunawayError`.

- [ ] Write failing tests:
  - `a response that stops at the length limit is retried once with thinking off`
  - `a second runaway throws CampusRunawayError`
  - `a timeout aborts and retries once`
- [ ] Implement. Verify, then commit: `ai: campus calls retry once without thinking after a runaway, then fail`.

### Task 4: `streamWithTools` on the campus provider

**Files:**
- Modify: `lib/ai/campus.ts`: implement `streamWithTools`, which throws today. Port `requireToolFirst` (forced first search) from `spike/interview-harness` @ 8867b0b1.
- Test: `lib/ai/__tests__/campus-stream-with-tools.test.ts`.

**Interfaces:**
- Consumes: the `streamWithTools` contract in `lib/ai/provider.ts`, as implemented by `OpenAIProvider`.

- [ ] Write failing tests:
  - `streams text deltas and tool calls in the OpenAI provider's event order`
  - `requireToolFirst sends tool_choice required on the first request only`
  - `a 400 on forced tool choice retries without it and logs once`
- [ ] Before writing the retry, check the cause of the 5-in-45 forced-search rejections. Replay the five logged requests from `bench-2026-11/converse/*.log`, then record the cause in STATE.md.
- [ ] Implement. Verify, then commit: `ai: campus provider streams tool use (interview on campus)`.

### Task 5: Citation repair for campus interviewers

**Files:**
- Modify: `lib/ai/agent/interview-controls.ts` (`keepValidCitations`).
- Test: `tests/lib/ai/agent/interview-controls.test.ts`.

**Rules:**
- An instructor citation whose `messageId` is not a real message, but whose excerpt is a substring (normalized whitespace) of exactly one instructor message in the session, is re-pointed to that message.
- An excerpt over 200 characters is trimmed to 200 at a word boundary, with a closing "…".
- Applies to every provider.

- [ ] Write failing tests:
  - `re-points an invented messageId when the quote matches one answer`
  - `drops it when the quote matches none or several`
  - `trims a long quote to 200 characters at a word boundary`
- [ ] Implement. Verify, then commit: `capture: interview citations keep a correct quote with an invented message id; long quotes are trimmed`.

### Task 6: Course context on course-scoped calls

**Files:**
- Modify: `lib/ai/provider.ts`, plus the course-scoped call sites among the 30 `getProviderForFunction` calls. List them in the task report: capture chat, capture scores, stress test, reconcile, check-in, materials analysis, the objective guide, KUD extract, intended skills, explore, and others.
- Test: `lib/ai/__tests__/course-scoped-functions.test-d.ts`, a type test with `expectTypeOf` or `// @ts-expect-error`.

**Interfaces:**
- Produces:
  - `COURSE_SCOPED_FUNCTIONS` (a const tuple)
  - the overloads `getProviderForFunction(id: CourseScopedFunctionId, ctx: { courseCode: string }, override?)` and `getProviderForFunction(id: OtherFunctionId, ctx?: undefined, override?)`

- [ ] Write the failing type test `a course-scoped function without a course code does not compile`.
- [ ] Thread the course code through each call site, then run `tsc` and the full suite.
- [ ] Commit: `ai: course-scoped AI calls carry their course code`.

### Task 7: Alias-move check and bench cost fix

**Files:**
- Create: `scripts/ai/campus-alias-check.mjs` and `scripts/ai/com.gc.campus-alias-check.plist`. The schedule uses `StartCalendarInterval`, daily at 07:10.
  - It compares the model behind `tiger` and `cub` (from a one-token probe's `model` field) with the pinned ids.
  - It opens one GitHub issue labelled `campus-alias` when an alias moves, and closes it when the alias matches again.
- Modify: `scripts/capture/interview-bench.ts` (on the spike branch). Fix the printed "Cost est.", which is 100× too high because `costUsdCents` is in hundredths of a cent.
- Test: `scripts/ai/__tests__/campus-alias-check.test.mjs`, covering the pure compare step.

- [ ] Write the failing test, implement, and verify. The owner installs the plist.
- [ ] Commit: `ai: daily check that campus aliases still point at the pinned models`.

**Stage 2a ends here.** Update STATE.md (routes, the AI function table, env) and request a deploy.

### Task 8 (gated): Course switch — schema and setting

**Files:**
- Create: `drizzle/00NN_local_models_only.sql`. Columns: `courses.local_models_only boolean not null default false`, `courses.local_models_only_changed_at timestamptz`.
- Modify: `lib/db/schema.ts`, `lib/db/courses-queries.ts` (`setLocalModelsOnly(code, on)`), and a PATCH route.
- Test: a real-DB test on scratch.

### Task 9 (gated): Enforcement — local-only routing, with no fallback

**Files:** `lib/ai/provider.ts` (the course context from Task 6 selects `LOCAL_ROLE_SETTINGS` when the switch is on), `lib/capture/run-course-ingest.ts` (the mode comes from the course), and the voice route (skip the Whisper OpenAI fallback).

**Tests:**
- `a switched course never builds an OpenAI provider for any course-scoped function`
- `campus down returns the fixed message with code local_models_unavailable`
- `program-wide calls ignore the switch`
- `program scoring of a switched course's pair uses campus`

### Task 10 (gated): The switch in the UI

**Files:** `app/capture/[code]/TriageStep.tsx` (it replaces "Use local/free models"), the interview start in `CaptureHero.tsx`, and the shared alert for the campus-down message.

**Tests:** both places show the same stored value; checking calls the PATCH route; the label and hover text are exact.
