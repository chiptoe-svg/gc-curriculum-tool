# Interview harness spike: Pi vs Codex vs the current loop (2026-10-28)

**Question (owner):** the interviewer's behavior depends on the model's whims. Would a real agent
harness, Pi (as CUassistant's advisor uses it) or Codex (as mailcal and gc_agent used it), rein it in
better than the current Vercel AI SDK loop? Vercel was dropped as a build target (owner); it stays as
the baseline.

**Branch:** `spike/interview-harness` (worktree `curriculum_developer-wt-harness`). Nothing live, no
app code changed; scratch DB only. All runs on **GLM-5.3** (RCD campus, free); GLM tests the loops
and controls, not how well Sol follows instructions.

## What was built

- `lib/ai/agent/harness/controls.ts`: two deterministic controls shared by both loops.
  (1) search trigger: the instructor's answer names an assignment-type word or a course file, so the
  interviewer must search before answering; (2) citation check: every chunk citation must be a
  passage retrieved this turn or cited earlier; every instructor citation a real message id.
- `lib/ai/agent/harness/pi-interview.ts`: pi-agent-core 1.4.0 in-process. Our tools as AgentTools;
  the reply is a `submit_turn` tool call (AuditResponse schema); `tool_choice` required, `submit_turn`
  forced when the budget is spent (pi-ai `samplingParams` passthrough); controls run inside
  `submit_turn` (a failed check is a tool error → the model retries, max 2); `finishTurn` forces
  `submit_turn` when the model answers in text.
- `lib/ai/agent/harness/codex-interview.ts` + `scripts/capture/harness-mcp-server.ts` +
  `scripts/capture/harness-codex-hook.ts`: `codex exec` 0.165.0 per turn with a temp CODEX_HOME; our
  prompt replaces Codex's instructions (`model_instructions_file`), shell tool and web search off,
  tools as a stdio MCP server, `--output-schema`; Stop hook = controls, PreToolUse hook = tool budget.
- `scripts/capture/interview-bench.ts`: `--loop vercel|pi|codex`, `--controls`, `--endpoint campus`;
  scores **bad citations** the same way for every loop.

## Results (quick set, 4 cases, GLM-5.3)

| Loop | Files cases searched | Files cases cited a file | Instructor case searched | Bad citations | Uncached in | Cached in | Out | Avg s/turn |
|---|---|---|---|---|---|---|---|---|
| Current loop | 0/3 | 1/3 | 0/1 | 1 | 45,780 | 90,112 | 8,153 | 14 |
| Pi, no controls | 1/3 | 2/3 | 1/1 | 0 | 64,750 | 331,840 | 19,501 | 32 |
| Pi + controls | 1/3 | 2/3 | 1/1 | 0 | 60,071 | 319,040 | 15,349 | 23 |
| Codex, no controls | 0/3 | 0/3 | 0/1 | 0 | 79,251 | 75,264 | 33,723 | 56 |

Four cases on one model: directional only. Runs vary (the same Pi case searched on one run and not
the next).

## Findings

**Pi**
- Fixed reply format held on every turn (via `submit_turn`). Overhead ≈ 0.5k tokens per request
  over our prompt (21.9k vs 21.3k on the current loop, same case).
- Controls attach cleanly and fired as designed: sent back to search when the instructor named a
  file; caught an invented instructor messageId; turned a text reply into a forced `submit_turn`.
  `finishTurn` ({action:'continue'}) and tool errors are the levers; both first-class in 1.4.0.
- More requests per turn → more cached input (cheap), uncached input +31% over the current loop.
  Part of that is GLM-specific: its first `submit_turn` usually carries only `finding`; Pi's own
  argument validation rejects it and the second try is complete (strict tool mode didn't stop it;
  the campus server seems not to enforce it). Expect fewer retries on Sol (OpenAI strict schemas).
- ESM-only: loaded with `import()` (scripts run as CommonJS under tsx).

**Codex**
- Works end to end; reply format held via `--output-schema`.
- **Overhead ≈ 4.3k tokens per request** even with our instructions replacing Codex's and the shell
  tool off (8.4k with defaults). Uncached input +73% and output ~4× the current loop on these cases;
  ~4× slower (56 s/turn). Effort was not pinned for GLM in either loop; Codex may default higher.
- **Two headless consent gates** (the class in ~/.claude/CLAUDE.md rule 5):
  1. MCP tools: `codex exec` runs with approval policy "never", so every call to our tools was
     refused ("MCP tool call requires approval, but approval policy is never") and the model
     answered without searching. Fix: `default_tools_approval_mode = "approve"` on our MCP server.
  2. Hooks: non-managed hooks need persisted trust (a `trusted_hash` per hook) or
     `--dangerously-bypass-hook-trust`. The Claude Code safety classifier blocked the flag, so
     **Codex's controls were not run**; the hook scripts are written but untested.
- Tools run in a separate process (MCP); the conversation is rendered into one prompt per turn
  (production would resume one thread per interview, with Codex owning the history and compaction).

**Both / the live app**
- **Prompt/tool mismatch (live bug):** `capture-chat-agent.md` tells the interviewer to cite
  `chunkId`, but search hits carry the id as `id` (`SearchHit` in `lib/capture/vector-store.ts`).
- The current loop cited a passage it had not retrieved (1 bad citation); nothing checks this today.
- The search trigger is crude: it missed 2070-104 (rubric quoted verbatim, no trigger word) and
  fired on the instructor-practice case 2070-024 ("projects"). The mechanism works; the rule needs
  design (e.g. match against the material list or the previous question's subject).

## Recommendation

Pi. It does what the owner wanted (controls the model can't skip) with almost no overhead, runs in
our process, and matches CUassistant. Codex brings real hooks (Stop can force continuation) but costs
~4.3k tokens per request before our prompt, is ~4× slower here, and needs two consent gates opened.

Next: owner decision on Pi vs Codex (and whether to allow the hook-trust bypass to test Codex's
controls); then a paid Sol run of the winner against the current loop (~0.8 credits, owner OK).

## Paid run: Sol and Terra at medium effort (2026-10-28, owner OK)

Quick set, scratch DB. Pi changes since the GLM run: the search trigger reads the previous question
too (and assignment codes like "A2–A3"); a text reply can't skip a pending search; separate retry
limits (search 1, citations 2); invalid citations dropped when retries run out; stable session id
for the prompt cache. Cache writes are now reported on their own (owner: count them separately for
the credit budget). The current loop's SDK path reports 0 writes: its "new input" includes them.

| Run | Files searched | Files cited | Instructor searched | Bad cites | New input (excl. writes) | Cache writes | Cache reads | Out | Est. $ (reads at 10%) | s/turn |
|---|---|---|---|---|---|---|---|---|---|---|
| Sol, current loop | 3/3 | 3/3 | 1/1 | 0 | 100,053 | 0 | 191,077 | 1,717 | 0.26 | 9.9 |
| Sol, Pi + controls | 3/3 | 3/3 | 1/1 | 0 | 1,008 | 104,354 | 176,698 | 2,025 | 0.27 | 10.8 |
| Terra, current loop | 2/3 | 2/3 | 1/1 | 0 | 108,693 | 0 | 155,974 | 1,999 | 0.13 | 8.4 |
| Terra, Pi + controls | 3/3 | 3/3 | 1/1 | 0 | 1,134 | 127,293 | 206,659 | 2,916 | 0.16 | 11.4 |

- **Sol medium:** both loops searched and cited everywhere; Pi's controls never had to act. Same
  tokens, cost and speed. On Sol, Pi is a safety net, not an improvement on these cases.
- **Terra medium:** the current loop missed 1020-016 (no search, no file citation). With Pi, the
  control sent 2070-104 back to search once ("lab reports") and every files case searched and
  cited, at about 60% of Sol's cost.
- **Cache writes:** on the gateway almost all of Pi's new input is reported as cache writes. Whether
  RCD bills writes differently from plain input is unknown; compare against the credits charged.
- Four cases: directional. Before any switch, run the full 9-case set and have a person read the
  questions (`--out` saves them).
