# A6 Reliability Study — Parts i + ii
*Run 2026-06-12 | Completed 2026-06-12*

## Methods

**What was held fixed across runs:** identical context object (course catalog row, materials text, prior capture profile, prerequisite capture profiles, latest session ID + full transcript). The only variable is the model's sampling temperature (which the provider does not override — OpenAI default applies).

**Read-only discipline:** the script called `generateCaptureProfileV2` and `scoreSnapshotAgainstTarget` directly (same functions the routes call), but did NOT call `upsertCaptureProfile` or `upsertCoverageCell`. The only write was `recordSpend` to keep the cost ledger honest.

**N:** 5 runs per course / per pair.

**Courses (Part 1 — synthesis):** GC 3800, GC 4060, GC 3460.

**Pairs (Part 2 — coverage scorer):** GC 3800 × Account Management, GC 3800 × Brand Strategy.

**Model:** OpenAI (function-routed via `AI_PROVIDER=openai`).

**Limitations:** N=5, 3 courses, same-model runs measure *stability* not *validity*. Human-rater Part iii still pending.

**Total cost:** $2.2016 (22016 1/100-cent units).

## Part 1 — Synthesis Stability (N=5 per course)

### GC 3800

**Model:** gpt-5.4

**(a) Technical competency count**
| Run | Count |
|-----|-------|
| 1 | 6 |
| 2 | 6 |
| 3 | 6 |
| 4 | 6 |
| 5 | 6 |
| **Mean** | **6.00** |
| Range | 6–6 |

**(b) Baseline foundational competencies — D-depth per run**
| Foundational | Run 1 | Run 2 | Run 3 | Run 4 | Run 5 | Mean | SD | Band Agree |
|---|---|---|---|---|---|---|---|---|
| Agency | 2 | 2 | 2 | 2 | 2 | 2.00 | 0.00 | 100.0% |
| Attention to Detail | 3 | 3 | 3 | 3 | 3 | 3.00 | 0.00 | 100.0% |
| Resilience | 0 | 0 | 0 | 0 | 0 | 0.00 | 0.00 | 100.0% |
| Curiosity | 1 | 1 | 1 | 1 | 1 | 1.00 | 0.00 | 100.0% |
| Communication | 3 | 3 | 3 | 3 | 3 | 3.00 | 0.00 | 100.0% |

**(c) Per-dimension depth distribution (mean K/U/D over technical competencies)**
| Run | Mean K | Mean U | Mean D |
|-----|--------|--------|--------|
| 1 | 2.33 | 1.33 | 1.83 |
| 2 | 2.33 | 1.33 | 1.83 |
| 3 | 2.33 | 1.33 | 1.83 |
| 4 | 2.33 | 1.33 | 1.83 |
| 5 | 2.33 | 1.33 | 1.83 |
| **Across-run SD** | **0.00** | **0.00** | **0.00** |

**(d) Statement-set stability**
| Metric | Value |
|--------|-------|
| Mean pairwise Jaccard (all tech statements) | 0.22 |
| Matched pairs (Jaccard > 0.6) | 60 |
| Mean |ΔK| on matched pairs | 0.00 |
| Mean |ΔU| on matched pairs | 0.00 |
| Mean |ΔD| on matched pairs | 0.00 |
| Max |ΔK| on matched pairs | 0.00 |
| Max |ΔU| on matched pairs | 0.00 |
| Max |ΔD| on matched pairs | 0.00 |

**(e) Incoming expectations count**
| Run | Count |
|-----|-------|
| 1 | 0 |
| 2 | 0 |
| 3 | 0 |
| 4 | 0 |
| 5 | 0 |
| **Mean** | **0.00** | Range 0–0 |

### GC 4060

**Model:** gpt-5.4

**(a) Technical competency count**
| Run | Count |
|-----|-------|
| 1 | 10 |
| 2 | 10 |
| 3 | 10 |
| 4 | 10 |
| **Mean** | **10.00** |
| Range | 10–10 |

**(b) Baseline foundational competencies — D-depth per run**
| Foundational | Run 1 | Run 2 | Run 3 | Run 4 | Run 5 | Mean | SD | Band Agree |
|---|---|---|---|---|---|---|---|---|
| Agency | 2 | 2 | 2 | 2 | — | 2.00 | 0.00 | 100.0% |
| Attention to Detail | 2 | 2 | 2 | 2 | — | 2.00 | 0.00 | 100.0% |
| Resilience | 1 | 1 | 1 | 1 | — | 1.00 | 0.00 | 100.0% |
| Curiosity | 1 | 1 | 1 | 1 | — | 1.00 | 0.00 | 100.0% |
| Communication | 3 | 3 | 3 | 3 | — | 3.00 | 0.00 | 100.0% |

