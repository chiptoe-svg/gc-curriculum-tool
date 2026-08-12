# SOC/O*NET skills as the curriculum→career "fabric" — exploration memo

**Date:** 2026-08-12
**Status:** Exploration only — not a spec, not a greenlight. Synthesizes two adversarial deep-dive passes.
**Origin:** Operator intuition — use SOC/O*NET occupational skills as the connective *fabric* (a shared vocabulary / coordinate system) defining the *extent and types* of skills mapped across the whole curriculum and into career paths, giving "common threads to follow and build upon," rather than brute-force vector-embedding similarity — on the premise that "starting in similar waters" makes the whole mapping more coherent.
**Method:** Two Opus agents given deliberately opposing priors (advocate / skeptic), both reading the full repo background: `background.html` §11 + §16, the O*NET research memo (`2026-06-15-occupational-frameworks-onet-research.md`), `graduate-outcome-validation.html`, `measurement-hypotheses-deep-dive.html`, the withdrawn skill-embedding spec + the `2026-07-25` Q1-alignment measurement, the `2026-07-26` node-enrichment pilot (R8), the data model (`careerTargets.socCode`, `subCompetencies`, `seed-targets.ts`), and the `gc_alumni` SOC/O*NET/NAICS wiring + the codebook-v2 masking finding.

---

## 1. What both passes AGREE on (high confidence — this is the load-bearing part)

The two agents disagreed on the headline but converged on the substance. Where adversarial priors still agree, trust it:

1. **The *depth* coordinate system already exists — it is KUD+.** Supply, prerequisite, program roll-up, and career demand are already denominated on one 0–5 ruler. Commensurability of *depth* is solved; nothing about SOC changes or improves it.
2. **"Brute-force embedding vs. SOC-fabric" is a false binary.** The live baseline is neither. Embedding-for-*identity* was measured (~24% precision; rescued ~0–1/34 LLM errors) and **rejected**; the shipped approach is **LLM retrieve-then-reason + node enrichment**, which hit ~100% precision / 100% recall in the R8 pilot. Embeddings' real home is *relatedness/stacking* on the **edges**, not identity on the nodes.
3. **The blessed bounded use of O*NET is already in production and already passed a gate.** The R8 node-enrichment pilot drew node includes/excludes/`distinguishFrom` "from node descriptors **+ O*NET (technical nodes only)**" and moved supply→canonical precision **25% → 100%**. Whatever else is true, *that* use of O*NET is validated.
4. **Depth must never leak into the taxonomy.** O*NET records a skill's *presence*, never its *depth* (its Importance/Level scale is job-demand, not learner attainment). KUD+ owns depth exclusively; letting an O*NET rating stand in for a KUD score re-imports the field's documented weakness and dilutes the tool's actual differentiator.
5. **"No clean match" is a first-class, abstain-protected finding — non-negotiable.** The `gc_alumni` codebook-v2 masking finding is the measured canary: an AI coder force-matched hybrid titles (Brand Strategist, Creative Technologist) to nearest SOCs, collapsing the ~32% "no-SOC" share (120/413 ≈ 29%) to **1.7%** and coding a pre-registered finding out of existence. Any SOC/O*NET layer that ever drives matching **must** carry an abstain path (AI proposes, human validates, below-confidence → NULL), or it erases exactly the threads it claims to help follow.
6. **GC-specifics and no-SOC roles need hand-authored nodes.** O*NET's 33 Knowledge areas have no Typography, Color Science, or Press Chemistry; the CIP 10.03→SOC crosswalk captures ~3.4% of real GC placements; 2 of 5 career targets already carry `socCode: null`. Those gaps are *findings*, grafted as hand-authored GC/emerging nodes — never papered over.

**If we did nothing else, items 1–6 are the answer to "is SOC/O*NET covered / should it be": yes, as a bounded overlay (omission checklist on supply, technical-node enrichment seed, demand-side benchmark via the Course-Skill Atlas), with those five guardrails.** That is essentially the plan of record, sharpened — and it is low-risk.

---

## 2. The crux (where the passes genuinely diverge)

The one real disagreement: **should the DWA layer be elevated from an incidental enrichment source into an explicit *identity ruler* — an address space that both course competencies and career sub-competencies are annotated against — so that "common threads" become *declared by shared address* rather than *inferred per-pair* by the LLM?**

