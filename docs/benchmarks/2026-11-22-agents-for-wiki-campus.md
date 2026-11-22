---
title: Agents for wiki pages on campus models
date: 2026-11-22
applies: role:write
summary: The DeepSeek Flash tool agent wrote 42 of 42 pages with no code-found fact errors (single call: 9 pages with errors), but the blind comparison with the live wiki is confounded by a stale bench database; no arm adopted yet.
---

Question (spec `docs/superpowers/specs/2026-11-22-agents-vs-single-calls-design.md`): does a tool agent, or a single call plus an independent checker, let a free campus model write wiki pages as well as today's live wiki (Terra medium, rebuilt 2026-11-19)?

Setup (`scripts/bench/agent-wiki.ts`, campus only, $0): 14 pages — the 13 writable pages from the 2026-11-19 wiki review (2 competency, 5 target, 7 course; the review's targets index can't be written by the arms) plus problem-solving; 3 runs per arm; DeepSeek Flash (low) and Qwen3.8 (off). Arms: today's single call; a Pi tool agent with `read_snapshot_facts` and `check_page` (6-call cap); the single call plus a checker that reads the facts and rewrites. Facts and data come from the bench database `gc_curriculum_builder_scratch` (copied 2026-10-29). The wiki repository was read only.

## Code-checked fact errors (same database for every arm)

| Arm / model | Pages written | Pages with ≥1 error | Errors / page | Lint errors / page | s / page |
|---|---|---|---|---|---|
| single / DeepSeek low | 42 / 42 | 9 | 1.19 | 0.26 | 20 |
| agent / DeepSeek low | 42 / 42 | **0** | 0.00 | 0.14 | 24 |
| checker / DeepSeek low | 39 / 42 | 8 | 1.56 | 0.26 | 32 |
| single / Qwen3.8 off | 42 / 42 | 3 | 0.14 | 0.14 | 13 |
| agent / Qwen3.8 off | **16 / 42** | 3 | 0.31 | 0.00 | 15 |
| checker / Qwen3.8 off | 36 / 42 | 3 | 0.17 | 0.22 | 27 |

Most errors are course lists that leave courses out ("contributing courses" omitting 5–10 courses counts each omission) and prerequisites not in the data. The agent and checker can check drafts against the same function the grader uses, so their counts are not independent (ruling R13). The Qwen agent failed on 26 of 42 pages: it kept calling tools and never submitted, even when the loop forced submission. Missing pages from the checker are the writer omitting the page.

## Blind review — confounded

Blind Opus judges (7 batches + a second judge on 16 pairs; instructions `docs/superpowers/plans/2026-11-22-blind-judge-prompt-wiki.md`) compared the first successful page of each arm with the current live page, checking both against the bench facts. Every arm was preferred over the live page (69–100% excluding ties).

**This is not a valid result.** The bench database is older than the data the live pages were written from. Read-only comparison of the page facts (2026-11-22): live has GC 4400 contributing to all five target pages (21 courses; bench has 20) and 7 courses contributing to professional readiness (bench: 0). Judges' reasons show the live pages lost mainly for exactly those facts ("includes gc-4400 … facts list 20 courses", "unsupported professional-readiness link"). The live page was marked down for being right about live data. The problem-solving live page (built from a fixed template; not effectively blind) won 5 of 6.

Second-judge agreement: 100% on four arms, 67% on DeepSeek single and agent (16-pair sample). Judge position check: A won 45.3% of non-tie verdicts.

## What can be said

- Within the same snapshot, the DeepSeek agent removed the code-found fact errors that the DeepSeek single call makes (0 vs 9 pages), at about 20% more time and no credits. The checker did not help.
- Qwen's single call is already accurate on these checks; the Qwen agent is unusable as built (no submit).
- Decision rule: **no arm adopted** — the blind comparison with live is invalid, and the rule needs it.

## To make it decisive

Re-run on a fresh bench copy of the live database (free, ~2 h), so the live pages and the arms are checked against the same data, then blind-judge again (Opus, ~8 judge runs). Optionally a Terra single-call arm on that copy (~1.5 credits, owner's yes) as the "live setup" written on identical data.

Source: run `~/.local/share/gc-curriculum-tool/agent-bench/2026-11-22-wiki/` (summary.md, tally.txt, judge/); plan `docs/superpowers/plans/2026-11-22-agents-vs-single-calls.md`.
