---
title: Extract work on campus Qwen3.8
date: 2026-11-01
applies: parse-profile-fields, materials-analysis, decompose-prereq-gap
summary: Campus Qwen3.8 (thinking off) was acceptable on 6/6 syllabus parses, 5/6 material analyses (stored gpt-5.4: 4/6) and 5/6 prerequisite-gap merges, all under 5 s.
---

`scripts/bench/role-extract.ts`, blind Opus review against the source.

- GLM-5.3 (off) is out: 11 of 44 calls failed the schema.
- Qwen3.8 (off) is the best campus pick: acceptable on 6/6 syllabus-field parses (ranked best on all 6), 5/6
  material analyses (stored gpt-5.4: 4/6, two with invented evidence) and 5/6 prerequisite-gap merges
  (DeepSeek 3/6, gpt-oss 2/6), all under 5 s.
- Samples are small (6–9 per function).

Owner decision 2026-11-01: parse-profile-fields, materials-analysis and decompose-prereq-gap move to campus
Qwen3.8 (thinking off), with the OpenAI fallback kept.

Source: STATE.md, "Extract result (2026-11-01)".
