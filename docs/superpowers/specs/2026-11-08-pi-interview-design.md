# The interview on Pi — design

Date: 2026-11-08. Owner: "proceed with Pi" (2026-11-08); the move itself was decided on 2026-10-28 (Pi over Codex). This is Part 3 of `2026-11-01-local-models-and-role-benchmark-design.md`. It replaces the outline in `plans/2026-11-08-model-roles-part3-pi-converse-outline.md`.

## Why

The faculty interview depends on the model following its instructions: search the course files before answering, cite only what it retrieved, and ask one focused question. The live loop (Vercel AI SDK) now runs two checks after the fact, a forced first search and dropping bad citations. But it can't send the model back to fix a turn.

Pi (pi-agent-core, as CUassistant uses it) runs the turn as a loop with checks the model can't skip. A failed check is a tool error, and the model retries.

On the Oct 28 spike:
- Pi added about 0.5k tokens per request.
- Pi kept Terra searching and citing every time, at about 60% of Sol's cost. Terra on the plain loop missed one search.
- Pi kept the free GLM-5.3 searching and citing on 9 of 9 cases.

## Goals

- The interview runs on Pi in the live app, behind a setting. It must produce the same reply shape (`AuditResponse`), the same stored messages, and the same events to the chat screen as today.
- The checks run inside the loop. They cover the search trigger, citation validity (with the repair from Part 2 Task 5: re-point an invented messageId when the quote matches exactly one answer, and trim long quotes) and the reply format. A failed check sends the model back, within limits.
- **Faculty still see the reply appear as it is written.** The reply is the `submit_turn` tool call, so the chat streams its `finding` text from Pi's `toolcall_delta` events by parsing the partial JSON. Search and tool banners show as today.
- **Every model call carries a per-call token cap**, confirmed on the wire. In CUassistant, pi-agent-core dropped `maxTokens`; a test inspects the outgoing request.
- **The model can change between turns** (OpenAI ↔ campus), with the whole conversation so far. The later course switch needs this.
- **Benchmarked before it is turned on**, on the 9 interview cases, with a blind review of the questions. Campus models are free. Paid arms run one at a time, under the owner's per-run yes and a hard credit ceiling (`interview-bench --max-credits`, built 2026-11-08).

## Non-goals

- Other chat agents (Explore, the curriculum chat, KUD chat) stay on their loops. Each moves later as its own step, once the interview has run on Pi for a while. *(My call: one change at a time.)*
- No change to the interviewer's prompt beyond what Pi's `submit_turn` needs.
- No Codex.

## Anti-goals

- A turn that loops or retries without bound. Retry limits: search 1, citations 2, then the turn is saved with invalid citations dropped, as in the spike.
- A paid model run with no ceiling, or a provider fallback the setting didn't choose.
- A visible change in what faculty see other than steadier behavior.

## Design

- **Module:** `lib/ai/agent/pi/` holds the loop (from the spike's `harness/pi-interview.ts`), the controls (from `harness/controls.ts`, merged with the live `interview-controls.ts` so there is one copy of each rule), and the streaming adapter that turns Pi events into the existing `streamAuditAgent` events.
- **Entry point:** `streamAuditAgent` and `runAuditAgent` choose the loop from a setting: `interview_loop`, `'current' | 'pi'`, stored with the AI function settings for `capture-chat-agent` and shown on `/settings`. Default `current`. Flipping it back is the rollback.
- **Model and provider:** from the function's role routing (Part 2), so Pi gets an OpenAI-compatible base URL and model for OpenAI or campus. Pi talks to the endpoint itself, so the campus provider's missing `streamWithTools` (Part 2 Task 4) doesn't block Pi. It is still needed for the current loop on campus.
- **Messages:** user, assistant and tool rows go to `capture_messages` exactly as today, so the briefing, Generate, the checklist and the transcript views are unchanged.
- **Cost and telemetry:** the Pi loop fills `costUsdCents` from the token counts at the model's price, which it reports as 0 today, and records cache writes. The daily cap and `recordSpend` work as on the current loop.

## Rollout

1. Free: Qwen3.8 (thinking off), DeepSeek Flash (low) and GLM-5.3 (off and low) on Pi, 9 cases. The original spec required campus candidates to run on both loops. GLM is in because it searched and cited 9 of 9 on Pi on 2026-10-30; it failed Extract and Write on output format, which Pi's checks catch in the interview.
2. Paid, owner yes per run: a one-case Terra low + Pi probe, reading back the real credits. Then Terra low + Pi on 9 cases, then Terra medium + Pi on 9, each with `--max-credits`.
3. Blind Opus review of the questions across: stored Sol, Terra current loop (already run), Terra + Pi, and the campus models on Pi.
4. The owner reads, then picks the interview's model and loop.
5. Turn `interview_loop` to `pi` live. Watch the "dropped citation" and "forced search rejected" logs for a week.

## Decisions for the owner

- **Ship the loop setting live before the paid arms finish?** The default stays `current`, so shipping changes nothing until the setting is flipped. *My call: yes, ship it dark.*
- **Which model the interview runs on**, after the blind review in rollout step 3.

## Left to the builder

- How the partial-JSON parse of `finding` is done (a small incremental parser or a library), as long as only complete characters reach the screen.
- Where the merged controls live, and the test layout.
