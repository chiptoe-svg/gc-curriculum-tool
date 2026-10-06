# Model evaluation: coverage scoring and course profiles (2026-10-05/06)

**Decision (owner, 2026-10-06):** coverage scoring (`program-score-coverage`) and course profiles (`capture-scores`) move to **gpt-6.1-sol at low reasoning effort**. Set as `custom` rows in `ai_function_settings`; `lib/ai/openai.ts` defaults gpt-6.1-sol to low effort. Both are single structured API calls (no tool use), which is why Sol works there; the capture interview is a tool-using agent and stays on gpt-5.4 until it moves to the stateless Responses API.

## 1. Coverage scoring: consistency and cost
Five course × target pairs, five independent runs per setup, run interleaved. Metric unchanged from June: full band agreement, meaning every run lands in the same depth band (none 0 / low 1–2 / working 3 / high 4–5). Raw data: `2026-10-05-model-evaluation.json`.

| Setup | Agreement K / U / D | Evidence problems | $ per call | s per call | Lower / higher band than gpt-5.5 (of 90) |
|---|---|---|---|---|---|
| gpt-5.5 (previous) | 73 / 77 / 77 | 0 | 0.097 | 26 | — |
| gpt-6.1-sol low | 83 / 80 / 93 | 0 | 0.020 | 24 | 18 / 2 |
| gpt-6.1-sol medium | 73 / 83 / 87 | 0 | 0.022 | 29 | 20 / 2 |
| gpt-6.1-sol high | 80 / 80 / 93 | 3 excerpts not in profile | 0.037 | 67 | 22 / 3 |

All Sol setups passed the pre-registered rule. That rule measures consistency, not correctness, so the owner asked for a correctness check (section 2).

## 2. Coverage scoring: blind evidence check
The 20 cells where gpt-5.5 and Sol low landed in different modal bands were judged blind by a Claude subagent, a different model family from both. The judge saw the depth rubric, the scoring prompt and the course profile, with the two scores labelled X and Y in random order. Files: `2026-10-06-adjudication/` (cases, verdicts, key).

| | gpt-5.5 | Sol low |
|---|---|---|
| Judge sided with | 5 | 14 (1 both defensible) |
| Gave the higher score | 18 | 2 |
| Higher score broke the evidence-above-zero rule | 8 | 0 |

Judge's notes:
- Neither scorer credits syllabus aspiration outright. The common failure is matching to the nearest topic. gpt-5.5 breaks the rule mostly on Understand.
- Sol sometimes carries a related competency's score too far, but less often than gpt-5.5.
- 20 cases is small; read the margin as indicative.

## 3. Course profiles
Three courses × three runs. Production then was gpt-5.4. Lean rerun in `2026-10-05-profile-model-evaluation.json`.

| | gpt-5.4 | Sol low |
|---|---|---|
| Cost (9 runs) | $1.67 | $0.88 |
| s per call | 124 | 137 |
| Competencies resting only on "inferred" | 30.5% | 12.7% |
| Failures | 0 | 0 |

No blind evidence check was run on profiles. The decision rests on cost, grounding, and the coverage result.

## 4. Light tier
gpt-6-luna was tested against gpt-5.4-mini for material digests (`2026-10-05-light-model-evaluation*.json`). The owner kept gpt-5.4-mini.

## Consequences
- Coverage numbers are expected to fall: Sol scores closer to the evidence.
- The pending re-score runs entirely on Sol, so old (gpt-5.5) and new scores are not mixed.
