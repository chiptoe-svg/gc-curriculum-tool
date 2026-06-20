# Curriculum Measurement — Working Hypotheses: Durability, Competency→Career Cross-walk, and an Uncertainty Discipline

**Date:** 2026-06-19
**Status:** HYPOTHESIS — not specced, not built, not sequenced. **To revisit.** This is a recorded line of thinking, deliberately preserved because it is high-value and unresolved.
**Origin:** A review of the skill-mapping / skills-intelligence literature (June 2026) cross-examined against the framework, which surfaced three interrelated hypotheses about what the framework measures and how. Companion to the [O*NET research memo](./2026-06-15-occupational-frameworks-onet-research.md) (which this extends with a concrete data source — Course-Skill Atlas — and a durability model the earlier memo did not have).

---

## TL;DR

Three hypotheses, one resolved conceptual question, one actionable first step.

- **(B) Durability / "bleed-off"** — *the headline, a genuine gap in the current model, and arguably higher-value than (A).* KUD scores are *instantaneous* (end-of-course) depth; **durable graduation-time depth is a different quantity the model currently conflates.** Depth decays between courses unless reinforced; repeated + varied reinforcement consolidates; and high-depth attainment "pulls up" related neighbors (knowledge integration). **This is where "common threads through the curriculum" live** — a competency reinforced across courses into a durable, career-relevant capability. Splits into **B1 (structural, buildable now)** and **B2 (quantitative, gated on graduate-outcome data)**.
- **(A) Competency→career cross-walk** via Course-Skill Atlas — operationalizes the O*NET memo's recommendation using a ready-made national O*NET-DWA-by-major dataset. Fuzzy-by-construction; external validation, not backbone. Should map *durable* depth (B), not instantaneous.
- **(C) Uncertainty / convergence discipline** — *the load-bearing one.* There is no reliable oracle (humans and LLMs are both unreliable adjudicators); the residual error is **mostly irreducible** (label noise + genuine ambiguity + under-specified inputs), so the job is to **represent and manage uncertainty, not chase it**.
- **Resolved conceptual question:** "embeddings vs attention vs depth-factored embedding" — the distinction is *informational/representational, not mechanistic*. KUD+depth **is** the orthogonal factorization a generic embedding entangles.
- **Actionable now:** a **structural competency-thread measurement over existing snapshots** — the smallest thing that simultaneously *teaches* whether bleed-off matters for GC and *builds* the data foundation B2 / A / outcome-validation all plug into.
- **Scale representation (§4.2, 2026-06-20):** *integer at the boundary, float in the model.* Faculty judgments stay **integer 0–5** (the scale is ordinal with anchored rungs — a 3.5 has no behavioral anchor); every **derived** quantity — decay, neighbor-foundation, pull-up — is **float carrying an SEM-style interval**, because rounding mid-computation erases the partial-erosion-below-the-next-rung signal that is the whole point of B. Interval-not-point is the (C) contract applied to B's arithmetic.
- **Deep dive (§2.7 / §4.1, 2026-06-20) added three load-bearing results:** **(B)** the phenomenon is well-grounded and B2 has a *borrowable form* — spaced-repetition memory models (**Half-Life Regression / FSRS**, where a `Stability` term grows with each spaced success) — lifted to (competency × course) scale, which **no prior model does**; but the "pull neighbors up" extension must be modeled *conservatively* (transfer literature is pessimistic — bound it to **Knowledge-Space-Theory** surmise-neighbors, never auto-lift on depth). **(C)** every plank has a formal home (**Generalizability Theory / SEM / Many-Facet Rasch**, aleatoric uncertainty, **label-convergence ceiling**, perspectivism, selective prediction) — it is the *best-supported* hypothesis. **⚑ Priority-changer:** ensemble convergence provably **cannot** cancel the *correlated systematic bias* all LLM judges share (a 9-judge panel ≈ 2 effective votes; Kim et al. ICML 2025, Kohli 2025), so **graduate-outcome validation is the structurally necessary check — not optional** — and it is the *same* dependency that gates B2's parameters.

---

## 1. How this arose — the literature trajectory (the "great stuff" from the lit review)

The 2017 papers the inquiry started from (**skill2vec**) are word2vec-inspired *co-occurrence* skill embeddings — two independent works, same name: Le Van-Duyet et al. (job descriptions, recruitment) and Wong et al. (learning data, education). The field then moved through four arcs:

1. **Co-occurrence → contextual → ontology-grounded embeddings.** Static skill vectors gave way to contextual ones (JobBERT) and then to **anchoring against a standard taxonomy** — ESCO became the de facto standard, with the dominant pattern now "embed text + taxonomy skills into a shared space, retrieve nearest, threshold" (ESCOXLM-R, CareerBERT, contrastive bi-encoders, Decorte et al.).
2. **Prerequisite structure became its own GNN subfield** — Concept Prerequisite Relation Prediction (link prediction on a concept graph), with recent work tackling *direction* (permutation-equivariant directed GNNs; GKROM). This is the directional relationship co-occurrence embeddings structurally cannot represent.
3. **LLMs took over extraction (2024+)** — few-shot in-context "extract span → align to ESCO" pipelines beat supervised sequence labeling.
4. **Curriculum→competency mapping became a benchmarked task (2024–2026)** — UniSkill (curriculum↔ESCO matching), Course-Skill Atlas (national O*NET-DWA-by-major), "From Course to Skill" (a methods bake-off), and the 21st-century-competencies LLM benchmark.

