---
title: Agents for wiki pages on campus models
date: 2026-11-22
applies: role:write
summary: No campus arm matches the live Terra wiki pages — blind Opus preference 0–50% excluding ties; live wins every target and competency page. The DeepSeek agent cuts code-found fact errors (15 → 2 pages of 42) but still loses in blind review; no arm adopted.
---

Question (spec `docs/superpowers/specs/2026-11-22-agents-vs-single-calls-design.md`): does a tool agent, or a single call plus an independent checker, let a free campus model write wiki pages as well as today's live wiki (Terra medium, rebuilt 2026-11-19)?

Setup (`scripts/bench/agent-wiki.ts`, campus only, $0): 14 pages — the 13 writable pages from the 2026-11-19 wiki review (2 competency, 5 target, 7 course) plus problem-solving; 3 runs per arm; DeepSeek Flash (low) and Qwen3.8 (off). Arms: today's single call; a Pi tool agent with `read_snapshot_facts` and `check_page` (6-call cap); the single call plus a checker that reads the facts and rewrites. Data: `gc_curriculum_bench_20261122`, a fresh copy of the live database made the same day (page facts verified identical to live). The wiki repository was read only.

Method note: a first run on the older bench copy (`gc_curriculum_builder_scratch`, 2026-10-29) was discarded — that copy lacked GC 4400's coverage and the professional-readiness scores, so the live pages were marked wrong for facts that are true on live.

## Code-checked fact errors

| Arm / model | Pages written | Pages with ≥1 error | Errors / page | Lint errors / page | s / page |
|---|---|---|---|---|---|
| live wiki (Terra) | 14 / 14 | — | 0.14 | 0.29 | — |
| single / DeepSeek low | 42 / 42 | 15 | 2.90 | 0.26 | 16 |
| agent / DeepSeek low | 42 / 42 | 2 | 1.60 | 0.14 | 18 |
| checker / DeepSeek low | 41 / 42 | 7 | 1.61 | 0.24 | 22 |
| single / Qwen3.8 off | 42 / 42 | 3 | 0.14 | 0.29 | 22 |
| agent / Qwen3.8 off | **14 / 42** | 1 | 1.21 | 0.14 | 19 |
| checker / Qwen3.8 off | 37 / 42 | 4 | 0.22 | 0.27 | 30 |

Errors are mostly course lists that leave courses out (each omitted course counts once) and prerequisites not in the data. The agent and checker can check drafts against the grader's own function, so their counts are not independent (ruling R13). The Qwen agent failed on 28 of 42 pages: it kept calling tools and never submitted, even when the loop forced submission (same in the discarded run: 26 of 42).

## Blind review (decisive)

Claude Opus judges, blind (7 page-grouped batches, 78 pairs; second judge on 16; instructions `docs/superpowers/plans/2026-11-22-blind-judge-prompt-wiki.md`), compared each arm's first successful page with the live page, checking both against the facts and the database.

| Arm / model | Preferred over live (ex-ties) | Wins / losses / ties |
|---|---|---|
| checker / DeepSeek low | 50.0% | 7 / 7 / 0 |
| single / DeepSeek low | 22.2% | 2 / 7 / 5 |
| agent / DeepSeek low | 18.2% | 2 / 9 / 3 |
| single / Qwen3.8 off | 10.0% | 1 / 9 / 4 |
| checker / Qwen3.8 off | 0.0% | 0 / 8 / 6 |
| agent / Qwen3.8 off | 0.0% | 0 / 5 / 3 |

By page type: live won **every** target page (28 of 28 decided) and the competency pages (problem-solving 6/6; professional-readiness 3 of 5). Course pages were mostly ties (21 of 39); arms won 10 and live 8. Typical reasons live won: campus pages misstated which courses carry a competency ("rests on one course" when the data shows two to four), invented course titles, invented a prerequisite (GC 1050 "students have already completed GC 1020"), or over-read the scores (calling a one-level gap a dissociation).

Second judge: same verdict on 15 of 16 pairs. Judge position check: A won 54.4% of non-tie verdicts.

**Decision rule: no arm adopted.** None has fewer fact errors than live (0.14 / page) and none is preferred over live (the DeepSeek checker's 50% comes almost entirely from course-page front matter; see below).

## Side finding — live course pages under-list career targets

Most arm wins on course pages were the front-matter field `contributes_to_targets`: the live pages for GC 1010, 2070, 3710 and 4800 list no targets and GC 3730 lists two, while the data shows each course contributing to all five targets. That is a defect in the live wiki's course pages, independent of this benchmark (recorded in STATE.md Deferred).

## Conclusion

Wiki writing stays on Terra. A tool agent helps a weak campus writer catch its own count and list errors (DeepSeek 15 → 2 pages), but code-checkable facts are not the main gap: the campus pages lose on reading the data correctly (which courses carry what, at what depth), which the checks do not cover. Qwen's single call is accurate on the code checks but loses on judgment. A Terra agent arm is not justified by these results.

Source: run `~/.local/share/gc-curriculum-tool/agent-bench/2026-11-22-wiki-fresh/` (summary.md, tally.txt, judge/); discarded first run `…/2026-11-22-wiki/`; plan `docs/superpowers/plans/2026-11-22-agents-vs-single-calls.md`.
