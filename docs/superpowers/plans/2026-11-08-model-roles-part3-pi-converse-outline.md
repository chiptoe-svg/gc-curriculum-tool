# Model Roles Part 3 — Pi for Converse — Outline (pre-spec)

> Not an executable plan yet. The parent spec (`docs/superpowers/specs/2026-11-01-local-models-and-role-benchmark-design.md`, Part 3) says Part 3 gets its own spec and plan after Part 1's Converse results. This outline records what is known, so the spec can be written fast when the owner sets the timing.

## Where things stand (2026-11-08)

- **Decided** (owner, 2026-10-28): the interviewer moves to Pi; Codex is not pursued. Timing is open.
- **Spike:** `spike/interview-harness` runs Pi 1.4.0 with the search and citation checks. As of 8867b0b1 the campus provider there honors `requireToolFirst`; `4632409b` records raw citations per case.
- **Part 1 Converse result:** campus Qwen3.8 (thinking off) passed on the *current* loop. It searched 7/7 and cited 6/7, and a blind pre-screen ranked it best twice. So the course switch does not wait for Pi (spec: "If a campus model passes on the current loop, the switch can ship before Pi"). The owner's blind read (Sol vs Terra vs Qwen3.8 off) is still pending and decides Converse routing.
- **No campus model has run on the Pi loop yet.** The spec's candidate table calls for each Converse candidate on both loops.

## Work the spec will need to cover

1. **Production Pi loop module.** Lift the spike's loop into `lib/ai/agent/`, behind the same `streamAuditAgent` event contract (`session`, deltas, tool banners, `final`), so `CaptureChatPanel` doesn't change.
2. **Per-call token cap on the wire.** Confirm Pi's per-call cap reaches the request. In CUassistant, pi-agent-core dropped `maxTokens`. Add a test that inspects the outgoing request.
3. **Model change mid-conversation.** With Pi the transcript carries across a provider or model change, which the course switch needs when it is toggled mid-interview. Test it with an OpenAI → campus → OpenAI sequence.
4. **Controls parity.** Forced first search, citation validity and the Part 2 Task 5 repair, and the readiness checklist must all behave the same on Pi as on the current loop.
5. **Benchmark on Pi.** Run Qwen3.8 off and DeepSeek low through `interview-bench.ts --loop pi` on the same 9 cases, with a blind Opus review against the current-loop runs.
6. **Rollout.** The interview first, behind a flag; then the other chat agents (Explore, curriculum chat, KUD chat), each as its own step.

## Decisions for the owner before the spec

- **Timing:** start now, or after Part 2a ships.
- **Whether campus Converse should ship on the current loop first** (possible today) or only on Pi.
- **Whether the other chat agents move with the interview** or one at a time.