**Where the framework sits relative to all this:**
- *Ahead* on the part the field has barely touched — **depth + assessed-student-evidence**. Almost all of this work is *text → skill mention* (does the document express the skill); very little scores *whether students demonstrably reach it, at what depth, from graded artifacts.*
- *Aligned* with the current best method — **retrieve-then-reason** (embedding shortlist → LLM judge). "From Course to Skill" measures this directly: pure embedding similarity ≈ **24%** precision, retrieve-then-reason (RAG) ≈ **70–82%**. The framework's `search_curriculum`→agent design is already this.
- *Behind* on **standard-taxonomy anchoring** (ESCO/O*NET interoperability) — which is exactly what hypothesis (A) addresses, as an external check, never a backbone.

**Two findings from this literature were already wired into the docs** (2026-06-19): the 21st-century-competencies paper (Xu et al. 2026) into `background.html` §7 as empirical support for the evidence-above-zero rule (its inter-rater κ collapsed to 0.17–0.29 on abstract competencies until evidence-vs-aspiration was separated; no LLM reaches human precision on fine-grained pedagogical judgment, dominated by *keyword-inference inflation*); and "From Course to Skill" (Xu et al. 2025) into `architecture.html` as validation of the spine's retrieve-then-reason split. The rest of the synthesis lives here.

---

## 2. Hypothesis B — Durability / "bleed-off" (the headline)

**Framing — this is where "common threads through the curriculum" live, and why B is arguably higher-value than A.** The animating goal is to *find the common threads that string between classes, through a curriculum, and into career paths.* A thread is not a single similarity score — it is a *typed, depth-conditioned progression*: a competency that appears in one course, deepens across several, and (via the cross-walk, A) feeds a career destination. **Durability is the model of which threads actually hold:** a thread hit once decays (bleed-off); a thread reinforced across courses and modalities sticks. So B is the home of the through-line *within* the curriculum, A extends it the last hop *into* careers, and finding the threads at scale is the same retrieve-then-reason pipeline throughout — similarity proposes candidate threads (recall), depth-aware reasoning confirms which are real and at what depth (adjudication). Because the thread *through* the curriculum is the prerequisite for any honest claim *into* careers, B is the more foundational of the two.

### 2.1 The gap
A KUD score certifies depth **at the end of a course**. But the question the program cares about — Q1, careers — is about depth **at graduation**, after the rest of the curriculum has happened. These are different quantities, and the current model conflates them. A lone D4 reached freshman year and never revisited is not a D4 at graduation; it has decayed.

### 2.2 The two forces
- **Decay / "bleed-off."** Between exposures, attainment fades — operator's working assumption: roughly a level, absent reinforcement. (Forgetting curve; spacing effect; "desirable difficulties.") Same engine as the framework's own problem-solving thesis (`background.html` §4): competence develops through *repeated cycles*, not a single peak.
- **Consolidation.** *Repeated + varied* reinforcement ("hammered home in several different ways") makes depth durable. Operator: "two or three D4's in a related area resolve to a D4 that sticks." Variety matters, not just count (varied practice > massed).

### 2.3 The "pull neighbors up" extension (knowledge integration)
Durability is not per-competency-in-isolation; it operates over a **similarity neighborhood**. High-depth attainment in a competency *lifts related neighbors* — this is the **integration** dimension of expertise (Chi/Glaser expert–novice: deep knowledge is *connected*, principle-organized knowledge, which is more durable and transferable; and the connectedness **emerges at depth** — novices hold isolated, surface-sorted fragments). So the lift is **depth-gated**: a D1 fragment pulls nothing; a D4 schema-node holds its neighbors up. This is the same "color management ↔ color measurement converge at high depth, split at low depth" observation from the O*NET memo, now used as a *retention mechanism*, not just an adjudication caution.

**This gives similarity/embeddings a legitimate role in B** — defining the reinforcement *topology* (which competencies are neighbors), which is distinct from adjudication: embeddings propose the neighborhood; depth-aware reasoning decides the pull-up strength. (Consistent with "embeddings shortlist, don't adjudicate.")

