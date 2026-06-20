# Which references from the 2026-06-19 Measurement-Hypotheses spec belong in the lit review

Source: `docs/superpowers/specs/2026-06-19-curriculum-measurement-hypotheses.md` (Hypotheses **B** durability/bleed-off, **A** competency→career cross-walk, **C** uncertainty discipline, plus the embeddings discussion).

**Framing.** The spec is explicitly **HYPOTHESIS-stage** ("not specced, not built"). So "belongs in the lit review" has two senses, and I've separated them:
- **Tier 1 — add now.** Primary sources for claims the *current* docs already make (about spacing/retrieval/desirable difficulties, and about honest measurement/uncertainty). Several of these are overdue — the docs assert the claim but cite a secondary or nothing.
- **Tier 2 — add when B/C are adopted.** Load-bearing *if* the durability model (B2) or the uncertainty contract (C) is built; not needed for the present pedagogical argument.
- **Tier 3 — methods/architecture bibliography, not the pedagogical lit review.** The skills-intelligence / NLP / embeddings tooling. Real and worth tracking, but it's engineering literature, not the evidence base for how problem-solving develops. Keep it in a separate `architecture`/methods bib.

---

## Already in the lit review (no action)

These spec citations are already in `load_bearing/` and/or have audit notes:
Perkins & Salomon (1992) · Barnett & Ceci (2002) · Sala & Gobet (2017) · Chi, Feltovich & Glaser (1981) · Larkin et al. (1980) · Doignon & Falmagne (1985, KST — `doignon-1985.md`) · Kapur (2008/2016) · Bjork (1994, desirable difficulties) · Xu et al. (2026) · Xu et al. (2025) · Javadian Sabet et al. (2024) · Decorte et al. (2023) · Senger et al. (2024).

---

## TIER 1 — add to the lit review now

### B-cluster: memory, decay, spacing (these back claims §3 *already makes*)
The deep-dive §3 already invokes spacing, interleaving, retrieval practice, and "desirable difficulties" — but cites only Bjork (1994). The **primary sources** behind those exact sentences are missing and should be in:

- **Cepeda, Pashler, Vul, Wixted & Rohrer (2006)**, *Distributed Practice in Verbal Recall Tasks: A Review and Quantitative Synthesis*, Psychological Bulletin 132(3):354–380 (+ Cepeda et al. 2008) — the spacing-effect meta-analysis.
- **Roediger & Karpicke (2006)** + **Adesope, Trevisan & Sundararajan (2017)**, *Rethinking the Use of Tests: A Meta-Analysis of Practice Testing*, RER 87(3) (g≈0.51–0.93) — the retrieval-practice/testing-effect anchor.
- **Murre & Dros (2015)**, *Replication and Analysis of Ebbinghaus' Forgetting Curve*, PLOS ONE — the forgetting-curve base rate.
- **Arthur, Bennett, Stanush & McNelly (1998)**, *Factors That Influence Skill Decay and Retention*, Human Performance 11(1) — skill decay ≈1 SD/yr; the order-of-magnitude anchor for "bleed-off."
- **Bahrick (1984)**, *Semantic Memory Content in Permastore*, JEP:General 113(1) — the existence proof that durable depth ≠ instantaneous depth (the core B distinction).
- **Craik & Lockhart (1972)**, *Levels of Processing* — why deeper encoding is more durable (mechanism behind durability-lift).
- **Linn, Eylon & Davis (2004)**, *Knowledge Integration* + **Witherby & Carpenter (2021)**, rich-get-richer (within-domain only), JEP:LMC — the "pull neighbors up" support, correctly bounded to within-domain.

*Why now:* these are the actual evidence for sentences already in the docs, and they convert Hypothesis B's "durability" framing from assertion into a sourced position. High value, low controversy.

### C-cluster: measurement honesty & uncertainty (these back the evidence-ladder / "conversation engine not measurement instrument" framing)
The docs already commit to honest measurement (the 0–4 evidence ladder; "conversation engine"). The formal grounding lives in these and should be cited:

- **Landis & Koch (1977)** — the κ benchmark scale (already referenced implicitly whenever the docs talk reliability).
- **Cronbach, Gleser, Nanda & Rajaratnam (1972)** Generalizability Theory + **Brennan (2001)**; **Lord & Novick (1968)** SEM; **Linacre (1989)** Many-Facet Rasch — the "manage variance, don't chase it / score within 1 SEM is a tie / disagreement is a calibratable facet" machinery.
- **Hüllermeier & Waegeman (2021)**, *Aleatoric and Epistemic Uncertainty in ML* — names the "irreducible residual."
- **Bartz et al. (2024)**, *Label Convergence* — "you cannot exceed the reliability of your own labels" as a citable result.
- **Kim, Garg, Peng & Garg (2025, ICML)**, *Correlated Errors in LLMs* + **Kohli (2025)**, *Nine Judges, Two Effective Votes* — the priority-changing finding that ensembling can't cancel shared bias, so graduate-outcome validation is structurally necessary. **This is the single most consequential new citation** — it changes the validation plan's status from "nice-to-have" to "required," which is exactly the linchpin my writeup-review flagged.
- *(supporting)* Plank (2022) / Aroyo & Welty (2015) data perspectivism; Wang et al. (2022) self-consistency; Verga et al. (2024) panel-of-judges; Guo et al. (2017) calibration; Geifman & El-Yaniv selective prediction; Casabianca et al. (2017) + edTPA κ=0.17 (human-rater-unreliability data).

*Why now:* the docs make reliability/uncertainty claims; the C-cluster is their formal backing and it materially strengthens the most-attacked part of the framework (maps from weak evidence).

---

## TIER 2 — add when Hypothesis B/C is actually built (methods, gated)

The **computational form** for the deferred B2 decay model — pedagogically adjacent but it's modeling machinery, not evidence about learning:
- **Settles & Meeder (2016)**, *Half-Life Regression* (Duolingo) — the borrowable decay-plus-consolidation form; **FSRS**; **SM-2** (Woźniak 1987).
- Knowledge-tracing for contrast: Corbett & Anderson (1995, BKT) · Piech et al. (2015, DKT) · Nagatani et al. (2019) · Wang et al. (2021, HawkesKT) · Cen et al. (2006, AFM) · Pavlik et al. (2009, PFA).

These belong in a **B2 methods appendix** when/if B2 is specced, not in the pedagogical lit review now.

---

## TIER 3 — architecture/methods bibliography, NOT the pedagogical lit review

The skills-intelligence / NLP / embeddings trajectory. This is how the *tool* is engineered (retrieve-then-reason, taxonomy anchoring, embedder choice) — not the evidence base for the curriculum thesis. Keep as a separate `architecture`/methods bib:
- skill2vec (Le Van-Duyet 2017; Wong et al. 2017) · JobBERT · ESCOXLM-R (2023) · CareerBERT (2025) · UniSkill (Musazade et al. 2026) · directed-GNN CPRP / GKROM.
- Embedder-selection: Tang & Yang / FinMTEB (2025) — the "leaderboard trap"; voyage-law-2 / voyage-finance-2; MatSciBERT / MELT / ChEmbed; SPECTER2 / SciBERT; adapter & contrastive fine-tuning papers; HydroEmbed.

*Note:* the four already-held "skills-intelligence" PDFs (Javadian Sabet 2024, Decorte 2023, Senger 2024, Xu 2025) live in `citations/` and logically belong to **this** bibliography, not the pedagogical load-bearing set — worth separating so the load-bearing folder stays the pedagogical evidence base.

---

## Recommendation

1. **Pull and note the Tier-1 set now** (~13 papers) — most are open access (PLOS ONE, the meta-analyses, arXiv for Kim/Kohli; the psychometrics classics are books/Clemson-library). They back claims the docs already make and they harden the two weakest spots (durability is currently asserted; the validation plan is currently "optional").
2. **Record Tier-2/Tier-3 in a separate methods/architecture bibliography**, not the pedagogical lit review — and move the four skills-intelligence PDFs there so `load_bearing/` stays clean.
3. The **Kim et al. (2025) / Kohli (2025)** correlated-errors finding should be promoted into `background.html` itself (it converts graduate-outcome validation from optional to required) — flag for the writeup, not just the bibliography.