**(c) Per-dimension depth distribution (mean K/U/D over technical competencies)**
| Run | Mean K | Mean U | Mean D |
|-----|--------|--------|--------|
| 1 | 4.00 | 2.90 | 3.00 |
| 2 | 4.00 | 2.90 | 3.00 |
| 3 | 4.00 | 2.90 | 2.90 |
| 4 | 4.00 | 2.90 | 3.00 |
| **Across-run SD** | **0.00** | **0.00** | **0.05** |

**(d) Statement-set stability**
| Metric | Value |
|--------|-------|
| Mean pairwise Jaccard (all tech statements) | 0.18 |
| Matched pairs (Jaccard > 0.6) | 58 |
| Mean |ΔK| on matched pairs | 0.00 |
| Mean |ΔU| on matched pairs | 0.00 |
| Mean |ΔD| on matched pairs | 0.05 |
| Max |ΔK| on matched pairs | 0.00 |
| Max |ΔU| on matched pairs | 0.00 |
| Max |ΔD| on matched pairs | 1.00 |

**(e) Incoming expectations count**
| Run | Count |
|-----|-------|
| 1 | 4 |
| 2 | 4 |
| 3 | 5 |
| 4 | 4 |
| **Mean** | **4.25** | Range 4–5 |

### GC 3460

**Model:** gpt-5.4

**(a) Technical competency count**
| Run | Count |
|-----|-------|
| 1 | 10 |
| 2 | 10 |
| 3 | 10 |
| 4 | 10 |
| 5 | 10 |
| **Mean** | **10.00** |
| Range | 10–10 |

**(b) Baseline foundational competencies — D-depth per run**
| Foundational | Run 1 | Run 2 | Run 3 | Run 4 | Run 5 | Mean | SD | Band Agree |
|---|---|---|---|---|---|---|---|---|
| Agency | 2 | 2 | 2 | 2 | 2 | 2.00 | 0.00 | 100.0% |
| Attention to Detail | 4 | 4 | 4 | 4 | 4 | 4.00 | 0.00 | 100.0% |
| Resilience | 4 | 4 | 4 | 4 | 4 | 4.00 | 0.00 | 100.0% |
| Curiosity | 1 | 1 | 1 | 1 | 1 | 1.00 | 0.00 | 100.0% |
| Communication | 3 | 3 | 3 | 3 | 3 | 3.00 | 0.00 | 100.0% |

**(c) Per-dimension depth distribution (mean K/U/D over technical competencies)**
| Run | Mean K | Mean U | Mean D |
|-----|--------|--------|--------|
| 1 | 3.80 | 2.70 | 3.20 |
| 2 | 3.80 | 2.70 | 3.20 |
| 3 | 3.90 | 2.60 | 3.20 |
| 4 | 3.90 | 2.70 | 3.30 |
| 5 | 3.90 | 2.60 | 3.20 |
| **Across-run SD** | **0.05** | **0.05** | **0.04** |

**(d) Statement-set stability**
| Metric | Value |
|--------|-------|
| Mean pairwise Jaccard (all tech statements) | 0.18 |
| Matched pairs (Jaccard > 0.6) | 100 |
| Mean |ΔK| on matched pairs | 0.06 |
| Mean |ΔU| on matched pairs | 0.06 |
| Mean |ΔD| on matched pairs | 0.04 |
| Max |ΔK| on matched pairs | 1.00 |
| Max |ΔU| on matched pairs | 1.00 |
| Max |ΔD| on matched pairs | 1.00 |

**(e) Incoming expectations count**
| Run | Count |
|-----|-------|
| 1 | 4 |
| 2 | 4 |
| 3 | 4 |
| 4 | 3 |
| 5 | 3 |
| **Mean** | **3.60** | Range 3–4 |

## Part 2 — Coverage Scorer Stability (N=5 per pair)

### GC 3800 × Account Management

**Snapshot:** `126227e0` | **Model:** gpt-5.4-mini

**Pair-level summary (5 sub-competencies)**
| Metric | K | U | D |
|--------|---|---|---|
| Full band agreement (all 5 runs same band) | 0.0% | 0.0% | 0.0% |
| Within ±1 integer | 40.0% | 100.0% | 100.0% |

