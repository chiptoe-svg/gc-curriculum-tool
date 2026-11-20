---
title: Interview on Terra medium with the Pi loop
date: 2026-11-19
applies: capture-chat-agent, role:converse
summary: GC 3400 replay, blind review: Terra medium 90% acceptable vs Sol medium 87%, at about 0.33 vs 0.75 credits per 13 turns.
---

GC 3400 13-moment replay (`scripts/capture/interview-bench.ts`), blind Opus review:

| Setup | Acceptable | Mean |
|---|---|---|
| Sol medium, current loop | 87% | 3.51 |
| Terra medium, Pi loop | 90% | 3.44 |
| Qwen 3.8 | 81% | 3.08 |
| DeepSeek | 69% | 3.03 |

About 0.33 vs 0.75 credits per 13 turns (Terra vs Sol). PKSC 2200 late turns: Terra 5/5 acceptable, mean 3.60,
no re-asks (stored October Sol 3/5, 2.60).

The Converse role itself stays on Sol medium (the 87% row above).

Undo: Reset on the interview row. Source: STATE.md, "Interview runs on Terra medium, Pi loop (2026-11-19)".
