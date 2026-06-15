# Occupational Frameworks (O*NET / ESCO) as a Skills-Taxonomy Anchor — Research Memo

**Status:** Research / decision input (NOT a design spec). Informs a go/no-go on whether to anchor the canonical sub-competency taxonomy in an external occupational framework.
**Date:** 2026-06-15
**Prompted by:** the observation that 30 hand-authored sub-competencies (~6 per career target) is too coarse, and the proposal to source the taxonomy from O*NET.

---

## The three questions this memo answers

1. **How does an occupational-framework anchor fit with our background research?**
2. **How critical is it that the taxonomy be incorporated into the capture (interview) process?**
3. **Can we post-process and get the same result?**

Short answers: **(1) Split verdict — yes at the domain-task tier and on the demand side, no at the generic-skill tier and never as the structural backbone. (2) Not critical; counter-indicated. (3) Yes — post-processing reproduces the same result; live interview integration is an optional optimization, not a requirement.**

---

## What O*NET / ESCO actually are (grounding)

**O*NET** (US DOL, CC-BY-4.0, free bulk download + REST API, 923 O*NET-SOC occupations) organizes data into worker/job/market domains:

- **Generic tier:** Skills (35), Abilities (52, Fleishman), Work Styles (23), Interests (RIASEC). Designed to be cross-occupational.
- **Domain tier:** Knowledge (33 broad areas), Generalized Work Activities (41) → **Detailed Work Activities (~2,070)** → **Task statements (~19,000)**, Technology Skills (~8,753), Tools. Occupation-anchored.
- **Rating scales:** Importance (1–5) and **Level (0–7, behaviorally anchored per element)** — a *job-demand* measure, not a learner-attainment measure.

**ESCO** (EU) has a far richer skills taxonomy (~13,939 skills), 27 languages, and formal "link learning outcomes → skills" tooling — but **no within-skill proficiency/depth scale at all.**

Neither framework solves the depth problem. O*NET has a depth-ish Level scale but a thin, theoretically weak generic-skills layer; ESCO has rich skills but no proficiency. *(Sources: onetcenter.org content/database/scales; esco.ec.europa.eu classification/escopedia.)*

---

## Q1 — Fit with our background research: a split verdict

### Where it *clashes* (and why this is load-bearing)

