---
title: File classification on campus DeepSeek Flash
date: 2026-11-09
applies: material-classify
summary: On what the live app sends, DeepSeek Flash (off) matched or beat gpt-5.4-mini; on linked videos and documents it beat Qwen3.8, 137 vs 110 of 155.
---

`scripts/bench/classify-holdout.ts`: the tier each model picks (high / middle / background) vs the stored tier,
fed what the live classifier sends.

- On file names and types only, DeepSeek Flash (thinking off) matched or beat gpt-5.4-mini.
- On linked videos and documents with their opening text, it beat Qwen3.8: 137 vs 110 of 155.

Deployed 2026-11-09 (`825b9b50`) with gpt-5.4-mini as the fallback if campus fails.

Source: `lib/ai/function-settings.ts` (FUNCTION_PROVIDER_DEFAULTS) and STATE.md.