- **Advocate — the genuinely new idea worth naming.** KUD+ gives a shared *depth* ruler but not a shared *identity* ruler; today "color-managed proofing" in GC 3460 and "press color control" in GC 4520 are the same thread only if a similarity score or a per-pair LLM call says so. Annotate both to the same **Detailed Work Activity** address (DWAs ≈ 2,070, the domain tier §11 *accepts* — never the rejected generic-Skills tier) and the thread is *declared*, stable, and first-class — which is what "common threads through the curriculum" (`measurement-hypotheses` §2) actually wants. It reframes the fabric as a **coordinate system that indexes** the hand-curated nodes (lat/long), not a backbone that **replaces** them (cities) — sidestepping the atomization objection *if* discipline holds. It also breaks the "O*NET-vs-O*NET" circularity the grad-outcome study guards against by making the external frame explicit and auditable on both sides. Cheapest build: annotate the ~30 existing nodes + known GC grafts to DWA addresses, systematize the already-greenlit enrichment, pull the Atlas GC slice as benchmark — all increments on shipped/greenlit work, none touching capture.

- **Skeptic — the risk is real and much of the value is already captured.** The enriched hand-curated node graph *already is* the identity vocabulary; a DWA address layer is either redundant with it or re-imports the atomization/force-matching failure the repo spent §4/§11 rejecting (Gonczi; Winch; UK NVQ). The masking finding is the measured proof of what forcing real creative/digital work into a federal taxonomy does. "Start in similar waters" is *topical proximity by another name* — and topical proximity is the diagnosed **cause** of the tool's biggest error class (the 70–92%-wrong alignment: force-matched cells, foundational→technical leaks, same-topic-as-same-skill). Domain-framed embedding made identity *worse* (0/34) for exactly this reason. Net: the surviving version is the bounded overlay of §1, nothing more.

---

## 3. Synthesis verdict

**Split the question, because the two halves have different risk/evidence profiles:**

**(A) The bounded overlay (§1) — proceed.** It's agreed by both passes, mostly already committed, low-risk, and it's the honest answer to the operator's "is it covered." No new decision needed beyond *systematizing* what R8 did incidentally and pulling the Atlas GC slice as a demand-side benchmark.

**(B) The DWA-as-identity-ruler / "declared threads" (§2) — promising but unproven; run it as a gated diagnostic, not a build.** The advocate is right that *declared* threads are something the current architecture lacks and that the reframe (coordinate-system-not-backbone) is legitimate. The skeptic is right that the value may already be captured and the downside is measured. Neither can be settled by argument — it turns on **one empirical decision variable the advocate itself named: the graft rate.**

