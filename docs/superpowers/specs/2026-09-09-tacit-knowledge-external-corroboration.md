# Tacit knowledge — external corroboration from labour-market data

**Date:** 2026-09-09
**Status:** Extends (does not supersede) [`2026-08-12-tacit-knowledge-exploration.md`](./2026-08-12-tacit-knowledge-exploration.md). That memo's verdict and its two rejected additions stand unchanged.
**Trigger:** operator asked whether the tacit-knowledge work merited further research after Brynjolfsson, Chandar & Chen (Aug 2026) entered the library.

---

## 1. What changed

The August memo reached its position **entirely from the learning-science side** — ACT-R proceduralization, Dreyfus, the portfolio-validity literature — and concluded that KUD+ already operationalises tacit knowledge through the Do axis, which is "a behavioural tacit-fluency gradient." Its own summary of the exploration was *"mostly confirmatory."*

That position now has **independent external corroboration from administrative labour-market data**, which it did not have in August.

Brynjolfsson, Chandar & Chen (2026), *Canaries in the Coal Mine?* (ADP payroll, millions of US workers through June 2026), propose codified-versus-tacit knowledge as the **mechanism** for why AI's employment effect falls on young workers and not experienced ones:

> "AI substitutes more effectively for codified knowledge — formal, standardized, documented knowledge that can be taught through education, textbooks, or written procedures — while complementing tacit knowledge acquired through practice, mentorship, and repeated exposure to real situations."

Empirically: *"employment declines for young workers in occupations that involve codified knowledge. Occupations that involve tacit knowledge see faster employment growth for experienced workers."*

**Why this is more than agreement.** The August memo argued that tacit knowledge is *real and already measured by the Do axis*. This is a different kind of claim in the same direction: that the codified/tacit boundary now has **economic consequences attached** — it predicts who gets hired. The framework's reason for measuring the Do axis was pedagogical; it now also has a labour-market rationale, reached independently and from data the framework has no contact with.

## 2. What this does and does not license

**Does:**
- §16 may now state the codified/tacit mechanism as external support for the entry-rung argument (done, 2026-09-09).
- The Do axis's centrality gains an argument that does not depend on the learning-science literature at all.
- It sharpens what a curriculum can act on: *the part AI substitutes for is the part a syllabus is best at delivering, and the part it complements is the part requiring productive failure, mentorship, and repeated exposure.* That is a cleaner statement of the §4 thesis than the framework had.

**Does not:**
- It is **not measurement**. The authors call their codified/tacit indices "a simple descriptive exercise." The proxies are coarse: codified ≈ required formal education + O*NET taught-content domains; tacit ≈ required work experience + on-the-job training + experiential domains.
- It does **not** revive either addition the August adversarial review rejected. The "decay K faster than D" durability rule remains **rejected and backwards** (§6's Bahrick permastore is *declarative* memory durable for decades; durability tracks reps, not axis). SECI remains **out**.
- It does **not** change any score, scale, or rubric. Directional impact on scoring: **none**, same as August.
- It is not independent of model judgment at the exposure layer — see §4.

## 3. Does further research merit? — assessed, and the answer is mostly no

Three candidate directions were considered:

| Candidate | Verdict |
| --- | --- |
| Chase the codified/tacit index construction (their Online Appendix J) to see whether GC-relevant occupations are classifiable | **Not now.** The proxies are education- and experience-requirement based; for GC's occupations they would mostly restate what O*NET already says about required experience. Low marginal information for the effort. |
| Re-open the tacit-measurement question (can we measure tacit knowledge directly?) | **No — and the August memo already closed this correctly.** Gottfredson vs Sternberg: do not claim to measure "tacit knowledge" as a construct. The Do axis measures its *behavioural shadow*, which is the defensible claim. Nothing in Brynjolfsson changes that; their indices are occupation-level proxies, not individual measurement. |
| Use the codified/tacit split to *prioritise* which competencies get D-evidence scrutiny | **Worth holding, not building.** This is the one with real potential: if AI substitutes for codified knowledge, then competencies whose D-evidence is thin *and* whose content is codifiable are where the curriculum is most exposed. But it depends on the same diagnostic the August memo already gated — see §5. |

**Conclusion: the corroboration is worth recording and citing; it does not open a new research line.** The honest summary is that an external, independently-derived finding landed on a position the framework already held, which raises confidence without changing behaviour. That is a good outcome and should not be inflated into a reason to build something.

## 4. A caveat that must travel with the citation

Brynjolfsson's employment *outcomes* are administrative payroll, but **both of its primary AI-exposure measures are LLM-derived** — GPT-4 task-level exposure (Eloundou et al. 2024, human-validated) and Claude conversation shares from the Anthropic Economic Index. "Which occupations are AI-exposed" therefore rests on model judgment — the same correlated-error concern `background.html` §7 raises about LLM ensembles (Kim et al. 2025; Kohli 2025). Non-model exposure measures appear only as appendix robustness checks.

The authors additionally flag three patterns themselves: divergent trends **predating ChatGPT** (around COVID); estimates that **attenuate when controlling for occupational education**, which they note "may reflect either an alternative explanation or the very channel through which AI operates"; and a divergence more pronounced in their payroll panel than in national survey benchmarks.

None of this sinks the finding. It does mean the corroboration is *suggestive mechanism evidence from a source with model judgment in its exposure layer*, not a clean external instrument.

## 5. The one action this points at — still gated, now better motivated

The August memo gated a product change on a cheap read-only diagnostic:

> *How many T1/T2 performance-Do competencies scored low-D (≤2) rest on materials-only or absent D-evidence?* Large footprint → build the "evidence-limited D" provenance flag; small → the §7 caveat is inert.

**That diagnostic has still not been run.** It is now better motivated than it was in August: if the codified/tacit mechanism holds, competencies with thin D-evidence are not merely under-measured — they are under-measured *precisely where the labour market is placing a growing premium*. The cost is unchanged (a read-only query over existing coverage data), and it gates a decision rather than assuming one.

**Recommendation: run the diagnostic.** It was cheap in August and is now the only concrete action either memo points at.

---

## References

- Brynjolfsson, E., Chandar, B., & Chen, R. (2026). *Canaries in the Coal Mine? Six Facts about the Recent Employment Effects of Artificial Intelligence*. Stanford Digital Economy Lab, August 2026 version. Local: `docs/references/_pdfs/brynjolfsson-2026-canaries.pdf`.
- Prior memo: [`2026-08-12-tacit-knowledge-exploration.md`](./2026-08-12-tacit-knowledge-exploration.md).
- Wiring: `docs/background.html` §16 (codified/tacit mechanism + the LLM-exposure caveat).
