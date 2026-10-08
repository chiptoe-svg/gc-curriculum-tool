# Javadian Sabet, Bana, Yu & Frank (2024) — Course-Skill Atlas

**Full citation:** Javadian Sabet, A., Bana, S. H., Yu, R., & Frank, M. R. (2024). Course-Skill Atlas: A national longitudinal dataset of skills taught in U.S. higher education curricula. *Scientific Data*, 11:1086. https://www.nature.com/articles/s41597-024-03931-8.

**Reference ID in background.html / measurement-hypotheses-deep-dive.html:** `ref-javadian-sabet-2024` (or equivalent); cited in `background.html` §11 and extensively in `measurement-hypotheses-deep-dive.html` §5 (Stages 1–3 of the node-enrichment proposal, and the "nine syllabi for a stable profile" calibration figure).

**Where it lives:**
- *Scientific Data* 11:1086 (Nature, open access).
- **Local copy:** not held in this repo's `_pdfs/`; a copy exists at `ai_career_impact/library/pdfs/future_of_gc/architecture/Javadian_Sabet_etal_2024_Course-Skill_Atlas.pdf` (private, shared source; filed under that project's *architecture/methods* bibliography rather than its pedagogical load-bearing set — see the Tier-3 note in `_NEW_from_measurement_hypotheses_spec.md`).

**Accessibility:** Open access; a text-extraction copy (`.md`) is also held alongside the PDF in the shared library.

**What the doc claims it says:** `measurement-hypotheses-deep-dive.html` §5: "The data source that makes this tractable is Course-Skill Atlas (Javadian Sabet et al., 2024, *Scientific Data*), which computed national O*NET Detailed Work Activity (DWA) coverage by major (CIP code) over approximately 3.16 million syllabi... the Atlas authors found that about nine syllabi are enough for a stable skill profile for a field of study at an institution in a given year ('the sufficient number of syllabi is equal to 9,' p. 17)." The same page's §5 Stage-3 discussion states: "The Course-Skill Atlas cannot supply [co-occurrence/complementarity measures] on the curriculum side: it provides no co-occurrence or complementarity measures, and its released data are aggregated 'at the institution-year-FOS level' because the authors' research contract 'requires that we do not release information at the individual syllabus level' (p. 14)."

**What it actually says (synthesis, per the audit's verified quotes):**

The Atlas computes national O*NET Detailed Work Activity (DWA) coverage by field of study (CIP code) over approximately 3.16 million U.S. higher-education syllabi from the Open Syllabus Project, turning hand-extraction of relevant O*NET tasks into a slice-and-benchmark operation. Two findings matter for how this source may be cited:

1. **No co-occurrence or complementarity measure.** A full-text search of the paper (per the 2026-10-07 audit) found no occurrence of "co-occur" or "complement" anywhere — the Atlas computes per-syllabus/per-major DWA *coverage*, not pairwise skill relationships. An earlier draft of `measurement-hypotheses-deep-dive.html` proposed the Atlas as a source of curriculum-side co-occurrence/complementarity data (parallel to Skill2vec on the job-posting side) — that use is **unsupported** (audit finding JS4) and has been corrected: curriculum-side co-occurrence "would have to come from our own captured courses, or from coarser co-occurrence across the Atlas's aggregated profiles," not from the Atlas's own released data.
2. **Syllabus-level data is withheld by contract, not merely aggregated for convenience.** "Our research contract with OSP requires that we do not release information at the individual syllabus level. As such, we create a dataset of inferred skills aggregated at the institution-year-FOS level" (p. 14). This is a contractual restriction, not a design choice the Atlas authors could relax — an earlier draft's phrasing ("co-occurrence would have to be computed from [the Atlas's] syllabus-by-DWA data") incorrectly implied syllabus-level data was available to compute from; it is not (audit finding, post-rewrite spot-check "javadian-3").
3. **The "nine syllabi" stability figure is verbatim and correctly cited.** "The sufficient number of syllabi is equal to 9" (p. 17) — for a stable skill profile per field of study, per institution, per year. This figure is accurately used in `measurement-hypotheses-deep-dive.html` §5 as a calibration prior.

**Verdict:** Consistent with the 3.16-million-syllabi scope, the DWA-coverage-by-major method, and the nine-syllabi stability figure. Not consistent with any claim that the Atlas supplies co-occurrence or complementarity measures, or that syllabus-level data could be computed from its releases — both corrected in `measurement-hypotheses-deep-dive.html` §5 (Stage 3) to state that curriculum-side co-occurrence must come from this project's own captured courses or from the Atlas's coarser institution-year-FOS aggregates.

**Audited 2026-10-07 — from the citation audit's verified quotes, confirmed against the shared-library full-text extraction.**
