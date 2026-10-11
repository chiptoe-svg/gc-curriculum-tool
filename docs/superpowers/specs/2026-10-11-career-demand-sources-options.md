# Career demand and skill vocabulary — combining O*NET, ESCO and industry standards: design options

**Date:** 2026-10-11 · **Status:** options for owner decision (brainstorming stage; no spec or plan yet). Supersedes nothing; builds on [`2026-06-15-occupational-framework-utilization-plan.md`](./2026-06-15-occupational-framework-utilization-plan.md) and the 2026-10-08/09 owner decisions recorded in STATE.md (O*NET elements as KUD competencies; broad elements program-level; Importance and Level used; career target as a weighted question).

Evidence behind this memo (local, git-ignored): `scratch/esco/coverage-report.md` + `coverage-matches.csv` (ESCO/O*NET coverage, 89 GC items), `scratch/skillsusa/skillsusa-report.md` (SkillsUSA standards). Every fact below marked *verified* was checked against the source data or an official page by the research agents or by this session.

## 1. What the sources are (verified)

| | O*NET 31.0 (Aug 2026, latest) | ESCO v1.2.1 (Dec 2025, latest) | SkillsUSA technical standards (2024–26) |
|---|---|---|---|
| Unit | Occupation (O*NET-SOC; our alumni are SOC-coded) | Skill/knowledge concept; occupations link to skills | Contest task lists (e.g. Graphic Communications GC 1.0–7.0) |
| Ratings | Elements: Importance 1–5, Level 0–7. **Tasks: Importance, Relevance, Frequency (no Level)** — verified in `task_ratings.csv` | **None.** Occupation–skill links are essential/optional only (verified: no numeric field on the relation) | Point weights exist only on judges' scorecards; not published |
| Domain detail | Generic elements are coarse (120 unique across our 21 destination SOCs); GC detail lives in 814 task statements, 420 DWAs, 100 technology skills | 13,939 skills/competences; names print processes (typography, flexography, gravure, screen printing, binding, colour profiles) | Task-level, software- and process-named, performance-judged |
| Coverage of 89 GC items | strong 19% / partial 42% / none 39% | strong 58% / partial 33% / none 9% | Not scored; GC contest covers prepress, color, offset, digital, finishing, estimating — not packaging or screen printing |
| Reuse | CC BY 4.0 | CC BY 4.0 (and reuses O*NET content) | Members only — "may not be posted or shared in any publicly accessible location" |

Other verified facts that shape the design:
- **Importance and Level are nearly the same signal.** The NRC review of O*NET (2010, PDF p. 90) reports responses "so highly correlated (r = .95) as to suggest that the two scales were largely redundant," and a later analysis found a mean of .92. On our own data — all 6,118 element ratings for the 21 destination SOCs in O*NET 31.0 — r = 0.97 (abilities 0.99, skills 0.98, knowledge 0.97, work activities 0.93). So Level cannot act as an independent check on Importance.
- **Crosswalks are stale.** The official ESCO↔O*NET occupation crosswalk dates from Sep 2022 (O*NET-SOC 2019, ESCO v1.1.0); match types exactMatch/closeMatch/broadMatch, no scores. ISCO-08↔SOC exists only to SOC 2010.
- **Six GC items neither source covers:** trapping, dot gain/proof-to-print measurement, variable data printing, print workflow automation (JDF/MIS), web-to-print, and career-services/personal-finance skills (a scope mismatch — both model on-the-job skills).
- **AI work is thin in both.** ESCO has general AI knowledge concepts, no generative-AI skill; O*NET carries generative-AI technology skills for other occupations but none for GC's destination SOCs.
- O*NET 30.3 split the old "Skills" domain into `essential_skills` (10 generic academic skills) and `transferable_skills` — queries by the old name break.
- ESCO's bulk download needs an email form; the research used the official API (no key). Fine for lookups; a full local copy needs a department email submitted.

## 2. Division of labor (common to every option)

1. **O*NET — demand and weights.** The only source with numeric demand ratings, and it speaks SOC, which is how the alumni destinations are coded. Use element Importance/Level and **task Importance** for the 21 destination SOCs. Level stays a labeled demand reference (no validated 0–7→0–5 conversion).
2. **ESCO — vocabulary and naming.** Its labels and alternative labels name GC processes O*NET doesn't; use them to name competencies consistently and as match targets for the embedding shortlist. Its essential/optional link is a secondary "is this core to the occupation" flag, never a weight.
3. **Industry standards — task descriptors and a coverage check.** SkillsUSA's judged, artifact-based tasks are the closest external analogue of our Do evidence; use them internally to check that course competencies don't miss an industry-recognized task area and to phrase Do descriptors. No quoting or publishing without SkillsUSA's permission. The June plan's other standards (Idealliance/G7, PRINTING United, FTA/FIRST, Ghent) are still unacquired.
4. **GC-authored items** for the six double gaps and the AI work.
5. **Our hand-curated, evidence-anchored competencies stay the scoring backbone** (June principle 1; capture interview unchanged).

