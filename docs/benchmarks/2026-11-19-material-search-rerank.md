---
title: Reranking material search
date: 2026-11-19
applies: search:rerank
summary: On a 17-question gold set, reranking raised the top-hit rate from 41% to 59% (MRR@10 0.572 → 0.648) for about 0.3 s more per search.
---

The interviewer's material search fetches 50 candidates from Weaviate hybrid search, reranks them with RCD
`qwen3-rerank-4b` on the passage text, and returns the top k. A reranker failure falls back to hybrid order.

Measured on rag-core's 17-question curriculum gold set against the live index (`scripts/capture/eval-goldset.ts`):

| | Hybrid only | Reranked |
|---|---|---|
| hit@1 | 41% | 59% |
| hit@3 | 71% | 65% |
| hit@5 | 12/17 | 12/17 |
| hit@10 | 88% | 88% |
| MRR@10 | 0.572 | 0.648 |

About +0.3 s per search. Adding "file > section" before the passage lowered hit@1 to 53%, so it is not used.
17 questions is a small set; a GC 3400 gold set is planned before further tuning.

Source: STATE.md, "Material search reranked (2026-11-19)".
