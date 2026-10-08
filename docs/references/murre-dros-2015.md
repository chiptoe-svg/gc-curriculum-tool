# Murre & Dros (2015) — Replication and Analysis of Ebbinghaus' Forgetting Curve

**Full citation:** Murre, J. M. J., & Dros, J. (2015). Replication and Analysis of Ebbinghaus' Forgetting Curve. *PLOS ONE*, 10(7), e0120644. https://doi.org/10.1371/journal.pone.0120644. A direct modern single-subject replication of Ebbinghaus's 1880s forgetting experiment, using the method of savings.

**Also carded in:** `ai_career_impact/library/cards/future_of_gc/load_bearing/murre-dros-2015.md` (private) — that card's "two-component curve" characterization (see Verdict below) is **not** what the paper itself argues and should be corrected there; the correction is listed in `_AUDIT_2026-10-07.md`.

**Reference ID in measurement-hypotheses-deep-dive.html:** cited in §2 ("the two forces" / decay) and in the §8 reference list.

**Where it lives:**
- *PLOS ONE* 10(7):e0120644 (open access, Creative Commons Attribution). Raw data on OSF (osf.io/6kfrp).
- **Local copy:** no PDF held in this repo's `_pdfs/`; a copy exists at `ai_career_impact/library/pdfs/future_of_gc/load_bearing/Murre_Dros_2015_Ebbinghaus_Forgetting_Curve_Replication.pdf` (private, shared source).

**Accessibility:** Open access; born-digital PDF, text and savings tables (Table 3) extract cleanly.

**What the doc claims it says:** §2: "Murre and Dros (2015) replicated Ebbinghaus's forgetting curve with one subject relearning lists after intervals from 20 minutes to 31 days. Their measure is *savings* (the share of the original learning time saved when relearning), not percent recalled. In the replication, savings fell from 47% at 20 minutes to 4% at 31 days; in Ebbinghaus's original data, from 58% to 21% (their Table 3). They conclude that the curve 'is not completely smooth but most probably shows a jump upwards starting at the 24 hour data point,' adding that current research on sleep would predict such a jump, though for this kind of experiment it 'remains to be established.'"

**What it actually says (synthesis):**

One subject (Dros) spent roughly 70 hours over several months learning lists of 13 nonsense syllables to a criterion of correct serial recall, then relearning them after retention intervals of 20 minutes, 1 hour, 9 hours, 1 day, 2 days, 6 days, and 31 days. Retention is measured by **savings** — the proportional reduction in repetitions/time needed to relearn a list versus learning it fresh — not percent free recall.

**The numbers.** Table 3 (p. 10) gives savings of **0.472 (47.2%) at 20 minutes falling to 0.041 (4.1%) at 31 days** for the Dros replication; Ebbinghaus's own original data run **0.582 (58.2%) at 20 minutes to 0.211 (21.1%) at 31 days**. "The greatest deviation is by Dros at 31 days" (p. 10) — the replication's 31-day point is the curve's least stable value, markedly lower than Ebbinghaus's own.

**The shape — what the paper actually claims, and what it does not.** The authors fit four candidate equations to the data: a power function, a logarithmic function, a summed-exponential function, and a Memory Chain Model (MCM, a "double exponential" linking two memory stores via a consolidation process). The abstract/text conclusion is specifically about a **discontinuity**, not a general "two-component" shape claim: "it is not completely smooth but most probably shows a jump upwards starting at the 24 hour data point" (p. 1). The paper's own summary favors the **power function** as the best, most parsimonious overall fit to Ebbinghaus's data (p. 19); the MCM's improvement over the power function is explicitly **not** judged "meaningful" by the authors' own AIC criterion (pp. 16, 19). On sleep as a candidate mechanism for the 24-hour jump, the authors are hedged, not conclusive: "Current research on the effects of sleep on memory would predict such a jump, but for this particular type of experiment this remains to be established" (p. 21).

**What is therefore not supported.** A "two-component curve, a fast early drop over a slow residual tail" is **not** how the paper characterizes forgetting generally — that phrase, and the term "two-component," appear nowhere in the source. The MCM (the closest candidate to a two-store picture) is presented as one of four comparably-fitting models, not the paper's conclusion, and the authors' own best-fit verdict goes to the single-process power function instead. Similarly, nothing in the paper ties the shape of decay, or the depth of any "tail," to "the depth of original encoding" — no such variable or claim appears in the text.

**Verdict:** Consistent with the precise savings figures (47.2%→4.1% in the replication; 58.2%→21.1% in Ebbinghaus's data, both Table 3, p. 10) and the 24-hour-jump finding (p. 1), with the sleep mechanism correctly hedged as unestablished. **Not** consistent with any claim that the paper establishes a general "two-component curve" shape for forgetting, or that any curve's tail depth depends on "depth of original encoding" — neither is in the source; the paper's own best-fit model is the single-process power function, and the MCM/summed-exponential two-store model is one of four candidates it tested, not its conclusion. `measurement-hypotheses-deep-dive.html` §2 was corrected 2026-10-07 to drop the two-component/encoding-depth framing and state the savings figures, the 24-hour jump, and the hedged sleep mechanism directly.

**Audited 2026-10-07 against held full text (citation-audit skill).**
