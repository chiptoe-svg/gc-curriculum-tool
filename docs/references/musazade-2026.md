# Musazade, Mezei & Zhang (2026) — UniSkill

**Full citation:** Musazade, N., Mezei, J., & Zhang, M. (2026). UniSkill: A Dataset for Matching University Curricula to Professional Competencies. arXiv:2603.03134 [cs.CL].

**Reference ID in background.html / measurement-hypotheses-deep-dive.html:** `ref-musazade-2026`; cited in `background.html` §11 (curriculum-to-competency matching) and in `measurement-hypotheses-deep-dive.html` §5 (the κ ≈ 0.45 inter-rater figure and the domain-embedder discussion).

**Where it lives:**
- arXiv:2603.03134 (cs.CL), open access.
- **Local copy:** `docs/references/_pdfs/musazade-2026-uniskill.pdf` (arXiv v1, 14 pp; held, mapped in held.json). The card text below was first written from the 2026-10-07 audit's verified quotes before the PDF was held; confirmed held 2026-10-09.

**Accessibility:** Open access (arXiv); not independently re-read for this card — see above.

**What the doc claims it says:** `background.html` §11: "benchmarked curriculum-to-competency matching is now an active task (UniSkill (Musazade et al., 2026)...)." `measurement-hypotheses-deep-dive.html` §5: "UniSkill (Musazade et al., 2026) is not an embedder but a dataset for this task: 'the first open-source dataset for aligning course learning goals to standardized occupational skills.'" The same page's §5 "callout" also cites it for "κ ≈ 0.45... on 300 doubly annotated pairs, most of them hard."

**What it actually says (per the audit's verified quotes):**

UniSkill is explicitly introduced as a **dataset**, not a model or embedder: "UniSkill: The first open-source dataset for aligning course learning goals to standardized occupational skills" (p. 2). An earlier draft of `measurement-hypotheses-deep-dive.html` listed UniSkill alongside JobBERT, ESCOXLM-R, and CareerBERT as one of several "education-specific embedders" — that framing is **misstated** (audit finding MU2): the paper is a dataset (with a fine-tuned BERT baseline reported against it), not an embedder in the same category as the others on that list.

**The inter-rater reliability figure.** The paper reports Cohen's κ for its own human double-annotation: "For the 300 course sentence-skill pairs annotated by both annotators, we achieved a Cohen's kappa of approximately 0.45, indicating moderate agreement" (p. 4). The 300 pairs are not a uniform random sample: "In rounds 1 through 4, they annotated 50 pairs each of 'hard' examples... In round 5, they annotated 50 hard and 50 'easy'" (p. 4) — i.e., the κ ≈ 0.45 figure is predominantly over high-similarity "hard" pairs, which is the harder end of the task, and should be reported with that qualifier rather than as a figure over a representative sample.

**Verdict:** Both docs now state UniSkill correctly as a dataset (not an embedder), and `measurement-hypotheses-deep-dive.html` §5 states the κ ≈ 0.45 figure with its "mostly high-similarity 'hard' pairs" qualifier. This card was written to backfill the missing reference entry flagged in the 2026-10-07 audit; if this source becomes more heavily load-bearing, obtain and read the primary PDF directly (arxiv.org/abs/2603.03134) rather than relying on this audit-derived synthesis.

**Audited 2026-10-07 — from the citation audit's verified quotes, not an independent full-text read (no local PDF held). Flag for backfill: obtain the PDF and re-verify directly.**
