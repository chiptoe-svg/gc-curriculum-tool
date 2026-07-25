# Q1 supply→canonical alignment — quality measurement + fixes

**Date:** 2026-07-25
**Trigger:** the withdrawn skill-embedding cross-check spec (`specs/2026-07-25-skill-embedding-alignment-design.md`) said the honest next step was to *measure the current LLM-only alignment error rate before building anything*. This is that measurement — and it surfaced a real, shipped quality problem in `snapshot_target_coverage`.

## Method

Fixture = **58 real production alignments** where `snapshot_target_coverage.matched_competency` is set (5 courses × 5 career targets), pulled from the live DB:

```sql
SELECT stc.course_code?, sc.name AS canonical_name, sc.know_descriptor, sc.understand_descriptor,
       sc.do_descriptor, stc.matched_competency, stc.k_depth, stc.u_depth, stc.d_depth, stc.confidence
FROM snapshot_target_coverage stc
JOIN sub_competencies sc ON sc.id = stc.sub_competency_id
JOIN career_targets ct ON ct.id = stc.career_target_id
JOIN course_capture_snapshots s ON s.id = stc.snapshot_id
WHERE stc.matched_competency IS NOT NULL AND stc.matched_competency <> '';
```

Each alignment adjudicated by a gpt-5.4 judge (via the campus proxy) on one question: is the course competency the **same skill** as the canonical sub-competency, or an over-credited thematic resemblance? Verdicts: `correct` / `questionable` (real stretch) / `wrong` (different skill / thematic-only). Method is reproducible from the SQL above; harness in the session scratchpad (`judge-alignments.py`).

## Result — the alignment is poor, and worst where it matters

| | correct | questionable | wrong |
|---|---|---|---|
| **overall (n=58)** | 3% | 38% | **59%** |
| thin cells `maxD≤1` (n=24) | 0% | 13% | **87%** |
| **meaningful cells `maxD≥2` (n=34)** | **6%** | 56% | **38%** |

- **Thin cells (87% wrong)** are largely a *structural artifact*: the scorer is instructed to score **every** sub-competency (`program-score-coverage.ts` — "one cell per sub-competency, never skip rows"), so a course that barely serves a competency still gets a loose low-depth "closest thread." Low-stakes, but it is noise in the supply signal.
- **Meaningful cells are the real problem:** even where the tool claims the course *develops* the competency at depth ≥2 — the cells that feed the coverage matrix and scaffolding analysis — only **2 of 34** are clean matches; 38% are outright wrong.

## Three failure modes (none fixable by embeddings)

1. **Force-matched unserved cells.** Scoring every sub-competency manufactures thematic matches where the honest answer is "not served."
2. **Foundational→technical leak.** Foundational dispositions cross-walked onto technical career sub-competencies: Resilience→"Timeline management," Agency→"Vendor selection," Attention to Detail→"Quality control" (3 of 4 such cases wrong). A disposition is *how* a student works, not technical-skill supply. A clean rule violation.
3. **Same-topic-as-same-skill.** "Deliver a presentation"→"Proposal development," "design thinking"→"Competitive market analysis." Shared subject area credited as a match.

## Embeddings: wrong tool for identity, right tool for relatedness (measured)

The withdrawn spec proposed an embedding cross-check *for the identity match*. Tested directly against this fixture with `qwen3-embedding-4b`:

- **Cosine carries a weak quality gradient** — mean cos(comp, assigned-canonical): correct **0.643** > questionable **0.541** > wrong **0.460** (monotonic). Not noise. **But** the ranges overlap heavily (wrong 0.34–0.58, correct 0.53–0.76) → poor as a classifier, consistent with the ~24%-precision literature.
- **Decisive rescue test:** on the 34 alignments the LLM got wrong, embedding's top-1 is a clean match in only **1/34** (generic). A **domain/identity-framed instruction** (Qwen3-Embedding is instruction-aware) did **0/34** — framing toward GC+identity made it *worse*, because similarity training packs topically-related GC concepts *closer*, the wrong direction for same-vs-topic.
- **"Embed the topic, not the skill" — tested** (extract subject-matter topic, embed that): does *not* improve identity. Spread stays ~0.18 (correct 0.702 / wrong 0.525), and **wrong-match topics score *higher*** precisely because wrong matches *share a topic* — the failure is topic-similar-but-skill-different, so topic-similarity is if anything the wrong signal for identity. Foundational dispositions extracted to "project work" / "project management" (still topically near "Timeline management") — topic-embedding doesn't strip the disposition either.

**The distinction the measurement establishes — identity vs. relatedness:**

- **Identity** ("is X the *same skill* as Y?") is what the supply→canonical seam needs, and it's an LLM judgment: a *reject* decision ("should this match anything?"), a *rule* (disposition vs technical), and a *dimension* call (K vs U vs D). Embeddings answer "which is nearest?" — the wrong question for 2 of the 3 failure modes. That's why every embedding variant scored ~0–1/34.
- **Relatedness** ("do these topics relate / stack / feed each other?") is what embeddings are *native* at — and the very result above proves the signal is robust (wrong-but-related pairs score high *because* topic embeddings reliably capture topical proximity). This is the right tool for **prerequisites, scaffolding/stacking, gap-neighborhood retrieval, and the cross-course evidence spine** (already live) — jobs where topical adjacency, not skill-identity, is the question. §11/§12 already frame this ("embedding similarity *proposes* candidate relations; reasoning adjudicates").

**Net:** the withdrawn spec's error was aiming embeddings at *identity*. They belong on the *relatedness graph*, not the identity key. A relatedness/stacking layer built on topic embeddings is a legitimate, separate design (not this seam) — worth its own brainstorm; domain-tuning would help there (large-candidate recall) far more than it does on this 5–7-candidate precision seam.