### 2.4 Mechanism — operator lean: **durability primarily, maybe both**
Two readings of "pull up": (i) **durability-lift** — a high-depth neighbor slows a related competency's *decay* (it's embedded in an active, integrated schema); (ii) **level-floor** — reaching D4 in A entails a floor on a subsumed neighbor B (you can't manage color at D4 without competent measurement). Operator leans durability, possibly both. Must be **directional (integrative → foundational), bounded, and depth-gated** to avoid runaway A↔B inflation and false-equivalence (the Nesta "understand the bigger picture" ≈ "interpret technical diagrams" failure).

**Literature directionality (asked explicitly):**
- **Durability-lift is bedrock** — elaboration / levels-of-processing (Craik & Lockhart), schema theory, spreading-activation networks (more connections → more retrieval routes → slower forgetting), spacing + retrieval practice (Cepeda et al.; Roediger & Karpicke), and the expert–novice integration finding the framework already cites (Chi). Robust.
- **Level-floor is structurally supported but empirically softer** — its formal grounding is **Knowledge Space Theory** (Doignon & Falmagne, *already in `background.html` references*): the surmise relation says competence in a higher item implies competence in its prerequisites; Gagné's learning hierarchies say the same. *But* empirically the entailment is a tendency, not a law (people compensate; composite mastery can hide component gaps), so assuming it **over-credits**. → the durability lean is the better-evidenced one.

### 2.5 The split that keeps this honest
- **B1 — structural durability (buildable NOW, no gated data).** Over existing snapshots, flag each competency as a *lone peak* (one high-depth hit, never reinforced → decay-risk) vs a *reinforced thread* (multiple, varied, across the sequence → likely durable). Qualitative. **Enriches the existing scaffolding analysis** — makes it *durability-aware*, not just the introduce→practice→integrate pattern.
- **B2 — quantitative durability (DEFERRED, gated on data).** An actual decay-rate / consolidation function → a numeric durable graduation-time depth per competency. The parameters (decay per gap, exposures-to-consolidate, variety weighting) are **empirical unknowns** that must be **validated against graduate outcomes**, never hard-coded — otherwise it is exactly the pseudo-precision the framework refuses. Gated on the [graduate-outcome-validation](../../graduate-outcome-validation.html) work.

### 2.6 It also sharpens Q2 (prerequisite gap)
"Do the prerequisites students walk in with support what the course expects?" is *itself* a bleed-off question: the prerequisite's *relevant* depth is its level **when the dependent course starts**, not when the prerequisite course ended. Bleed-off is *why* prerequisites fail. So B is not only a scaffolding enrichment; it is the missing temporal dimension of the prereq-gap analysis.

### 2.7 Literature grounding (deep dive 2026-06-20)

A five-cluster literature dive confirms the *direction* of B is well-supported, supplies a **borrowable computational form** for B2, identifies a **genuine curriculum-scale gap**, and forces the **pull-up extension to be modeled conservatively**.

**(a) The decay phenomenon is real and large — but the parameters are extrapolations, and decay is front-loaded, not a linear step-down.**
- Forgetting is a **two-component curve** (fast early drop + slow residual tail), not a single rate (Murre & Dros 2015, *PLOS ONE*, replicating Ebbinghaus: ~50% retained at 20 min → ~18% at 31 days). The residual tail depends on *depth of original encoding*.
- **Cognitive skills decay ~1 SD per year of non-use** (Arthur, Bennett, Stanush & McNelly 1998, meta-analysis: d → −1.4 after >365 days; cognitive/accuracy tasks decay *faster* than physical/speed tasks — most academic learning is in the fast-decay class). This is the order-of-magnitude anchor for "bleed-off," but it is in SD units, **not KUD levels** — the "~1 level per course" figure is a *reasonable extrapolation, not an empirical finding*.
- **Permastore is the existence proof for "durable depth ≠ instantaneous depth"** (Bahrick 1984, 50-yr study): learning past a depth/repetition threshold (≈3–5 semesters) enters a stable plateau lasting decades; shallow single-exposure learning decays to ~zero. This *validates the core B distinction* as two genuinely different states.
- **Caveat to record:** decay is front-loaded (most loss in days–weeks after last use), so a student who last exercised a skill at the *midterm* of the prior course has less at that course's end than one who used it at finals — the inter-course gap is not the only clock.

**(b) B2's machinery is borrowable — spaced-repetition memory models, not knowledge tracing.** The most reusable mechanism is **Half-Life Regression** (Settles & Meeder 2016, ACL/Duolingo): recall `p(t) = 2^(−t/h)` with a half-life `ĥ = 2^(θ·x)` that **grows multiplicatively with each spaced successful exposure** — exactly the decay-plus-consolidation shape B needs, and a *shallow* model fittable without ITS-scale logs. **FSRS** (Anki default) is the empirically superior form (power-law retrievability `R(t,S)`, a `Stability` that grows more when retrieval happens under partial forgetting — the spacing effect built in, and a per-item `Difficulty` that maps to "D-dimension is harder to consolidate than K"). By contrast, **Bayesian Knowledge Tracing hard-codes no-forgetting** and **DKT-family models need millions of interaction events** we don't have; their only portable piece is HawkesKT's exponential decay kernel. **AFM/PFA** answer the *complementary* question (how many exposures to reach mastery) but model no time-decay — useful for the consolidation-count side, not the bleed-off side.

**(c) The honest gap: nothing operates at curriculum/degree scale.** All of KT and SRS is single-course, single-platform, or flashcard-grain. No published model tracks competency mastery as it builds, decays, and consolidates **across a sequence of courses taught by different instructors on different timelines.** B2 is therefore *novel at that scale* — the contribution is *lifting* an HLR/FSRS-style stability model from item-level to (competency × course) cells (course-level exercises = "reviews", inter-semester weeks = elapsed `t`), not inventing decay math.

**(d) "Pull neighbors up" is the weakest claim — model it conservatively, bounded, and depth-AND-proximity-gated.** Within-domain integration/acceleration *is* supported (Linn's Knowledge Integration: connection-making stabilizes ideas; Witherby & Carpenter 2021 "rich-get-richer": prior knowledge predicts new learning — but **only within the same domain**, three replications). But the **transfer literature is the strong counterweight**: far transfer is famously fragile — Sala & Gobet (2017) find near-zero far transfer with active controls; Perkins & Salomon's high-road transfer requires *deliberate bridging*, not automatic spillover. **Verdict: pull-up should be a *conditional, bounded* effect**, fired only between competencies in a demonstrable prerequisite/"surmise" relation (**Knowledge Space Theory**, Doignon & Falmagne 1985 — which also gives the *falsifiable, principled* definition of "neighbor" §7-Q4 asked for), requiring evidence of integration (not depth alone), and **never generalized across domain-distant pairs.** A model that auto-elevates neighbors on depth alone would *systematically overestimate* cross-competency strength — the exact pseudo-precision the framework refuses.

**Net for B:** the phenomenon and the two-state distinction are solidly grounded; B2 has a clean borrowable form (HLR/FSRS) and a real novelty (curriculum scale); the pull-up must ship as a *cautious, KST-bounded* mechanism, not an automatic lift. None of this unblocks B2's *parameters* — those still wait on graduate-outcome data (§2.5). The dive raises confidence in the *structure*, not the numbers.

---

## 3. Hypothesis A — Competency→career cross-walk via Course-Skill Atlas

Operationalizes the O*NET memo's recommendations #2/#3/#4. **Course-Skill Atlas** (Javadian Sabet et al., 2024, *Nature Scientific Data*) computed national **O*NET Detailed-Work-Activity (DWA) coverage by major (CIP)** over ~3.16M syllabi — turning the memo's expensive "hand-extract GC-SOC Tasks/DWAs" into "pull the GC slice," and adding a benchmark the memo lacked ("the national GC curriculum's DWA profile vs. our captured coverage").

**Design commitments (driven by the operator's point that skill-to-skill mapping is not a perfect science — names don't match):**
- **Many-to-many and partial, never 1:1.** A weighted bipartite relation, not a lookup.
- **A match-quality stamp on every edge** (strong / partial / weak / none) — mirroring the prerequisite "basis" stamp.
- **"No clean match" is a first-class, asymmetric *finding*:**
  - *our competency ↔ no DWA* → O*NET is too coarse for that GC specific (Typography, Color Science, Press Chemistry — flagged in the memo). A finding about **O*NET's blind spot, not ours.**
  - *high-coverage DWA in the national profile ↔ no match to our competencies* → a candidate **blind spot in our framework** (memo rec #2: "catch competencies we've missed").
- **Pipeline:** embeddings shortlist → depth-aware LLM/human adjudicate → near-miss queue (embeddings have a ~52% recall ceiling, so faculty must be able to *add* matches the shortlist missed).
- **Known risks:** 2 of 5 targets have no clean SOC home (AI Workflow Orchestrator; Creative Generalist).
- **Should map *durable* depth (B), not instantaneous max** — else it re-imports the bleed-off error into the career-readiness claim.

Empirical anchors: "From Course to Skill" (embedding-only ~24% vs RAG ~80%); Course-Skill Atlas's "~9 syllabi for a stable major profile" (a useful prior for *how many course captures* stabilize a program-level aggregate).

---

## 4. Hypothesis C — Uncertainty / convergence discipline (the load-bearing one)

**There is no reliable oracle.** LLMs reach ~80% (worse on fine-grained pedagogical reasoning — Xu et al. 2026); and *humans are unreliable adjudicators too* (bias, assumptions; operator's own estimate of subjective skill-judgment is "well below 80%"; the κ-collapse data confirms experts disagree on abstract competencies). So the loop is **not** "the human corrects the AI to truth."

**The residual error is mostly irreducible** (an honest correction made during this discussion): the ~20% is dominated by **label noise + genuine ambiguity + under-specified inputs** — not a tidy "missing knowledge" gap. You cannot exceed the reliability of your own labels; against an ~80%-self-consistent reference, an 80% model may be near the ceiling. (There is *some* genuine model-below-human headroom — Curricular CoT got modest gains — but we do not have the decomposition, and we should not assume the residual is engineerable away.)

**Therefore the job is to represent and manage uncertainty, not chase it.** The reliability comes from *triangulation and transparency*, not any single judge:
- **evidence over estimation** (point at graded artifacts, don't estimate — the evidence-above-zero rule already does this);
- **confidence-stamped, revisable claims**, never truths;
- **convergence across independent, differently-biased signals** (embedding + LLM + multiple faculty + student evidence) — agreement is meaningful, *disagreement is surfaced as uncertainty, not falsely resolved*;
- **graduate-outcome validation** as the only real check on *systematic* bias.

This reinforces the framework's existing honest framing ("stronger as a conversation engine than a measurement instrument"): the claim is **comparative** (more evidence-grounded, explicit, contestable, and aggregable than committee oral-tradition), never **absolute**. (C) is a **representation contract** every derived claim conforms to — decided once, applied inside B and A (its scale-representation clause is §4.2); it is not a standalone build (the basis stamp + evidence rule are precedent).

### 4.1 Literature grounding (deep dive 2026-06-20) — C is the best-supported hypothesis, and the dive *upgrades* the role of graduate-outcome validation

Every plank of C has a formal home, and one finding is strong enough to change a priority.

**(a) "No reliable oracle" is empirically nailed down.** Trained-human inter-rater reliability on open-ended competency/essay scoring realistically lands at **κ/ICC ≈ 0.40–0.70**, and *worse* for soft/abstract constructs (essay raters mean r ≈ 0.54, Casabianca et al. 2017; a high-stakes teacher performance assessment scored **κ = 0.17**, Goldhaber/edTPA studies; clinical portfolios ICC 0.38–0.44). The Landis–Koch "good ≥ 0.61" bar is *rarely* cleared without narrow, heavily-anchored conditions. So C's "humans aren't a clean oracle either" is the empirical norm, not pessimism.

**(b) The measurement-theory home of "manage uncertainty, don't chase it" is Generalizability Theory.** G-theory (Cronbach et al. 1972; Brennan 2001) decomposes score variance into **rater / item / occasion facets**, and the **D-study** says *where investment actually buys reliability*. The load-bearing, counterintuitive result: **adding raters often buys almost nothing while adding items/tasks buys a lot** (illustrative two-facet design: 2→8 raters lifts Eρ² 0.62→0.69; 2→8 tasks lifts it 0.62→0.82). Translation for us: when faculty disagree, the answer is usually *more/better evidence items*, not more adjudicators. **SEM** (`SD·√(1−r)`) is the formal "confidence-stamp" — at r≈0.65 on a 5-pt scale the 95% band exceeds ±1 level, so **scores within ~1 SEM are ties, and the honest output is an interval, not a point.** **Many-Facet Rasch** (Linacre) is the formal "disagreement-as-signal": model rater severity as a *facet to calibrate*, not noise to average.

**(c) The "irreducible residual" has a precise name and a measurable ceiling.** It is **aleatoric uncertainty** (Hüllermeier & Waegeman 2021) — inherent to an ambiguous construct, *not* reducible by more data or a better prompt. And the ceiling is quantifiable: **label reliability bounds achievable accuracy** ("label convergence," Bartz et al. 2024: `mAP ≈ 0.836·α + 0.197`; SOTA detectors are already at their annotation-agreement ceiling). So "you cannot exceed the reliability of your own labels" is a theorem we can cite, and the right response is to *characterize and report the ceiling*, not engineer against it. Disagreement-as-signal is the **data-perspectivism** program (Plank 2022; Aroyo & Welty 2015, "Truth is a lie"): the *distribution* over raters is the finding.

**(d) The convergence machinery is standard — and so is its limit.** Internal confidence has off-the-shelf forms: **self-consistency** (Wang et al. 2022 — sample K scorings, the spread is the uncertainty), **panel-of-LLM-judges** (Verga et al. 2024), **calibration/ECE** (Guo et al. 2017), and **selective prediction / learn-to-abstain** (Geifman & El-Yaniv) — the rigorous version of "flag low-confidence rather than guess" (e.g., route items with cross-pass agreement < ~0.70 to human review).

**(e) ⚑ The finding that changes a priority: ensemble convergence canNOT touch shared systematic bias — so graduate-outcome validation is not optional.** Wisdom-of-crowds only cancels *independent, zero-mean* error. But LLMs have **correlated** errors from shared training: they agree ~60% of the time *when both are wrong*, and larger/better models are *more* correlated (Kim et al., ICML 2025); a 9-judge panel from 7 families delivers an **effective sample size of ≈2.18 — only ~24% of theoretical independence** (Kohli 2025), and the single best judge can match the panel. Any bias all our LLM judges share — e.g., inflating K because syllabi use recall-verbs, or rewarding detailed syllabi — survives *every* panel size. **The only check on that error layer is comparison against an external signal the models didn't generate: the [graduate-outcome study](../../graduate-outcome-validation.html).** This reframes it from "nice external validation" to **the structurally necessary instrument for the one error class convergence cannot reach** — and it means B2's parameters (gated on exactly that data) and C's bias-check are the *same* dependency.

**Net for C:** it is the **best-supported** of the three hypotheses — every plank maps to an established result (G-theory, SEM, MFRM, aleatoric uncertainty, label-convergence, perspectivism, selective prediction). The dive's one *action-changing* output is (e): elevate graduate-outcome validation in the sequencing, because ensembling provably cannot substitute for it.

### 4.2 Scale representation: integer judgments, continuous derivations (2026-06-20)

A representation decision B and C both depend on, recorded here because it is the (C) contract applied to B's arithmetic: **integer at the boundary, float in the model.**

**Faculty input / storage / display of *direct* judgments stays integer (0–5).** The depth scale is **ordinal with anchored rungs** — each integer has a behavioral definition (`lib/ai/prompts/shared/depth-scale.md`); a 3.5 has *no anchor* (there is no defined behavior halfway between "recall" and "use correct terminology"). Soliciting decimals would invent precision faculty cannot reliably produce and would collapse the already-hard inter-rater reliability (§4.1a). The evidence-above-zero gates are themselves integer thresholds (K above 1; U/D above 0). Keep faculty on integers.

**Every *derived* quantity is float, because the operations themselves produce continuous values — rounding mid-computation destroys the signal:**
- **Decay / durability (B2):** `depth(t) = depth₀ · e^(−t/τ)` (or an HLR/FSRS retrievability × elapsed `t`) returns a real number; the entire point of modeling bleed-off is to catch *partial* erosion **below** the next rung (a D4 → D3.2), which integer rounding erases.
- **Neighbor-foundation / prereq-gap (Q2, §2.6):** a depth-weighted aggregation over upstream prerequisites (weighted by curriculum-graph edge strength) is a float; the load-bearing output is the **gap** = expected-entry-depth − supplied-depth, where 0.3 vs 2.1 is a real, decision-relevant distinction.
- **Pull-up / reinforcement (§2.3):** a partial increment / decay-slowing contribution — continuous by nature, never an integer level-bump (a D2 touch does not promote a D4 to D5; it adds a fractional boost and slows decay).

**Two guardrails:**
1. **Never write a float back into a faculty-score field, and never *display* "D3.2" to faculty** — that re-imports false precision into their mental model. Show derived results as **bands / arrows** ("entered D4 → est. D3.1 at graduation, erosion flagged"); keep the raw float internal for ranking/thresholding.
2. **Treating the 0–5 ordinal as interval (so that 4−2 == 3−1) is an *assumption*, not a fact** — the same simplification every GPA and Likert-mean makes, defensible but to be stated explicitly, *because (C) forbids over-claiming precision.* Its corollary is the honest form of every derived value: not a point but a distribution — **"D3.1 ± 0.6"** — which is exactly the **SEM / interval-not-point** output §4.1(b) already requires. The float layer therefore carries an uncertainty band, not just a number.

**Net:** integers are the observations (anchored, faculty-facing, gate-defining); floats-with-intervals are the model (degradation, foundation, pull-up). The boundary between them *is* the (C) representation contract.

---

## 5. The embeddings / attention / depth-factored question (resolved)

The recurring question — *"how is this fundamentally different from token embeddings + attention + orthogonal embeddings, which work well in practice?"* — resolves cleanly:

- **There is no fundamental mechanistic difference.** Attention can represent asymmetric, depth-conditional, hierarchical relations. The limitation of static-embedding *cosine* is **informational**: one fixed vector per term, a symmetric scalar, no slot to condition on depth. The *same* attention mechanism succeeds once the depth scale + competency definitions + evidence are **in context** — that is the 24% → 80% jump. It's "generic context-free representation vs. task-specific-context representation," not "embeddings vs. reasoning."
- **KUD + depth *is* the orthogonal factorization** a generic token embedding entangles. The framework already separates "which competency × which dimension (K/U/D)" from "how deep (0–5)" — by hand. A "depth-factored vector space" (depth as an explicit learned orthogonal axis, content on another) would be the *continuous, learned* version of what the framework authors discretely.
- **A depth-factored embedding is a cost/scale optimization, NOT an accuracy win.** Given §4's conclusion that the residual is largely irreducible, a fancier representation will not move an accuracy number bounded by label reliability. It would only be justified if depth-aware similarity is needed across the *whole* competency graph at a scale where per-pair LLM calls are too expensive. **Default: supply depth-in-context to the LLM** (simple, validated, auto-adapts as the depth scale evolves). Revisit the learned embedding only for scale.

### 5.1 Domain-specific embedding engines (researched 2026-06-19)

A distinct question from depth-factoring: would a **domain-tuned** embedder (vs. the generic campus Qwen) materially help? Deep-dive findings:

- **The general claim holds, but it is a *recall*-stage win, not a depth-adjudication one.** Domain embedders beat generic ones by a real-but-bounded margin: voyage-finance-2 **54% vs 38.5%** (OpenAI `3-small`) on SEC filings; voyage-law-2 **+6% avg / >10%** on legal sets (trained on +1T legal tokens, custom contrastive); MatSciBERT/ChEmbed report "domain training indispensable" for materials/chemistry. The gain lands on **candidate surfacing** — it makes in-domain vocabulary (e.g., *color management* ↔ *color measurement*) land near each other. It does **not** carry the depth-conditioned entailment ("converge at high depth, split at low"); that stays a reasoning-layer job. So a domain embedder **improves the "retrieve" half of retrieve-then-reason** and composes with §5's depth-in-context — it does not replace either, and the ~24%→~70–82% static-cosine-vs-RAG gap stands.
- **The leaderboard trap (the sharpest practical finding).** Per FinMTEB, a model's general-benchmark (MTEB) rank **does not predict** its domain performance (Spearman insignificant, p > 0.05; general models drop 1.9–8.6 pts on finance). We therefore **cannot pick our embedder by its general score** — the only valid test is on *our* data. This is actionable now, independent of any custom training.
- **Education axis — engines exist and are tractable.** The skill/competency line already in this memo (JobBERT, ESCOXLM-R, CareerBERT, Decorte bi-encoders, UniSkill) *is* a set of curriculum↔career embedders; there are also education/professional-training sentence-embedding frameworks for competency-taxonomy classification, curriculum-alignment SBERT fine-tunes (PEO→PO), and academic embedders (SPECTER2, SciBERT). These are reusable/adaptable off the shelf.
- **Print / graphics / packaging axis — the gap is real.** Searched directly: **no off-the-shelf print/graphics/packaging embedder exists** ("graphic communications" hits are degree programs, not models). Closest *adjacents*: materials-science models (MatSciBERT, MatBERT, MELT — substrates/inks/polymers/adhesives), chemistry (ChEmbed — inks/coatings/colorants), and emerging perceptual-color↔text work (relevant to color management). Getting a GC-domain model means **building** one — and the commercial wins above used massive continued pretraining (1T+ tokens; Harvey's legal model 20B+). We have nothing near that. The realistic regime is the cheap end — **adapter-based or contrastive fine-tuning on synthesized pairs + a small labeled set** (modest compute, few epochs) over our own ~1,296 spine chunks across 47 courses plus GC literature (TAGA proceedings, packaging journals). That buys recall gains, not a Voyage-grade model.
- **Net:** the high-ROI move is **not** training anything yet — it's an empirical embedder bake-off on our data (next-actions below). A custom print/packaging fine-tune is a *second*, gated step, justified only if the bake-off shows the generic embedder is the bottleneck **and** the failure is recall (not depth adjudication).

---

## 6. What's actionable now — and what's deferred

**Actionable (the first brick): a structural competency-thread measurement over existing snapshots.** For each competency, compute from already-captured data: its sequence of exposures (course, KUD depth, curriculum order, variety), and a structural-durability flag (lone-peak vs reinforced-thread), every flag confidence/provenance-stamped (the (C) contract realized by application). **Run it as a measurement/report first** — no new capture, no new model, no gated data.

Why this is the right first move (it is simultaneously *learn* and *build*):
- **Learn:** it answers, with evidence, the questions this whole thread circled — *is bleed-off even prevalent in GC, or is most depth already well-reinforced? Are the similarity-neighborhoods real and clean? Where are the lone-peaks?* None of B2 / A can be designed honestly until this is seen.
- **Build:** the "exposures × depth × sequence × variety per competency" structure **is** the substrate B2 (calibrates against it), A (maps its durable depth), and graduate-outcome-validation (validates it) all plug into. It enriches the scaffolding analysis the framework already ships.
- **Staging:** mirror the staged logic — measure first (a report); if the phenomena are real, graduate it into the scaffolding analysis as a durability-aware view. The data decides whether it becomes permanent.

**Also cheaply actionable (no training): an embedder bake-off on our data.** Because of §5.1's leaderboard trap, we are currently choosing our embedder blind. Build a small labeled eval set from the spine and benchmark candidates on *our* retrieval task — current campus Qwen vs. a domain-adjacent model (a materials/scientific embedder) vs. a strong general v3 — to learn whether the generic embedder is actually a bottleneck before considering any fine-tune.

**Deferred (explicitly, so they stop being re-litigated):**
- **B2 quantitative decay model** — gated on graduate-outcome data. Build the *structure* now; parameterize it later, validated.
- **A cross-walk** — waits, so it maps durable depth, not instantaneous.
- **Depth-factored embedding** — deprioritized; cost/scale only, not accuracy.
- **Custom GC-domain (print/packaging) embedder** — no off-the-shelf option exists (§5.1); building one is gated on the bake-off showing recall (not depth) is the bottleneck, and even then is an adapter/contrastive fine-tune over our own corpus, not a from-scratch domain model.
- **`background.html` §3 occupational-frameworks row** — the O*NET memo already flagged this small doc to-do; still outstanding.

---

## 7. Open questions to revisit

1. **Prevalence:** how common are lone-peaks vs reinforced-threads in the actual GC snapshots? (Decides whether B is high-value or a non-problem for GC.)
2. **Decay/consolidation parameters (B2):** what decay rate, how many/varied exposures to consolidate a sticking depth, how to weight recency/variety — only answerable with longitudinal outcome data. *(§2.7: borrow the HLR/FSRS form — `Stability` grows with each spaced success — and fit its parameters against outcomes; the form is settled, the numbers are not.)*
3. **Pull-up mechanism:** durability-only vs durability + level-floor; how to bound it against runaway inflation. *(§2.7: the transfer literature says model it conservatively — fire only between KST-surmise-related, same-domain neighbors, never auto-lift on depth alone.)*
4. **Neighborhood definition:** is the similarity-neighborhood for B authored (from the competency taxonomy) or embedding-derived (and adjudicated)? *(§2.7: Knowledge Space Theory's surmise relation gives a principled, falsifiable "neighbor" definition — prefer authored prerequisite/surmise structure over raw embedding proximity.)*
5. **Depth-factored embedding:** is the scale ever large enough to justify a learned depth axis over depth-in-context prompting?
6. **Cross-walk feasibility:** is the Course-Skill Atlas GC slice rich enough (given O*NET's coarseness for GC specifics) to be a useful benchmark at all?
7. **Embedder bottleneck (§5.1):** does the bake-off show the generic campus Qwen embedder actually limiting retrieval on our data — and if so, is the failure recall (a domain embedder would help) or depth adjudication (it would not)?
8. **Outcome-data dependency is now shared (§4.1e):** graduate-outcome validation is the *only* check on the correlated-systematic-bias layer ensembling can't reach AND the gate on B2's parameters — does that argue for pulling it earlier in the sequence than its current "deferred" status?

---

## References

*Verified from source (read during the review):*
- Javadian Sabet, A., Bana, S. H., Yu, R., & Frank, M. R. (2024). *Course-Skill Atlas: A national longitudinal dataset of skills taught in U.S. higher education curricula.* Scientific Data 11:1086. https://www.nature.com/articles/s41597-024-03931-8
- Xu, Z., Li, X., Huan, Y., Minaya, V., & Yu, R. (2025). *From Course to Skill: Evaluating LLM Performance in Curricular Analytics.* arXiv:2505.02324.
- Xu, Z., Guan, X., Shi, C., Chen, Q., & Yu, R. (2026). *Evaluating 21st-Century Competencies in Postsecondary Curricula with LLMs.* Journal of Learning Analytics (to appear). arXiv:2601.10983.
- Musazade, N., Mezei, J., & Zhang, M. (2026). *UniSkill: A Dataset for Matching University Curricula to Professional Competencies.* arXiv:2603.03134.
- Le Van-Duyet, Vo Minh Quan, & Dang Quang An (2017). *Skill2vec.* arXiv:1707.09751.
- Senger, E., Zhang, M., van der Goot, R., & Plank, B. (2024). *Deep Learning-based Computational Job Market Analysis: A Survey on Skill Extraction and Classification.* arXiv:2402.05617.
- Decorte, J.-J., et al. (2023). *Extreme Multi-Label Skill Extraction Training using LLMs* (bi-encoder/contrastive/ESCO). AI4HR.

*Domain-specific embedding research (§5.1; verified via search 2026-06-19):*
- Tang, Y., & Yang, Y. (2024/2025). *Do We Need Domain-Specific Embedding Models? An Empirical Investigation* / *FinMTEB: Finance Massive Text Embedding Benchmark.* arXiv:2409.18511, arXiv:2502.10990. (The leaderboard-trap finding: MTEB rank does not predict domain performance.)
- Voyage AI. *Domain-Specific Embeddings — Legal Edition (voyage-law-2, +1T legal tokens, +6%/>10%)* and *Finance Edition (voyage-finance-2, 54% vs 38.5%).* blog.voyageai.com (2024). Harvey × Voyage custom legal model (20B+ tokens).
- Gupta, T., et al. (2022). *MatSciBERT: A Materials Domain Language Model.* arXiv:2109.15290. MELT (arXiv:2410.15126); ChEmbed (arXiv:2508.01643).
- Education/professional-training sentence-embedding framework for hierarchical multi-label classification (ScienceDirect S0169023X24000053); HydroEmbed dual-loss education Q&A embedder (arXiv:2505.04916).
- Domain adaptation on small corpora: adapter-based sentence-embedding adaptation (arXiv:2307.03104); contrastive fine-tuning of smaller LMs (arXiv:2408.00690).

*Field-trajectory references (verified via search; confirm author/venue when pulled):*
- Wong, T.-L., Xie, H., Wang, F. L., Poon, C. K., & Zou, D. (2017). *An automatic approach for discovering skill relationship from learning data.* LAK '17.
- ESCOXLM-R (arXiv:2305.12092); CareerBERT (arXiv:2503.02056); permutation-equivariant directed GNN CPRP (arXiv:2312.09802); GKROM (AAAI 2025).

*Hypothesis B deep dive — durability/bleed-off (§2.7; verified via search 2026-06-20):*
- Murre, J. M. J., & Dros, J. (2015). *Replication and Analysis of Ebbinghaus' Forgetting Curve.* PLOS ONE 10(7):e0120644. (Two-component curve; ~50%→~18% over 31 days.)
- Arthur, W., Bennett, W., Stanush, P. L., & McNelly, T. L. (1998). *Factors That Influence Skill Decay and Retention: A Quantitative Review.* Human Performance 11(1):57–101. (Cognitive skills d→−1.4 after >1yr non-use.)
- Bahrick, H. P. (1984). *Semantic Memory Content in Permastore: Fifty Years of Memory for Spanish.* J. Exp. Psychol. General 113(1):1–29. (Threshold → decades-stable plateau.)
- Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., & Rohrer, D. (2006). *Distributed Practice in Verbal Recall Tasks: A Review and Quantitative Synthesis.* Psychological Bulletin 132(3):354–380. + Cepeda et al. (2008), *Psychological Science* 19(11):1095–1102 (optimal gap ≈ 10–20% of retention interval).
- Adesope, O. O., Trevisan, D. A., & Sundararajan, N. (2017). *Rethinking the Use of Tests: A Meta-Analysis of Practice Testing.* Review of Educational Research 87(3):659–701 (g = 0.51–0.93). Roediger & Karpicke (2006); Bjork & Bjork, New Theory of Disuse (storage vs retrieval strength).
- Settles, B., & Meeder, B. (2016). *A Trainable Spaced Repetition Model for Language Learning (Half-Life Regression).* ACL 2016:1848–1858 (Duolingo). **— the borrowable B2 form.** FSRS (open-spaced-repetition; Anki default); SM-2 (Woźniak 1987).
- Knowledge tracing (for contrast): Corbett & Anderson (1995, BKT — hard-codes no forgetting); Piech et al. (2015, DKT); Nagatani et al. (2019, DKT+forgetting, WWW); Wang et al. (2021, HawkesKT, WSDM); Cen, Koedinger & Junker (2006, AFM); Pavlik, Cen & Koedinger (2009, PFA).
- Pull-up / integration / transfer: Linn, Eylon & Davis (2004, Knowledge Integration); Witherby & Carpenter (2021, *JEP:LMC* — rich-get-richer is *within-domain only*); Perkins & Salomon (1992, low/high-road transfer); Barnett & Ceci (2002, far-transfer taxonomy); Sala & Gobet (2017, *Curr. Dir. Psych. Sci.* — near-zero far transfer); Chi, Feltovich & Glaser (1981, expert integration); Doignon & Falmagne (1985, Knowledge Space Theory / surmise relation — the "neighbor" definition).

*Hypothesis C deep dive — uncertainty/convergence (§4.1; verified via search 2026-06-20):*
- Landis, J. R., & Koch, G. G. (1977). *The Measurement of Observer Agreement for Categorical Data.* Biometrics 33(1):159–174 (κ benchmark scale). Casabianca et al. (2017, essay rater r≈0.54); Goldhaber/edTPA low-IRR studies (κ=0.17; *Education Sciences* 11(10):648, 14(3):300).
- Cronbach, Gleser, Nanda & Rajaratnam (1972), *The Dependability of Behavioral Measurements*; Brennan (2001), *Generalizability Theory* (G-study/D-study — "manage variance, don't chase it"). Lord & Novick (1968) / SEM. Linacre (1989), *Many-Facet Rasch Measurement* (rater severity as a calibrated facet).
- Hüllermeier, E., & Waegeman, W. (2021). *Aleatoric and Epistemic Uncertainty in ML.* Machine Learning 110:457–506 (irreducible vs reducible). Bartz et al. (2024). *Label Convergence* (arXiv:2409.09412 — `mAP ≈ 0.836·α + 0.197`; label reliability caps accuracy).
- Plank, B. (2022). *The "Problem" of Human Label Variation.* EMNLP 2022:10367–10390. Aroyo & Welty (2015), *Truth Is a Lie* (AI Magazine 36(1)); data perspectivism (Basile et al.).
- Wang et al. (2022), *Self-Consistency* (arXiv:2203.11171); Verga et al. (2024), *Panel of LLM Judges / PoLL* (arXiv:2404.18796); Guo et al. (2017), *Calibration / ECE* (ICML); Geifman & El-Yaniv (2017/2019, selective prediction / SelectiveNet).
- **Correlated-error finding (the priority-changer):** Kim, Garg, Peng & Garg (2025). *Correlated Errors in LLMs.* ICML 2025 (arXiv:2506.07962 — agree ~60% when both wrong; bigger = more correlated). Kohli (2025). *Nine Judges, Two Effective Votes* (arXiv:2605.29800 — 9-judge panel n_eff≈2.18, ~24% of independence). → ensembling can't reach shared bias; graduate-outcome validation is the only check.

*Cognitive-science grounding (canon; several already cited in `background.html` references):*
- Ebbinghaus (forgetting curve); Cepeda et al. (spacing); Roediger & Karpicke (retrieval practice / testing effect); Bjork (desirable difficulties); Craik & Lockhart (levels of processing).
- Chi, Feltovich, & Glaser (1981); Larkin et al. (1980) — expert–novice integration. *(in background.html §4)*
- Doignon & Falmagne (1985), *Learning Spaces* — Knowledge Space Theory / surmise relation. *(in background.html refs)*
- Gagné — learning hierarchies; Perkins & Salomon (1992) — transfer; Kapur (2008/2016) — productive failure. *(latter two in background.html §4)*

*Internal:*
- [O*NET / ESCO research memo (2026-06-15)](./2026-06-15-occupational-frameworks-onet-research.md) — the split-verdict + embeddings position this memo builds on.
- `background.html` §4 (problem-solving), §7 (evidence rule), §8 (foundationals); the scaffolding analysis; the graduate-outcome-validation plan.
