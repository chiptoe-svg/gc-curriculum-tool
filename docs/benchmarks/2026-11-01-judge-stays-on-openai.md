---
title: Scoring stays on OpenAI, not campus models
date: 2026-11-01
applies: role:judge
summary: Campus models lost to Sol on 10 held-out courses: a blind review backed Sol 11 times to 4, with 7 evidence-rule breaks vs 0.
---

Six campus setups re-scored 5 courses against Sol's 2026-10-19 cells (`scripts/bench/role-judge.ts`). A blind
Opus review favored them there, but on 10 held-out courses DeepSeek Flash low lost to Sol: the blind review
backed Sol 11 times vs 4 on the frozen set, with 7 evidence-rule breaks vs 0.

A separate evidence fact-check call (`scripts/bench/judge-factcheck.ts`) cut breaks to 2 vs Sol's 1 but could not
fix the model's one-level over-scoring where evidence exists (backed Sol 7, DeepSeek 4). A campus-only prompt
paragraph naming the mistakes did not help and was dropped.

Source: STATE.md, "Local models and role benchmark (2026-11-01)".
