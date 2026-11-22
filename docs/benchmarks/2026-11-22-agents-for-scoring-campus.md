---
title: Agents for scoring on campus models
date: 2026-11-22
applies: role:judge
summary: Neither a tool agent nor a single call plus checker brought DeepSeek Flash or Qwen3.8 close to the stored Sol scores — blind Opus preference 17–37% excluding ties; no arm adopted.
---

Question (spec `docs/superpowers/specs/2026-11-22-agents-vs-single-calls-design.md`): does a tool-using agent, or a single call plus an independent evidence checker, let a free campus model score coverage as well as the stored Sol scores?

Setup (`scripts/bench/agent-judge.ts`, campus only, $0): 10 GC courses with post-2026-10-19 Sol scores and at least 6 course files (GC 1010, 1020, 1040, 2070, 2400, 3620, 3710, 3740, 4440, 4800); all their competencies (202 cells); 3 runs per arm; DeepSeek Flash (low) and Qwen3.8 (off). Arms: today's single call; a Pi tool agent (search files, check quotes, 6-call cap); the single call plus a checker that never sees the scores and caps them in code. Blind Opus judges compared each arm's modal cell with the stored Sol cell against the course profile and files (A/B shuffled, key held back); 762 of 1,212 pairs were identical and recorded as ties, 450 judged.

| Arm / model | Preferred over Sol (ex-ties) | Wins / losses / ties | Evidence-break rate | Stability |
|---|---|---|---|---|
| single / DeepSeek low | 36.7% | 18 / 31 / 153 | 0.0% | 0.94 |
| agent / DeepSeek low | 36.4% | 16 / 28 / 158 | 0.0% | 0.93 |
| checker / DeepSeek low | 29.8% | 14 / 33 / 155 | 0.4% | 0.96 |
| single / Qwen3.8 off | 20.4% | 11 / 43 / 148 | 1.5% | 0.96 |
| agent / Qwen3.8 off | 23.7% | 14 / 45 / 143 | 1.0% | 0.95 |
| checker / Qwen3.8 off | 17.3% | 9 / 43 / 150 | 1.0% | 0.97 |

Stored Sol: 0 evidence breaks. Decision rule (pre-committed): no arm adopted — none beat Sol's break rate and none reached 50% preference. Verdict is against stored Sol cells; a Terra single-call run would make it final against today's live scorer, but no campus arm came near enough to justify paid arms.

What the agents actually did: only 1–2% of their evidence quotes came from course files (the rest from the profile), and 89 of 180 agent/checker tasks hit the tool-call cap and were forced to submit. The agents searched but rarely changed their answers on what they found. Judge position check: A won 55.1% of non-tie verdicts (mild). Known limitation: the same Sol cell recurs in several scattered pairs.

Not tested here: Terra agents (paid; not justified by these results); wiki pages (next phase of the plan).

Source: run `~/.local/share/gc-curriculum-tool/agent-bench/2026-11-22-scoring/`; plan `docs/superpowers/plans/2026-11-22-agents-vs-single-calls.md`.