> **The graft rate decides it.** Annotate the existing ~30 canonical nodes + the known GC grafts to DWA addresses and measure what fraction of *load-bearing GC competencies find a real DWA home.*
> - **Low graft rate** (most GC threads map cleanly to a DWA) → the address layer buys genuine external, cross-course/cross-career/cross-institution comparability the bespoke graph can't → worth building.
> - **High graft rate** (most GC threads have no clean DWA — plausible, given O*NET's documented coarseness over Typography/Color Science/Press Chemistry) → the "fabric" thins to the hand-graft graph, the external-grounding benefit evaporates, and the DWA layer is ceremony over the identity vocabulary we already have → don't build it; keep O*NET as the §1 overlay only.

**The experiment is cheap and touches nothing live:**
1. AI-draft, faculty-confirm a **node→DWA annotation** of the ~30 canonical nodes + known GC grafts (match-quality stamped: strong/partial/weak/none — mirror the prerequisite `basis` stamp).
2. Compute the **graft rate** (share of GC competencies with no clean DWA) and **inter-annotator κ** on the node→DWA tagging (same reliability discipline as the alumni study). If the tagging is as noisy as pre-enrichment supply→canonical matching was, the coordinate frame inherits the noise — κ is the go/no-go on feasibility.
3. On a **faculty-authored should-match set on held-out captures** (already an owed R8 to-do), test whether *declared-address* threads beat the current *inferred* threads on precision/recall. R8's 100% rests on only 4 genuine matches / 6 snapshots with one faculty-adjudicated borderline; the honest floor was 75%. This set is owed regardless.

**Guardrails (both passes agree — carry them into any version):** depth stays strictly out of the fabric; the fabric stays strictly out of the capture interview (leads the witness toward aspirational syllabus claims); "no clean match" stays a first-class abstain-protected finding with a monitored NULL rate (if a SOC overlay ever drops the no-match share the way the alumni coder did, the canary has tripped); content and depth live only in the hand-curated, evidence-gated nodes; O*NET seeds and cross-checks, faculty/employer refine, the grad-outcome criterion (where grads land) stays methodologically separate.

---

## 3a. Operator refinement (2026-08-12) — the scaling argument + snap-to-grid

The operator advanced the framing in four ways that tighten the verdict:

- **Scaling is the strongest case for the fabric** (under-weighted by both passes). Bespoke free-text identity is fine at 5 courses; across 40+ *varied* courses by many authors the identity space fragments and coherence decays with N — a shared grid is the defense against that drift. It also **distributes favorably**: the varied/external classes being added (MKT, STAT, PCID, PKSC) have strong O*NET coverage and snap cleanly; the classes that "color outside the lines" are the GC core (Typography, Color Science, Press Chemistry) — exactly where faculty expertise is the authority and the grid *should* step aside. The grid earns its keep on the periphery where bespoke knowledge is thinnest.
- **"Snap-to-grid, with a snap *tolerance*"** is the whole design in one metaphor: snap only on a strong match-quality stamp; below tolerance, place freely (= the abstain-protected grafted node). This unifies the advocate's coordinate-system-not-backbone with the skeptic's no-clean-match-is-first-class into one rule. The metaphor also names the failure mode: **loose snapping is worse than no grid** — points snapping to the wrong nearby intersection is the force-match over-crediting the `gc_alumni` masking finding measured. Tolerance must be tight.
- **Snap *consistency* is the real precondition, and it scales adversely.** A grid only delivers coherence if the same skill snaps to the same DWA across faculty/runs; inconsistent snapping produces *false* coherence, worse than none. So the diagnostic's inter-annotator κ isn't feasibility trivia — it's load-bearing, and it matters *more* as classes accumulate.
- **Relatedness vector-math is icing, not foundation — correctly.** Proximity on the grid (identity/address) is foundational; whether neighbors actually *help/stack* is a separate, *measured* question that cannot be read off proximity (Liu et al.: strongly co-occurring clusters often carry *low* semantic similarity). It lives on the **edges**, from co-occurrence not cosine, and is deferrable.

**Effect on the verdict:** this reframes §3(B). The graft-rate diagnostic is **no longer a go/no-go on the fabric** — the scaling case tips toward *building the grid*. The diagnostic instead (a) **sizes the escape hatch** (what fraction colors outside the lines) and (b) **tests snap consistency** (κ). A grid that snaps ~half of threads *consistently*, with an honest free-place for the GC-core remainder, is coherence-positive at scale. Revised go/no-go: not "high graft rate → don't build," but "**low snap-consistency (κ) → don't build**; high graft rate → build a *smaller* grid over the classes that snap and lean on grafts for the GC core."

## 4. Bottom line

The operator's coherence intuition is sound and — unusually — vindicated by the repo's own measurements: the R8 pilot's 25%→100% jump *is* "starting in similar waters" working, and it already sourced boundaries partly from O*NET. But the intuition is best honored the way both passes converge on: **KUD+ is the depth ruler; the department's enriched, evidence-anchored sub-competency graph is the identity vocabulary; O*NET/SOC is a sourced overlay — omission checklist, technical-node enrichment seed, demand-side benchmark — never the backbone, never depth, never in capture, always abstain-protected.** The one genuinely new idea beyond that — elevating O*NET **Detailed Work Activities** into an explicit *address ruler* so cross-course/cross-career threads are *declared* rather than *inferred* — is promising but unproven, and it resolves to a single cheap measurement: the **graft rate**. Run that diagnostic (node→DWA annotation + κ + held-out recall set) before committing a line of build; the answer to "is a DWA address layer worth it" is a number we can go get, not an argument we can win.
</content>