## 3. The career-readiness computation (folds in the 2026-10-09 design)

A career target is a question put to the program's accumulated competencies:
- **What the target asks for:** the O*NET elements and tasks of the destination SOCs, weighted by Importance and by the share of GC graduates who land in each SOC (alumni weighting), plus GC-authored items.
- **What the program supplies:** evidence-anchored K/U/D depth per GC competency, per course, in sequence.
- **Matching:** each demand item links to GC competencies (embedding shortlist → reasoning step → faculty confirmation; links carry a match-quality stamp; "no clean match" is a finding).
- **Output, stage 1 (no fitted parameters):** per target, the importance-weighted list of shortfalls (a high-importance item below its required depth is reported on its own, never averaged away), the "met once, never reinforced" items (reinforcement = later courses reusing the competency), and coverage of the target's demand. Required depth is a **draft** confirmed by faculty or employers. Because Level tracks Importance almost exactly (r ≈ 0.97), it adds little as a separate demand column; its value is its anchored wording (what "level 5" of an element looks like), which can help faculty write the draft required depth. Importance does the weighting. No single readiness percentage.
- **Stage 2 (later):** recency-weighted fading (HLR/FSRS or PFA-Decay form) once outcome data allow fitting.

## 4. Options — where the career target's structure comes from

### Option A — Mapped demand (recommended)

Demand is composed from O*NET (elements + tasks of alumni-weighted SOCs); supply stays the GC competencies; a **link table** joins them, with ESCO concepts as the shared names. Career readiness is computed over the links.
- **For:** keeps the evidence-anchored backbone and the capture interview untouched (June principles); uses O*NET's numeric weights at task grain; ties directly to the SOC-coded alumni and the graduate-outcome study; ESCO fills naming gaps without needing its stale crosswalk.
- **Against:** quality rests on the link table — needs a faculty-confirmed golden set before thresholds are trusted (published agreement on this kind of matching is modest: κ≈0.45 in UniSkill; experts themselves "mostly moderate" in Zamecnik et al. 2024).
- **Build size:** moderate — O*NET reference store (31.0, 21 SOCs), alumni weights from gc_alumni, link table + review queue, readiness view.

### Option B — Adopt O*NET elements as scored competencies

Each O*NET element (and possibly task) becomes a competency that captures score on K/U/D directly — the literal form of the 2026-10-08 reframe.
- **For:** demand and supply share one list; no link table.
- **Against:** changes the capture interview and means re-scoring all 19 captured courses; O*NET's generic elements are too coarse for GC (120 across 21 SOCs) and its tasks are occupation-specific sentences, not teachable competencies; the six double gaps and AI work still need GC items; conflicts with the June "capture untouched" principle.

### Option C — ESCO-centric

Re-key GC competencies to ESCO concepts (best coverage, 58% strong) and compose targets from ESCO occupations' essential/optional skills; bring in O*NET weights through the crosswalk.
- **For:** best named-process coverage; multilingual labels.
- **Against:** no numeric weights at all; the crosswalk is from 2022 and two versions behind on both sides; alumni are SOC-coded, so every comparison translates twice.

**Recommendation: Option A**, with ESCO as the naming layer and industry standards as an internal cross-check. It is the only option that has numeric demand weights, keeps the scoring backbone and interview unchanged, and connects to the alumni data without a stale crosswalk.

## 5. Decisions needed from the owner

1. **Option:** A (recommended), B or C.
2. **Alumni weighting:** first destination only, or first + current job? (gc_alumni holds both; the outcome study uses first jobs.)
3. **SOC bindings for the five targets:** the app's seeds (41-4012, 13-1161, 11-3051; two none) differ from the June plan's (11-2011, 11-2021, 51-5112+51-5111, 27-1024; one none). Pick one set, or derive each target's SOC mix from the alumni data.
4. **SkillsUSA:** ask SkillsUSA for permission to use the Graphic Communications standards (and Screen Printing, not yet obtained), or keep them internal-only?
5. **ESCO bulk download:** OK to submit a department email on ESCO's download form for a full local copy (the API is enough for stage 1)?
6. **Level:** given r ≈ 0.97 with Importance, drop Level as a displayed demand column and keep it only as wording that helps faculty set required depth (recommended), or still show it?
7. **GC-authored items** for the six double gaps and AI work — who drafts (faculty, or AI draft + faculty confirm)?

## 6. Not yet verified / open
- Whether gc_alumni's destination counts per SOC are ready to use as weights (to ask the gc_alumni session).
- The June plan's industry-standards sources (Idealliance/G7, PRINTING United, FTA/FIRST, Ghent): availability and licensing.
- ESCO count sub-types (skills vs knowledge vs transversal) from a full dump; the 89-item test set is curated, not exhaustive.
