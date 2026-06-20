# Curriculum Measurement — Working Hypotheses: Durability, Competency→Career Cross-walk, and an Uncertainty Discipline

**Date:** 2026-06-19
**Status:** HYPOTHESIS — not specced, not built, not sequenced. **To revisit.** This is a recorded line of thinking, deliberately preserved because it is high-value and unresolved.
**Origin:** A review of the skill-mapping / skills-intelligence literature (June 2026) cross-examined against the framework, which surfaced three interrelated hypotheses about what the framework measures and how. Companion to the [O*NET research memo](./2026-06-15-occupational-frameworks-onet-research.md) (which this extends with a concrete data source — Course-Skill Atlas — and a durability model the earlier memo did not have).

---

## TL;DR

Three hypotheses, one resolved conceptual question, one actionable first step.

- **(B) Durability / "bleed-off"** — *the headline, and a genuine gap in the current model.* KUD scores are *instantaneous* (end-of-course) depth; **durable graduation-time depth is a different quantity the model currently conflates.** Depth decays between courses unless reinforced; repeated + varied reinforcement consolidates; and high-depth attainment "pulls up" related neighbors (knowledge integration). Splits into **B1 (structural, buildable now)** and **B2 (quantitative, gated on graduate-outcome data)**.
- **(A) Competency→career cross-walk** via Course-Skill Atlas — operationalizes the O*NET memo's recommendation using a ready-made national O*NET-DWA-by-major dataset. Fuzzy-by-construction; external validation, not backbone. Should map *durable* depth (B), not instantaneous.
- **(C) Uncertainty / convergence discipline** — *the load-bearing one.* There is no reliable oracle (humans and LLMs are both unreliable adjudicators); the residual error is **mostly irreducible** (label noise + genuine ambiguity + under-specified inputs), so the job is to **represent and manage uncertainty, not chase it**.
- **Resolved conceptual question:** "embeddings vs attention vs depth-factored embedding" — the distinction is *informational/representational, not mechanistic*. KUD+depth **is** the orthogonal factorization a generic embedding entangles.
- **Actionable now:** a **structural competency-thread measurement over existing snapshots** — the smallest thing that simultaneously *teaches* whether bleed-off matters for GC and *builds* the data foundation B2 / A / outcome-validation all plug into.

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

This reinforces the framework's existing honest framing ("stronger as a conversation engine than a measurement instrument"): the claim is **comparative** (more evidence-grounded, explicit, contestable, and aggregable than committee oral-tradition), never **absolute**. (C) is a **representation contract** every derived claim conforms to — decided once, applied inside B and A; it is not a standalone build (the basis stamp + evidence rule are precedent).

---

## 5. The embeddings / attention / depth-factored question (resolved)

The recurring question — *"how is this fundamentally different from token embeddings + attention + orthogonal embeddings, which work well in practice?"* — resolves cleanly:

- **There is no fundamental mechanistic difference.** Attention can represent asymmetric, depth-conditional, hierarchical relations. The limitation of static-embedding *cosine* is **informational**: one fixed vector per term, a symmetric scalar, no slot to condition on depth. The *same* attention mechanism succeeds once the depth scale + competency definitions + evidence are **in context** — that is the 24% → 80% jump. It's "generic context-free representation vs. task-specific-context representation," not "embeddings vs. reasoning."
- **KUD + depth *is* the orthogonal factorization** a generic token embedding entangles. The framework already separates "which competency × which dimension (K/U/D)" from "how deep (0–5)" — by hand. A "depth-factored vector space" (depth as an explicit learned orthogonal axis, content on another) would be the *continuous, learned* version of what the framework authors discretely.
- **A depth-factored embedding is a cost/scale optimization, NOT an accuracy win.** Given §4's conclusion that the residual is largely irreducible, a fancier representation will not move an accuracy number bounded by label reliability. It would only be justified if depth-aware similarity is needed across the *whole* competency graph at a scale where per-pair LLM calls are too expensive. **Default: supply depth-in-context to the LLM** (simple, validated, auto-adapts as the depth scale evolves). Revisit the learned embedding only for scale.