**(a) The generic-skill tier is rejected by the very authorities our framework already cites.**
`background.html` §4 grounds its anti-generic-transfer stance in Willingham, Perkins & Salomon, Gick & Holyoak, Gentner. O*NET's generic Skills layer (Critical Thinking, Complex Problem Solving, Problem Sensitivity, Active Listening) is *exactly* the context-free-skill construct those authors reject — and the **National Academies' 2010 review of O*NET independently found that same Skills domain has weak construct validity** (no clear theoretical definition; "problem solving" smeared redundantly across Skills, Abilities, Work Styles, and Work Activities; raters can't reliably distinguish adjacent descriptors). So anchoring on O*NET's generic skills would re-import the precise error §4 exists to prevent. *(Nat. Acad. 2010, ch. 2; Willingham 2008/2020; Perkins & Salomon 1992.)*

**(b) Atomization vs. integration — a deeper tension than the generic-skill point.**
The CBE critique literature (Gonczi 1994; Lombarts 2015; Bajis et al. 2020; Winch) holds that decomposing competence into a discrete skill checklist **destroys the integration that makes competence meaningful** and optimizes for *adequacy rather than excellence*. Winch's direct critique of ESCO: its bottom-up skills aggregation is "fundamentally incompatible with how coherent educational programs are designed" — *"meeting the requirements of an occupational profile by achieving all the learning outcomes does not guarantee occupational competence."* This is a tension with adopting **any** external skill-list as the backbone, not just O*NET's generic tier. *(Gonczi; Lombarts PMC 2015; Winch BWP.)*

**(c) Empirical proof it can backfire.** The UK's National Vocational Qualifications (1986–2015) were an explicit competency-checklist system; IFS found Level-2 NVQs *"appear to hurt labour market prospects,"* attributed to the "tick off a very long list of competencies" structure. The system was retired. This is the closest thing to a controlled outcome for "anchor curriculum to an atomized occupational checklist," and it's negative. *(IFS; Winch/Brockmann/Clarke.)*

**(d) Currency + granularity.** O*NET lags practice (survey cycles, ~71 obs/occupation), and the 33 Knowledge elements are far too coarse for GC — no Typography, Color Science, Press Chemistry, Digital Imaging. **O*NET is not a ready-made GC vocabulary.** Building one means extracting Tasks/DWAs for GC-relevant SOC codes (e.g., 27-1024 Graphic Designers, 51-5111 Prepress, 15-1255 Web) and *hand-grouping* them. And ≥2 of our 5 targets have no clean SOC home (AI Workflow Orchestrator; Creative Generalist). *(Nat. Acad. ch. 3; Agent-1 synthesis.)*

### Where it *aligns*

**(e) Domain-tier near-transfer.** O*NET's Knowledge / DWA / Task tiers are domain-anchored, which matches our domain-embedded stance and the transfer literature's reliable "near transfer." Used at this tier (not the generic tier), an occupational framework is a defensible **external-validation vocabulary**.

**(f) Demand-side fit.** O*NET's Importance/Level ratings *are* a career-requirement signal — they belong on the **demand side** (our Role Outcome Profiles), where an external benchmark is welcome and can seed the partner survey rather than originate it.

**(g) Our depth scale is the layer the whole industry is missing.** Both agents independently land here: skills-intelligence systems "almost universally identify the *presence* of a skill but not its *depth*." KUD+ depth, anchored to student-attainment evidence, is *exactly* that missing layer — confirmed theoretically (Dreyfus; integration critique) and industrially. **We are ahead on the thing that matters; we should not dilute it by atomizing into an external checklist.**

### §3 gap to fix
`background.html` §3 ("Why not other frameworks") evaluates only *education* frameworks (Bloom, VALUE, Tuning, OBE, CBE). It has **no row for occupational frameworks (O*NET/ESCO).** That's now a documented gap; §3 should gain a row reflecting this memo's verdict.

---

## Q2 — Criticality of incorporating into capture (interview): low / counter-indicated

The architecture already separates **evidence-first, course-native capture** from **downstream mapping** (`background.html` §11: program views "are not produced by the framework itself but by program-level analyses that consume the confirmed profiles"). Three reasons to keep the taxonomy *out* of the interview:

- **Leading the witness.** An interview that fishes for O*NET elements invites aspirational syllabus claims to be logged as evidence — the failure the evidence-above-zero rule exists to stop.
- **Atomization at the point of capture** would push the interviewer toward checklist-completion over the integrative, course-native reading.
- It would couple capture to a taxonomy the framework deliberately keeps downstream.

A taxonomy-aware **coverage radar** *could* exist as a fenced, advisory nudge ("no evidence gathered yet on X — want to probe it?"), strictly *reference, never evidence*. But it is an optimization, not a requirement — see Q3.

---

## Q3 — Can we post-process and get the same result? Yes.

The mapping is **evidence-based**, and the evidence (interview transcript, materials, confirmed profile) is preserved in the snapshot regardless of whether the interview ever heard of O*NET. Therefore:

- Post-processing reproduces the same mapping for **everything the interview actually gathered.**
- The **only** delta a live in-interview radar buys is *gap-filling* — prompting for evidence on elements never discussed — and that is equally achievable as a **post-hoc gap report → targeted re-interview** (already supported; re-capture appends a new immutable snapshot, nothing lost).
- The mapping work (candidate-generation, scoring, near-miss detection) is itself inherently a post-snapshot step.

**Conclusion:** the earlier "put the radar in capture now" instinct was premature. Post-process first; treat any interview-side radar as a later, optional optimization.

---

## On embeddings (the vector-matching question)

Vectors can do the **candidate-surfacing / synonym-collapse** step but must not adjudicate. Documented failure modes:

- **False equivalence:** Nesta's system matched *"understand the bigger picture"* → ESCO *"interpreting technical documentation and diagrams."*
- **Synonym/antonym confusion:** distributional embeddings place *"supervise others"* and *"work under supervision"* too close.
- **Depth blindness:** embeddings conflate "Python (entry)" with "Python (expert)" — the proficiency layer is absent.
- **Abstraction mismatch + annotator disagreement:** UniSkill (2026) found course descriptions and professional competencies sit at different abstraction levels, producing systematic false alignments, and human annotators disagreed (low κ) on competency boundaries.
- **Recall ceiling ~52%**; implicit/emerging skills are undetectable; **human validation is non-optional.**

This vindicates the design we converged on: **embeddings surface and shortlist; depth-aware LLM/human reasoning adjudicates; a near-miss queue routes the ambiguous pairs to faculty.** And the "color management ↔ color measurement" exchange showed the adjudication must be **depth-aware**: related skills *converge* at high depth (D4 management entails measurement) and *split* at low depth — a domain inference, not a cosine value. *(Explosion AI/Nesta; arXiv 2209.15197; UniSkill arXiv 2603.03134.)*

---

## Recommendation

**Do not** rebuild the taxonomy on O*NET, do not adopt its generic-skill tier, and do not push it into capture. The research does not support the spec I had started.

**Do** (if/when this is prioritized — it is not urgent):

1. **Keep our hand-curated, GC-specific, depth- and evidence-anchored sub-competencies as the backbone.** That is the integrative, domain-embedded artifact the literature endorses.
2. **Expand granularity by hand** (the legitimate core of "30 is too few"), *using O*NET's GC-SOC Tasks/DWAs as a sourced checklist* to catch competencies we've missed — external validation, not replacement.
3. **Add O*NET on the demand side** as a benchmark: bind each career target to its SOC code(s) where one exists; use Importance/Level to seed Role Outcome Profiles so the partner survey *refines* rather than *originates*. Flag the 2 targets with no SOC home.
4. **Embeddings only as candidate-surfacing + a near-miss review queue**, with depth-aware human/LLM adjudication. Never auto-match.
5. **Leave capture untouched.** Any coverage radar is a later, fenced, advisory optimization.
6. **Update `background.html` §3** with an occupational-frameworks row recording this verdict.

This preserves our actual differentiator — evidence-anchored depth, the layer the skills-intelligence field is missing — while taking the defensible part of O*NET (domain-tier vocabulary + demand benchmark) and refusing the part our own foundation rejects (generic-skill atomization as a backbone).

---

## Key sources

- National Academies (2010), *A Database for a Changing Economy: Review of O*NET*, chs. 2–3.
- Willingham (2008/2020), *Critical Thinking: Why Is It So Hard to Teach?* / *How Can Educators Teach Critical Thinking?*
- Perkins & Salomon (1992), *Transfer of Learning*; Gick & Holyoak (1983); Gentner (1983).
- Gonczi (1994); Lombarts (2015, PMC4673067); Bajis et al. (2020, PMC7355480) — CBE atomization.
- Winch, *From Labour Market to Educational System (ESCO critique)*, BWP; Winch/Brockmann/Clarke, six-country study; IFS, *Returns to NVQ Level 2*.
- UniSkill (2026, arXiv 2603.03134); Nesta/Explosion AI skills-NLP; arXiv 2209.15197 (embedding synonym/antonym); Kapur (2016); Bransford & Schwartz (PFL).
- O*NET: onetcenter.org (content/database/scales/taxonomy); ESCO: esco.ec.europa.eu (classification/escopedia/crosswalk).
