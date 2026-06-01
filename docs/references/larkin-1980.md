# Larkin, McDermott, Simon & Simon (1980) — Models of Competence in Solving Physics Problems

**Full citation:** Larkin, J., McDermott, J., Simon, D. P., & Simon, H. A. (1980). Models of Competence in Solving Physics Problems. *Cognitive Science*, 4(4), 317–345. Companion to Chi et al. — experts use forward-chaining strategies that novices cannot access for lack of schemas.

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

The paper demonstrates computationally that forward chaining requires extensive domain-specific schemas — knowledge structures that map from problem configurations to relevant physical principles. These schemas are not innate; they are acquired through extensive practice solving physics problems. Novices cannot forward-chain because they do not yet have the schemas to recognize which principles apply to a given configuration.

Jill Larkin's contribution also includes the concept of *physical representations* — experts translate verbal problem descriptions into implicit mental representations of the physical situation (force diagrams, etc.) that directly suggest solution paths, while novices remain at the verbal/symbolic level.

**Verdict:** Consistent. The background doc's characterization — "experts use forward-chaining strategies that novices cannot access for lack of schemas" — accurately represents the paper's core finding. The doc's framing of this as a "companion to Chi et al." converging on parallel findings is appropriate: the two papers were published in the same journal in the same period, used related methods, and reached mutually reinforcing conclusions about the centrality of organized domain knowledge to expert problem-solving.
