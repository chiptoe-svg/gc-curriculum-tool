# The Interview on Pi — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the faculty interview on Pi (pi-agent-core), behind a setting that defaults to the current loop. The chat screen, the stored messages and the reply shape stay exactly as they are today.

**Architecture:**
- Lift the spike's Pi loop and its controls into `lib/ai/agent/pi/`, merged with the live `interview-controls.ts`, so each rule exists once.
- `streamAuditAgent` and `runAuditAgent` choose the loop from a per-function setting.
- A Pi adapter maps Pi events onto the existing `AuditStreamEvent`s (`session`, `tool-start`, `text-delta`, `final`, `error`) and writes `capture_messages` rows the same way the current loop does.

**Tech Stack:** pi-agent-core / pi-ai 1.4.0 (ESM, loaded with `import()`), Next.js 15, Drizzle/Postgres, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-08-pi-interview-design.md`. Source of the code: branch `spike/interview-harness` (worktree `curriculum_developer-wt-harness`), files `lib/ai/agent/harness/{pi-interview,controls}.ts`, through commit `a1cd4f2c` and the campus-reasoning commit after it.

## Ruling against the spec (recorded here; specs are append-only)

- **Spec says:** "Faculty still see the reply appear as it is written … the chat streams its `finding` text from `toolcall_delta` by parsing the partial JSON."
- **Actual behavior today:** `CaptureChatPanel` does not render `text-delta`. It shows the tool banner or "Thinking…" and swaps in the reply at `final`, because structured output streams raw JSON.
- **Ruling:** parity means the same events, with no partial-JSON parsing. The Pi adapter emits `tool-start` for tool calls, a `text-delta` heartbeat while `submit_turn` arguments stream (so the panel keeps showing "Thinking…"), and `final` with the validated reply.
- **Cost if wrong:** none for faculty, who see what they see today. Streaming the finding live would be a separate improvement.

## Global Constraints

- **The setting:** `interview_loop`, `'current' | 'pi'`, default `'current'`, per function (`capture-chat-agent`). It is shown and editable on `/settings`. Flipping it back is the rollback.
- **Retry limits** (from the spike): search 1, citations 2. After that, invalid citations are dropped and the turn is saved. The tool budget is 4 tool calls per turn.
- **Per-call token cap** of 16000 on every Pi model call, confirmed in the outgoing request body.
- **Campus models** get their reasoning through `piReasoningSetup` (family wire formats, thinking off included).
- **Telemetry:** `costUsdCents` is computed from tokens at the model's price (Pi reports 0); cache writes are included in uncached input, not counted twice. `recordSpend` and the daily cap apply as on the current loop.
- **No paid run** without the owner's yes for that run and `--max-credits`.
- **Tests:** `env -u DATABASE_URL` for unit tests; scratch DB only for DB tests.

## Review Focus

1. **Failed search check, then the model gives up:** the turn is still saved, with the control event logged (Task 3).
2. **Text reply instead of `submit_turn`:** `finishTurn` forces `submit_turn`, so the reply shape never breaks (Task 2).
3. **Model change between turns** (OpenAI → campus → OpenAI) in one session: the transcript carries, and the stored messages stay one session (Task 4).
4. **`maxTokens` on the wire:** the request body sent to the endpoint carries the cap. In CUassistant, pi-agent-core dropped it (Task 2).
5. **Setting flipped mid-interview:** the next turn uses the new loop with the stored history, and nothing is lost (Task 5).

---

### Task 1: Merge the controls into one module

**Files:** create `lib/ai/agent/pi/controls.ts`. It is the spike's `controls.ts` merged with `lib/ai/agent/interview-controls.ts`: the search trigger, the citation check, and the Part 2 Task 5 repair (re-point an invented messageId when the quote matches exactly one answer; trim quotes over 200 characters).

`interview-controls.ts` re-exports from it, so the current loop uses the same rules.

**Tests:**
- Move the spike's `controls.test.ts` across and keep `tests/lib/ai/agent/interview-controls.test.ts` green.
- Add `re-points an invented messageId when the quote matches one answer` and `trims a quote over 200 characters at a word boundary`.

**Commit:** `capture: one copy of the interview controls (search trigger, citation check and repair)`.

### Task 2: The Pi turn in the app

**Files:** create `lib/ai/agent/pi/turn.ts`, the spike's `runPiTurn`, using the controls from Task 1 and `piReasoningSetup`.

**Interfaces:** `runPiTurn(input: PiTurnInput): Promise<PiTurnResult>`, same shapes as the spike's `LoopTurnInput` / `LoopTurnResult`, plus an `onEvent?: (e: AuditStreamEvent) => void` callback.

**Tests** (Pi's model layer mocked with a scripted stream):
- `a valid submit_turn becomes the reply`
- `a text reply is forced into submit_turn`
- `a failed search check sends the model back once, then saves`
- `invalid citations are retried twice, then dropped`
- `every request body carries max_tokens 16000`
- `campus off sends enable_thinking false`
- `costUsdCents is computed from tokens and does not double-count cache writes`

**Commit:** `capture: the interview turn on Pi`.

### Task 3: Stream adapter and persistence

**Files:** create `lib/ai/agent/pi/stream.ts`, which wraps `runPiTurn` as an `AsyncIterable<AuditStreamEvent>`, and modify `lib/ai/agent/audit-agent-stream.ts` and `audit-agent.ts` to choose the loop.

**Behavior:**
- Persist the user and assistant rows with `appendMessage`, and the tool rows, exactly as `persistAssistantTurn` does today.
- `checkTurnCitations` runs on the final value, as on the current loop.

**Tests:**
- `emits session, tool-start per tool call, a text-delta heartbeat while submit_turn streams, then final`
- `stored rows match the current loop's for the same scripted turn`
- `a search check that runs out still saves the turn and logs the event`

**Commit:** `capture: interview stream adapter for Pi`.

### Task 4: Model change across turns

**Tests** (no new code expected; fix only if they fail):
- `three turns on OpenAI, then campus, then OpenAI keep one session and the full history`
- `the briefing and Generate read the session unchanged`

**Commit:** only if code changed.

### Task 5: The setting

**Files:**
- Modify `lib/db/schema.ts` and add migration `drizzle/00NN_interview_loop.sql`: column `ai_function_settings.loop text null`, where null means `current`.
- Modify `lib/ai/function-settings.ts` (`resolveForFunction` returns `loop`) and the `/settings` page, with a select for `capture-chat-agent` only.

**Tests:**
- `default loop is current`
- `pi setting routes the interview to the Pi stream`
- `flipping mid-session uses the stored history`
- a real-DB test for the column (scratch DB)

**Commit:** `capture: interview loop setting (current or Pi), default current`.

### Task 6: Benchmark parity and the go/no-go read

- Point `scripts/capture/interview-bench.ts --loop pi` at the app module in place of the spike's, so the benchmark and the app run the same code.
- Run the free campus arms again on the app module as a regression check against the spike numbers.
- Assemble the blind question review (Opus): stored Sol; Terra current loop; Terra low + Pi; Qwen3.8 off, DeepSeek low and GLM-5.3 off/low/medium on Pi; gemma-4-31b on Pi.
- The owner reads the review and picks the interview's model and loop.

### Task 7: Ship dark, then turn on

- Update STATE.md (the setting, the migration, the AI function row).
- Deploy with the setting at `current`. The live apply of the migration needs the owner's yes, and runs backup → apply → verify → deploy.
- On the owner's word, set `pi` for `capture-chat-agent`. Watch `dropped citation` and `forced search rejected` in `next.log` for a week.