**Per sub-competency breakdown**
| Sub-competency ID | K SD | U SD | D SD | K MeanΔ | U MeanΔ | D MeanΔ | K MaxSpread | U MaxSpread | D MaxSpread | K Band% | U Band% | D Band% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| client-needs | 0.89 | 0.45 | 0.45 | 0.40 | 0.20 | 0.20 | 2 | 1 | 1 | 0.0% | 0.0% | 0.0% |
| proposal-dev | 0.84 | 0.55 | 0.45 | 0.60 | 0.40 | 0.20 | 2 | 1 | 1 | 0.0% | 0.0% | 0.0% |
| project-over | 0.45 | 0.45 | 0.55 | 0.20 | 0.20 | 0.40 | 1 | 1 | 1 | 0.0% | 0.0% | 0.0% |
| results-inte | 0.45 | 0.45 | 0.55 | 0.20 | 0.20 | 0.40 | 1 | 1 | 1 | 0.0% | 0.0% | 0.0% |
| gc-productio | 0.84 | 0.45 | 0.45 | 0.60 | 0.20 | 0.20 | 2 | 1 | 1 | 0.0% | 0.0% | 0.0% |

### GC 3800 × Brand Strategy

**Snapshot:** `126227e0` | **Model:** gpt-5.4-mini

**Pair-level summary (6 sub-competencies)**
| Metric | K | U | D |
|--------|---|---|---|
| Full band agreement (all 5 runs same band) | 50.0% | 83.3% | 50.0% |
| Within ±1 integer | 83.3% | 100.0% | 83.3% |

**Per sub-competency breakdown**
| Sub-competency ID | K SD | U SD | D SD | K MeanΔ | U MeanΔ | D MeanΔ | K MaxSpread | U MaxSpread | D MaxSpread | K Band% | U Band% | D Band% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| consumer-res | 0.45 | 0.00 | 0.55 | 0.20 | 0.00 | 0.40 | 1 | 0 | 1 | 100.0% | 100.0% | 0.0% |
| competitive- | 0.55 | 0.00 | 0.55 | 0.40 | 0.00 | 0.40 | 1 | 0 | 1 | 100.0% | 100.0% | 0.0% |
| brand-positi | 0.55 | 0.55 | 0.00 | 0.40 | 0.40 | 0.00 | 1 | 1 | 0 | 0.0% | 0.0% | 100.0% |
| campaign-mea | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| quantitative | 0.71 | 0.55 | 1.10 | 0.40 | 0.40 | 0.60 | 2 | 1 | 3 | 0.0% | 100.0% | 0.0% |
| cross-channe | 0.58 | 0.00 | 0.00 | 0.50 | 0.00 | 0.00 | 1 | 0 | 0 | 0.0% | 100.0% | 100.0% |

## Findings

### Part 1 — Synthesis stability

**Per-dimension SD of run-means** (typical across 3 courses):
- K: 0.02
- U: 0.02
- D: 0.03

**Foundational band agreement** (D-depth, all five baseline foundationals matched by name): 100.0%

### Part 2 — Coverage scorer stability (mini, gpt-5.4-mini)

**Mean full-band-agreement across 2 pair(s):**
- K: 25.0%
- U: 41.7%
- D: 25.0%

### Part 2b — Coverage scorer stability (heavy, gpt-5.5) — A/B headline

**Mean full-band-agreement across 2 pair(s) on heavy tier:**
- K: 81.7% (+56.7pp vs mini)
- U: 100.0% (+58.4pp vs mini)
- D: 73.3% (+48.3pp vs mini)

**D within-±1:** 100.0% (vs 91.7% on mini)

**Verdict:** Heavy tier materially improves stability. D band-agreement 73.3% (mini: 25.0%). Re-scoring the 120 pre-promotion mini cells on heavy is RECOMMENDED (est. ~$3.60).

### A7 bands-default assessment

**UPDATED after Part-2b A/B:** Heavy tier (gpt-5.5) achieves D band-agreement of 73.3% — above the 70% threshold — a large improvement over mini (25.0%). Band-level display remains the correct default: the instrument reliably supports band-level conclusions on heavy; bare-integer display would overstate precision. The original WARNING (low agreement) was model-dependent (mini), not instrument-dependent. The 120 pre-promotion mini cells should be re-scored on heavy before program-level conclusions are drawn from individual cells.

### Caveats

- N=5 is a minimum viability threshold; formal reliability benchmarks (Krippendorff α ≥ 0.70) require Part iii (human raters).
- Same-model replications measure *stability*, not *validity*. A consistently wrong model looks stable.
- All 3 courses used v1-era snapshots and confirmed profiles. The synthesis context may include legacy v1 material.
- Faculty-rater Part iii (human–AI agreement, target α ≥ 0.70/dimension) remains the load-bearing validity test.
- The 120 matrix cells scored prior to 2026-06-12 promotion used mini; they carry unknown band-agreement error until re-scored on heavy.

