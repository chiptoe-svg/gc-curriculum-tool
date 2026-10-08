# Larkin, McDermott, Simon & Simon (1980) — Models of Competence in Solving Physics Problems

**Full citation:** Larkin, J., McDermott, J., Simon, D. P., & Simon, H. A. (1980). Models of Competence in Solving Physics Problems. *Cognitive Science*, 4(4), 317–345. Companion to Chi et al. — experts use forward-chaining strategies that novices cannot access for lack of schemas.

**Also carded in:** `ai_career_impact/library/cards/future_of_gc/load_bearing/larkin-1980.md` (private) — imported from the "Future of GC" project; may read the source through a different lens. **Factual corrections (citation, version, figures, page refs) are mirrored to the other card and announced to the other repo.**

**Reference ID in background.html:** `ref-larkin-1980`; cited in §4.

**Where it lives:**
- DOI: https://onlinelibrary.wiley.com/doi/10.1207/s15516709cog0404_1
- Semantic Scholar: https://www.semanticscholar.org/paper/Models-of-Competence-in-Solving-Physics-Problems-Larkin-McDermott/9aa7356b07a17a34a2e372e2f380e7503febdada
- CMU library archive: https://iiif.library.cmu.edu/file/Simon_box00067_fld05154_bdl0001_doc0001/Simon_box00067_fld05154_bdl0001_doc0001.pdf
- Jim Davies summary: http://www.jimdavies.org/summaries/larkin1980.html
- Open-access status: Paywall (Wiley). Some versions may be accessible via CMU library archive.

**Accessibility:** Verified accessible (via Jim Davies summary) — detailed secondary summary and description of forward/backward chaining. The CMU archive PDF is available.

**What the background doc claims it says:** Experts use forward-chaining strategies that novices cannot access for lack of schemas. The paper converged on parallel findings to Chi et al.: experts recognize which physics principles are triggered by a problem and chain forward from known quantities to unknowns.

**What it actually says (synthesis):** This paper by Larkin (Carnegie Mellon), McDermott, and the two Simons describes two computer-implemented models of physics problem-solving that simulate the behavior of more and less competent human solvers. The models provide accounts of solution strategies in kinematics and dynamics problems.

The critical finding about forward vs. backward chaining: novices typically use means-ends analysis (backward reasoning) — they start from the unknown they are trying to find, identify what equation could give them that unknown, find what inputs that equation needs, and work backward to find those inputs, continuing until they reach what they know. This is cognitively demanding because the solver must hold a complex goal stack in working memory.

Experts, by contrast, use forward chaining — they start from what they know, recognize that the problem state matches a familiar pattern (schema), and immediately apply the appropriate principle to compute the next intermediate quantity. This process continues until the answer is reached. The key insight is that experts do not need to maintain a goal stack because each step is directly triggered by the recognition of a pattern in the current problem state.

The paper demonstrates computationally that forward chaining (what the authors call the "knowledge-development," KD, model) "correspond[s] to the work of our skilled solvers," while the means-ends ("backward") model "correspond[s] to the work of many novice solvers" (Summary, p. 343) — a mapping of strategy to expertise level, not an absolute barrier. **Correction (citation audit, 2026-10-07; LA2, substantive):** "novices cannot access [forward chaining]" overstates the paper's own data. The paper explicitly reports the opposite in places: "some novice subjects do begin their work by finding values..." (p. 336) — i.e., some novices do start forward, typically driven by algebraic habit rather than physics-schema recognition: novices have "little knowledge of physics, but much more of algebra" (p. 342), which can produce forward-looking moves without the expert's principle-triggered schema. The paper's claim is a strong *tendency* (experts forward-chain via schema recognition; novices more often backward-chain via means-ends analysis), not a strict novices-cannot-access-forward-chaining barrier.

Jill Larkin's contribution also includes the concept of *physical representations* — experts translate verbal problem descriptions into implicit mental representations of the physical situation (force diagrams, etc.) that directly suggest solution paths, while novices remain at the verbal/symbolic level.

**Correction (citation audit, 2026-10-07; LA1, minor).** "The same year" (as Chi et al. 1981) is wrong: this paper's own printed date is **1980** ("Cognitive Science 4, 317–345 (1980)," confirmed in the running header and byline block), a year *before* Chi, Feltovich & Glaser (1981) — "a year earlier," not "the same year."

**Verdict:** Consistent on the core forward/backward-chaining and expert/novice mapping (confirmed by the paper's own Summary, p. 343). Not consistent on two points, both corrected above: (1) "novices cannot access" forward chaining overstates the data — some novices do chain forward via algebra rather than physics schemas; (2) this paper predates Chi et al. (1981) by a year, not "the same year." The doc's framing of the two papers as companions reaching mutually reinforcing conclusions remains fair; only the timing and the absolute "cannot access" language needed correction.

**Audited 2026-10-07 against held full text (citation-audit skill).**
