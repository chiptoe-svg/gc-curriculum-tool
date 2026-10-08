# Tschirschwitz & Rodehorst (2024) — Label Convergence

**Full citation:** Tschirschwitz, D., & Rodehorst, V. (2024). Label Convergence: Defining an Upper Performance Bound in Object Recognition through Contradictory Annotations. arXiv:2409.09412 [cs.CV]. Bauhaus-Universität Weimar. A method for estimating the ceiling model accuracy imposed by disagreement among human annotators on a test set, applied to five object-detection/recognition datasets including LVIS.

**Also carded in:** `ai_career_impact/library/cards/future_of_gc/load_bearing/tschirschwitz-rodehorst-2024.md` (private) — that card already correctly attributes the authors (not "Bartz") and the formula/fit statistics; no correction to mirror.

**Reference ID in measurement-hypotheses-deep-dive.html:** cited in §4 ("the residual") and the §8 reference list; **an earlier draft misattributed this paper to "Bartz et al. (2024)"** — that name appears nowhere in the paper (confirmed by full-text search) and has been corrected.

**Where it lives:**
- arXiv:2409.09412 (cs.CV), open access.
- **Local copy:** no PDF held in this repo's `_pdfs/`; a copy exists at `ai_career_impact/library/pdfs/future_of_gc/load_bearing/Tschirschwitz_Rodehorst_2024_Label_Convergence_Performance_Bound.pdf` (private, shared source).

**Accessibility:** Clean born-digital arXiv PDF; the regression formula, fit statistics, and figure captions extract cleanly.

**What the doc claims it says:** §4: "In object recognition, Tschirschwitz and Rodehorst (2024) estimate the bound as `mAP ≈ 0.836·α + 0.197`, where α is annotation agreement, and find that state-of-the-art results 'approach this upper bound for the well-studied LVIS dataset' (p. 8). They also note that language differs from vision because 'language inherently involves ambiguities' (p. 8). So the formula is an analogy here, not a value to borrow."

**What it actually says (synthesis):**

The paper's authors, per the title page, are **David Tschirschwitz and Volker Rodehorst** — "Bartz" appears nowhere in the paper. It introduces "label convergence": the highest achievable model performance under the constraint that human annotators contradict each other on the test set, i.e. an evaluation ceiling imposed by label noise rather than by model capacity. Analyzing five datasets, including LVIS, the authors regress mAP against Krippendorff's alpha (α, inter-annotator agreement) across datasets and report a linear fit: **mAP = 0.836·α + 0.197** (Eq. 1, p. 6), with a Pearson correlation ρ = 0.92 and R² = 0.85 (p. 6). On scope, the paper's finding that state-of-the-art already approaches the convergence bound is explicitly scoped to **LVIS only**: "while state-of-the-art (SOTA) results approach this upper bound for the well-studied LVIS dataset" (p. 8). The abstract gives the LVIS bound as 62.63–67.52 mAP@[0.5:0.95:0.05] with 95% confidence; the body (p. 6) and Table 3 (p. 7) give the lower bound as 62.64 — a one-hundredth discrepancy between the abstract and the body worth noting if this card is ever cited for the exact figure. Co-DETR, the SOTA model discussed, scores 66.8, inside that interval. The paper's stated conclusion from this is that for LVIS, "model capacity is sufficient to solve current object detection problems" — the binding constraint there is label quality, not model capacity. The two other datasets the audit of the sibling page checked (TexBiG, VinDr-CXR) are **not** asserted by this paper's text to sit "well below" their ceilings with a quotable sentence; the measurement-hypotheses page accordingly makes no claim about those datasets and scopes the SOTA-at-ceiling finding to LVIS only. On transferring the formula to language tasks, the authors themselves flag a disanalogy: "language inherently involves ambiguities" (p. 8) — the formula is domain-specific to the five vision datasets studied, not a universal constant.

**Verdict:** Consistent with the doc's current (corrected) wording: author names, the formula and its fit statistics, and the LVIS-only scope of the "SOTA approaches the ceiling" finding are all verbatim. The sole historical error — misattributing the paper to "Bartz et al." — has been corrected in `measurement-hypotheses-deep-dive.html` (which now notes the correction explicitly in its revision note) and in this card's title/citation.

**Audited 2026-10-07 against held full text (citation-audit skill).**