---
*Generated 2026-06-12T23:57:49.412Z | Total cost: $2.2016*

## Part 2b — Heavy-Tier Re-run (Post-Promotion A/B)
*Run 2026-06-13 | Completed 2026-06-13 | Cost: $0.8155*

**Context:** `program-score-coverage` was promoted light→heavy (gpt-5.5) in commit e7e9cd5 because the original Part-2 (mini, 25% D band-agreement) met the light pilot's own promote-criterion. This run re-scores the same 2 pairs on the heavy tier to measure whether stability improved.

**Model verified:** gpt-5.5 (confirmed heavy before burn)

### GC 3800 × Account Management

**Snapshot:** `126227e0` | **Model:** gpt-5.5

**Pair-level summary (5 sub-competencies)**
| Metric | K | U | D |
|--------|---|---|---|
| Full band agreement (all 5 runs same band) | 80.0% | 100.0% | 80.0% |
| Within ±1 integer | 100.0% | 100.0% | 100.0% |

**Per sub-competency breakdown**
| Sub-competency ID | K SD | U SD | D SD | K MeanΔ | U MeanΔ | D MeanΔ | K MaxSpread | U MaxSpread | D MaxSpread | K Band% | U Band% | D Band% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| client-needs | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| proposal-dev | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| project-over | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| results-inte | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| gc-productio | 0.45 | 0.00 | 0.55 | 0.20 | 0.00 | 0.40 | 1 | 0 | 1 | 0.0% | 100.0% | 0.0% |

### GC 3800 × Brand Strategy

**Snapshot:** `126227e0` | **Model:** gpt-5.5

**Pair-level summary (6 sub-competencies)**
| Metric | K | U | D |
|--------|---|---|---|
| Full band agreement (all 5 runs same band) | 83.3% | 100.0% | 66.7% |
| Within ±1 integer | 100.0% | 100.0% | 100.0% |

**Per sub-competency breakdown**
| Sub-competency ID | K SD | U SD | D SD | K MeanΔ | U MeanΔ | D MeanΔ | K MaxSpread | U MaxSpread | D MaxSpread | K Band% | U Band% | D Band% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| consumer-res | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| competitive- | 0.00 | 0.00 | 0.55 | 0.00 | 0.00 | 0.40 | 0 | 0 | 1 | 100.0% | 100.0% | 0.0% |
| brand-positi | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| campaign-mea | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| quantitative | 0.45 | 0.00 | 0.45 | 0.20 | 0.00 | 0.20 | 1 | 0 | 1 | 0.0% | 100.0% | 0.0% |
| cross-channe | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 | 0 | 100.0% | 100.0% | 100.0% |

### A/B Comparison: mini (Part 2) vs heavy (Part 2b)

| Pair | Metric | mini (gpt-5.4-mini) | heavy (gpt-5.5) | Delta |
|------|--------|---------------------|-----------------|-------|
| Account Management | K band-agree | 0.0% | 80.0% | +80.0pp |
| | U band-agree | 0.0% | 100.0% | +100.0pp |
| | D band-agree | 0.0% | 80.0% | +80.0pp |
| | D within-±1 | 100.0% | 100.0% | +0.0pp |
| Brand Strategy | K band-agree | 50.0% | 83.3% | +33.3pp |
| | U band-agree | 83.3% | 100.0% | +16.7pp |
| | D band-agree | 50.0% | 66.7% | +16.7pp |
| | D within-±1 | 83.3% | 100.0% | +16.7pp |

**Mean across 2 pairs:**
| Dimension | mini mean | heavy mean | Delta |
|-----------|-----------|------------|-------|
| K band-agree | 25.0% | 81.7% | +56.7pp |
| U band-agree | 41.6% | 100.0% | +58.4pp |
| D band-agree | 25.0% | 73.3% | +48.3pp |
| D within-±1 | 91.7% | 100.0% | +8.3pp |

### Verdict

Heavy tier achieved high D band-agreement (73.3%), a material improvement over mini (25.0%). Re-scoring the 120 pre-promotion mini cells on heavy is RECOMMENDED. Estimated cost: 120 cells × ~$0.03/cell (heavy, ~5–6 sub-comps/cell) ≈ $3.60 total.

---
*Part-2b generated 2026-06-13T00:09:26.375Z | Cost: $0.8155*
