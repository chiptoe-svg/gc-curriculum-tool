---
title: Sol low for scoring and course profiles
date: 2026-10-05
applies: capture-scores, role:extract
summary: Sol low kept depth bands steadier than gpt-5.5 (K/U/D 83/80/93% vs 73/77/77), won a blind evidence check 14 to 5, and cost $0.020 vs $0.097 per call.
---

Owner decision 2026-10-06: coverage scoring and course profiles move to gpt-6.1-sol at low reasoning effort.

## Coverage scoring: consistency and cost

Five course × target pairs, five runs per setup. Agreement = every run lands in the same depth band.

| Setup | Agreement K / U / D | Evidence problems | $ per call | s per call |
|---|---|---|---|---|
| gpt-5.5 (previous) | 73 / 77 / 77 | 0 | 0.097 | 26 |
| gpt-6.1-sol low | 83 / 80 / 93 | 0 | 0.020 | 24 |
| gpt-6.1-sol medium | 73 / 83 / 87 | 0 | 0.022 | 29 |
| gpt-6.1-sol high | 80 / 80 / 93 | 3 excerpts not in profile | 0.037 | 67 |

## Blind evidence check

The 20 cells where gpt-5.5 and Sol low disagreed were judged blind by a Claude subagent.

| | gpt-5.5 | Sol low |
|---|---|---|
| Judge sided with | 5 | 14 (1 both defensible) |
| Gave the higher score | 18 | 2 |
| Higher score broke the evidence-above-zero rule | 8 | 0 |

20 cases is small; read the margin as indicative.

## Course profiles

Three courses × three runs: gpt-5.4 $1.67 vs Sol low $0.88 for 9 runs; competencies resting only on
"inferred" 30.5% vs 12.7%; no failures. No blind check was run on profiles.

## Extract role

gpt-6-luna was tested against gpt-5.4-mini for material digests; the owner kept gpt-5.4-mini.

Source: `docs/superpowers/audits/2026-10-05-model-evaluation.md` (raw data in the JSON files beside it).