## Fixes

- **(b) + (c) — first cut shipped to the prompt** (`lib/ai/prompts/program-score-coverage.md`, §1 match-classification): a "foundational dispositions are not technical-skill supply" rule and a "same skill, not same topic" rule. Prompt-only, loads at runtime.
- **(a) — not yet done.** Whether to stop force-matching unserved cells (let "not served" stand rather than record a D1 thread) is a design choice affecting the "score every sub-competency, gaps are the point" contract — deferred pending the operator's call.

## Validation of the first-cut fix (re-scored the 23 fixture pairs with the new prompt)

Re-ran `program-score-coverage` (new prompt, in-memory, no DB writes) on the same 23 (snapshot, target) pairs and re-judged with the same rubric. **Directional improvement across every metric — but not a solve:**

| metric | baseline | new prompt |
|---|---|---|
| foundational→technical leak | 4 | **1** |
| force-matched cells | 58 | **39** (98 now honest "not served") |
| correct | 3% | **10%** |
| wrong | 59% | **46%** |
| meaningful-depth (≥2) correct | 6% | **13%** |

The foundational-leak rule and the "not served" behavior clearly work; alignment quality is still poor in absolute terms (~46% wrong). The structural **(a)** change and better grounding remain owed. (Harness: `scripts/_one-off/validate-coverage-fix.ts`.)

## Judge robustness (is gpt-5.4 the right judge?)

The alignments were *produced* by gpt-5.4 (`AI_PROVIDER=openai`), so gpt-5.4-as-judge is partly grading its own family → a **leniency** bias. Three-judge panel on the same 58 baseline alignments (% "wrong"):

| judge | % wrong |
|---|---|
| gpt-5.4 (produced the alignments) | 58% |
| glm-5.2 (independent, non-gpt family) | 82% |
| **gpt-5.6-sol (newer, stronger)** | **92%** |

**Both stronger judges — one cross-family, one newer-same-family — find it far worse than gpt-5.4.** gpt-5.4 was the lenient outlier (own-output circularity). So the finding is not just judge-robust but **understated**: the true not-same-skill rate is ~80–92%, and the "59% wrong / 3% correct" headline is generous. **gpt-5.6-sol is the better judge going forward.** Consequence: the fix-validation numbers (measured on gpt-5.4) hold in *direction* (same judge both sides) but are *optimistic* in absolute terms — a re-validation of the fix under gpt-5.6-sol is owed before trusting any post-fix absolute number, and a faculty spot-check remains the ultimate ground truth.

## Model test — the producing-model upgrade is marginal (corrected)

Tested the **producing** model across the 23 fixture pairs, new prompt, all judged by the honest gpt-5.6-sol. **Correction:** the coverage function's actual default is the `heavy` tier = **gpt-5.5**, not gpt-5.4 (`default` tier). The initial framing wrongly used gpt-5.4 as "current" and overstated the upgrade. Apples-to-apples:

| producer (+ new prompt) | matched cells | wrong % |
|---|---|---|
| gpt-5.4 | 51 | 84% |
| **gpt-5.5 (ACTUAL current, heavy tier)** | 28 | **79%** |
| gpt-5.6-terra | 30 | 73% (clean cross-judge) |
| gpt-5.6-sol | 19–31 | ~66–74% (non-self: terra 66 / glm 74; sol self-judge 63) |
| gpt-5.6-luna | 25 | 84% |

**Corrected finding:** the real available model change — current **gpt-5.5 (79%) → gpt-5.6-sol (~70%)** — is **~9 points**. (gpt-5.6-sol is a **current stable release**, not an experimental variant — an earlier draft wrongly called sol/terra/luna experimental.) So it's a **defensible cheap upgrade** (newer stable model, one-line config change), just not the "biggest lever" the wrong gpt-5.4 baseline implied. Model capability helps monotonically but gently (5.4 84 → 5.5 79 → terra 73 → sol ~70); none of it makes the feature trustworthy on its own. Recommendation: **the gpt-5.6-sol switch is worth doing** (cheap, real ~9pt gain, more conservative matching), but the feature still needs the redesign regardless.

**Findings:** (1) upgrading the producer to gpt-5.6-sol is the single biggest lever — bigger than the prompt fix; (2) the 5.6 producers **stop force-matching** (19–30 matches vs 51 — far more honest "not served"), the desired structural behavior emerging from a better model; (3) sol > terra > luna, and luna is no better than 5.4 — the variant matters.

**Self-judge check (confirmed the sol number).** sol judging its own output was 63% wrong (optimistic). Re-judged the *same* sol-produced cells with non-sol judges: **gpt-5.6-terra 66%**, **glm-5.2 (independent) 74%**. So sol's honest error is **~66–74% wrong** (self-judge inflation was real but modest, ~3–11 pts). **Net: the model upgrade takes honest error ~92% → ~70%** — a real ~20-point win, but the alignment is still ~70% wrong. No model+prompt combination solves it; the deeper fix is structural (stop scoring every sub-competency) + faculty-in-the-loop.

The producing model is now overridable per call (`ScoreCoverageInput.modelOverride`); adopting gpt-5.6 in prod is a `program-score-coverage` function-settings (`customModel`) change.

## Caveats

- Strict "same-skill" rubric → absolute % is a floor; the depth-disaggregated 6%-correct-at-depth and the foundational leak survive any reasonable discount (and the independent judge was harsher).
- This is the **shipped** `program-score-coverage` behavior (unchanged by the recent capture-chat-agent prompt work). Snapshots may predate other improvements, but the alignment step itself is current.
- The fix is committed to `dev`, **not deployed** — deploy decision pending (it is strictly better than current, but still poor; may be worth bundling with the structural (a) change).