---

## 6. What's actionable now — and what's deferred

**Actionable (the first brick): a structural competency-thread measurement over existing snapshots.** For each competency, compute from already-captured data: its sequence of exposures (course, KUD depth, curriculum order, variety), and a structural-durability flag (lone-peak vs reinforced-thread), every flag confidence/provenance-stamped (the (C) contract realized by application). **Run it as a measurement/report first** — no new capture, no new model, no gated data.

Why this is the right first move (it is simultaneously *learn* and *build*):
- **Learn:** it answers, with evidence, the questions this whole thread circled — *is bleed-off even prevalent in GC, or is most depth already well-reinforced? Are the similarity-neighborhoods real and clean? Where are the lone-peaks?* None of B2 / A can be designed honestly until this is seen.
- **Build:** the "exposures × depth × sequence × variety per competency" structure **is** the substrate B2 (calibrates against it), A (maps its durable depth), and graduate-outcome-validation (validates it) all plug into. It enriches the scaffolding analysis the framework already ships.
- **Staging:** mirror the staged logic — measure first (a report); if the phenomena are real, graduate it into the scaffolding analysis as a durability-aware view. The data decides whether it becomes permanent.

**Deferred (explicitly, so they stop being re-litigated):**
- **B2 quantitative decay model** — gated on graduate-outcome data. Build the *structure* now; parameterize it later, validated.
- **A cross-walk** — waits, so it maps durable depth, not instantaneous.
- **Depth-factored embedding** — deprioritized; cost/scale only, not accuracy.
- **`background.html` §3 occupational-frameworks row** — the O*NET memo already flagged this small doc to-do; still outstanding.

---

## 7. Open questions to revisit

1. **Prevalence:** how common are lone-peaks vs reinforced-threads in the actual GC snapshots? (Decides whether B is high-value or a non-problem for GC.)
2. **Decay/consolidation parameters (B2):** what decay rate, how many/varied exposures to consolidate a sticking depth, how to weight recency/variety — only answerable with longitudinal outcome data.
3. **Pull-up mechanism:** durability-only vs durability + level-floor; how to bound it against runaway inflation.
4. **Neighborhood definition:** is the similarity-neighborhood for B authored (from the competency taxonomy) or embedding-derived (and adjudicated)?
5. **Depth-factored embedding:** is the scale ever large enough to justify a learned depth axis over depth-in-context prompting?
6. **Cross-walk feasibility:** is the Course-Skill Atlas GC slice rich enough (given O*NET's coarseness for GC specifics) to be a useful benchmark at all?

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

*Field-trajectory references (verified via search; confirm author/venue when pulled):*
- Wong, T.-L., Xie, H., Wang, F. L., Poon, C. K., & Zou, D. (2017). *An automatic approach for discovering skill relationship from learning data.* LAK '17.
- ESCOXLM-R (arXiv:2305.12092); CareerBERT (arXiv:2503.02056); permutation-equivariant directed GNN CPRP (arXiv:2312.09802); GKROM (AAAI 2025).

*Cognitive-science grounding (canon; several already cited in `background.html` references):*
- Ebbinghaus (forgetting curve); Cepeda et al. (spacing); Roediger & Karpicke (retrieval practice / testing effect); Bjork (desirable difficulties); Craik & Lockhart (levels of processing).
- Chi, Feltovich, & Glaser (1981); Larkin et al. (1980) — expert–novice integration. *(in background.html §4)*
- Doignon & Falmagne (1985), *Learning Spaces* — Knowledge Space Theory / surmise relation. *(in background.html refs)*
- Gagné — learning hierarchies; Perkins & Salomon (1992) — transfer; Kapur (2008/2016) — productive failure. *(latter two in background.html §4)*

*Internal:*
- [O*NET / ESCO research memo (2026-06-15)](./2026-06-15-occupational-frameworks-onet-research.md) — the split-verdict + embeddings position this memo builds on.
- `background.html` §4 (problem-solving), §7 (evidence rule), §8 (foundationals); the scaffolding analysis; the graduate-outcome-validation plan.
