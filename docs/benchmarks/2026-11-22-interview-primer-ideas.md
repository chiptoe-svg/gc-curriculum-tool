---
title: Interview prompt — Primer ideas plus answer-first
date: 2026-11-22
applies: capture-chat-agent
summary: Blind Opus judge on 29 replayed moments — campus Qwen3.8 preferred the new prompt 16 vs 7 (re-asks 1 vs 3); Terra medium a draw, 8 vs 9 with 11 ties (re-asks 2 vs 3).
---

Changes: a check before each question (what is known, what the last answer changed, is the planned question still needed, never re-ask a settled point unless the answer was unclear); first-time instructors skip questions that need classroom history; the synthesis turn opens with progress in words; when the instructor asks the interviewer something, answer it first (carried over alone from the shelved re-ask branch).

Replay (`scripts/capture/interview-bench.ts`, `--loop pi`, scratch DB `gc_curriculum_p2_scratch`): 13 GC 3400 full-arc moments, the 9 original moments, 7 PKSC 2200 re-ask turns (69–81). Baseline = dev prompt; changed = branch prompt. Blind Opus judge with A/B randomized per case, reading the conversation before each moment.

| Model | New preferred | Old preferred | Ties | Re-asks new / old | Credits |
|---|---|---|---|---|---|
| qwen3.8-27b-fp8 (campus) | 16 | 7 | 5 | 1 / 3 | 0 |
| gpt-6.1-terra medium | 8 | 9 | 11 | 2 / 3 | ≈1.84 |

Search and citation counts were identical between prompts on both models. Not exercised by these cases: the first-time-instructor skip and the progress line. Unverified: the answer-first rule (the bench stores the question, not the finding).

Source: STATE.md, "Primer paper ideas (2026-11-21)".
