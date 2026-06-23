# Slide-note vision benchmark — results (Spec A)

**Date:** 2026-06-23 · **Spec:** [`2026-06-23-slide-note-vision-benchmark-design.md`](../specs/2026-06-23-slide-note-vision-benchmark-design.md) · **Detail:** `~/.local/share/gc-curriculum-tool/vision-bench/README.md` + `scorecard.json`

## Setup
- **Corpus:** 20 real GC 1010 slides (5 decks — intro/careers/specialty/internship/salary), spanning title-divider, mixed-text-image, diagram, procedural, table-data.
- **Ground truth:** gpt-5.4 vision per slide (transcription + concepts + slideType + expectedContentLevel), operator-spot-checked.
- **Judge:** gpt-5.4, scoring each note vs ground truth on correctness / terminology / hallucination(↑=clean) / gate-accuracy (substantive-vs-low).
- **Candidates:** gemma-4-12B-qat-4bit, gemma-4-26B-A4B, Qwen3.6-27B, Qwen3.6-35B-A3B × schemas P1 (gist) / P2 (concept+terms); gemma also swept soft-token budgets {280, 560, 1120} on the patched stack (#1426/#1986). E-series gemmas excluded (vision-incapable).

## Headline numbers (fidelity = mean(correctness,terminology)/3)
| config | fidelity | gate | latency | mem |
|---|---|---|---|---|
| **gemma-12B-qat-4bit · P1 · budget 560** | **0.842** | **0.85** | 3.0s | ~7 GB |
| gemma-26B-A4B · P2 · 1120 | 0.842 | 0.65 | 4.1s | ~15 GB |
| gemma-12B · P1 · 280 (default, **shipped**) | 0.808 | 0.80 | 2.6s | ~7 GB |
| Qwen3.6-27B · P1 | 0.858 | 0.90 | ❌ 55s | ~15 GB |
| Qwen3.6-35B-A3B · P1 | 0.758 | 0.85 | ❌ 23.5s | ~15 GB |

## Findings
1. **The E4B→12B fix is validated.** The shipped `gemma-12B-qat-4bit` is a sound, light, fast slide-note model (0.808 / gate 0.80 at default resolution).
2. **Resolution helps the *describe* task only modestly (~+4%), unlike transcription.** 12B P1: 0.808 (b280) → **0.842 (b560)** → 0.817 (b1120) — **560 is the sweet spot, 1120 adds noise.** Describing "what a slide teaches" captures the gist at modest resolution; reading every word (transcription, Spec B) is where the knob is dramatic. The Qwen models ran at ~8,900 image tokens vs gemma's ~280 default — the initial matrix unfairly handicapped gemma until the knob was applied.
3. **P2 (concept+terms) didn't help** and hurt the content-level gate; **26B's extra memory isn't justified.**
4. **Gate accuracy (~0.65–0.90) is the universal weak spot** — a prompt-tuning issue, not a model choice.

## Verdict
- **Bench winner: `gemma-12B-qat-4bit · P1 · budget 560`** (0.842 / gate 0.85 / 3s / 7 GB) — but it **requires the patched omlx** (resolution knob = productionizing path B), whose blast radius (nanoclaw + voicelab E4B-audio) is deferred.
- **Kept in production: the shipped `gemma-12B-qat-4bit` at default resolution** (0.808 / gate 0.80) — solid, light, zero infra risk.
- **Adopt 12B@560 if/when the patched omlx is productionized for other reasons** (the PRs merge upstream, or Spec B's local transcription path lands). The ~+4% describe-task gain doesn't justify the shared-omlx upgrade on its own.
- Optional follow-up: tune the substantive/low gate prompt.

Spec A is **complete**: the bug it existed to catch (E4B never ingested images) is fixed and live; the model/schema/resolution space is mapped; no change beyond the shipped 12B is warranted now.
