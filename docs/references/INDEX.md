# References — Audit Index

Audit of the 42 references in `/docs/background.html` §15 (rows 29–31 added 2026-06-05 for the §2 "Knowledge spaces" subsection; **rows 32–42 added 2026-06-20** — the §4 transfer/problem-solving cluster that landed in `background.html` on 2026-06-14 but was never audited in, plus `xu-2026` added 2026-06-19). Each row links to a reference file containing: full citation, accessibility status, what the background doc claims the source says, a substantive synthesis based on what was fetched or found, and a verdict on consistency.

**2026-06-20 reviewer expansion (rows 43–52 + staged).** A reviewer working from the held PDF set (`citations/load_bearing/` — **not committed to this repo**; the cards' "Local copy" lines point there) returned an expanded 56-card set. Its high-value additions were **wired into the live docs** (rows 43–52: Abrami 2015, the transfer-skepticism canon Thorndike-Woodworth / Detterman / Sala 2019, the metacognition pair Veenman / Schoenfeld, and the §11 competency-critique sources NRC-O*NET / Gonczi / Brockmann-Clarke-Winch / Dearden — now cited in `background.html` §4/§11). The Gentner and Gick & Holyoak cards were **renamed** (rows 35–36; the `background.html` anchors were renamed to match). Three cards remain **staged** — not yet cited in any live doc — because two carry "partially inconsistent" warnings about *how* they'd be cited (see "Staged cards" below). The reviewer's `_NEW_from_measurement_hypotheses_spec.md` triages which hypothesis-memo citations belong in the lit review (Tier 1 add-now / Tier 2 B2-methods appendix / Tier 3 architecture bibliography).

**Audit conducted:** 2026-06-01; extended 2026-06-05 and 2026-06-20  
**Auditor:** Claude (Sonnet 4.6 / Opus 4.8), working from WebSearch + WebFetch + GitHub CLI

---

## Summary counts

| Status | Count |
|---|---|
| Verified accessible (full text fetched or open access) | 14 (the 11 prior + 2026-06-20: sala-gobet-2017 open access, salomon-perkins-1989 full PDF read, xu-2026 arXiv preprint) |
| Partially accessible (abstract / secondary descriptions / publisher pages / ERIC / Wikipedia) | 28 (the 20 prior + 2026-06-20: barnett-ceci-2002, bransford-schwartz-1999, donker-2014, gentner-2003, gick-holyoak-1983, hatano-inagaki-1986, nisbett-wilson-1977, schwartz-martin-2004) |
| Inaccessible (citation only, no secondary found) | 0 |

| Verdict | Count |
|---|---|
| Consistent | 38 → 47 (the earlier 2026-06-20 batch added 10; the reviewer-expansion wiring added 9 more — abrami-2015, thorndike-woodworth-1901, detterman-1993, sala-2019, veenman-2006, schoenfeld-1992, nrc-onet-2010, gonczi-1994, brockmann-clarke-winch-2008) |
| Partially inconsistent (minor discrepancy flagged) | 1 → 2 live (xu-2026 — κ recovery/venue, **background.html corrected**, Findings #3; dearden-2004 — the NVQ source carries an ability-bias confound, **now cited precisely in §11**, Findings #4). Plus **2 staged** not yet wired (belenky-nokes-malach-2012 would invert the study; camerer-loewenstein-weber-1989 narrow) |
| Staged (card present, source not yet cited in any live doc) | 3 (belenky-nokes-malach-2012, bilalic-2009, camerer-loewenstein-weber-1989) |
| Unverifiable | 0 |
| Questionable | 0 |

---

## Reference table

| # | Short title | File | §cited | Accessibility | Verdict |
|---|---|---|---|---|---|
| 1 | Anderson & Krathwohl 2001 — Revised Bloom's Taxonomy | [anderson-2001.md](anderson-2001.md) | §2, §5 | Partial (publisher descriptions, Krathwohl 2002 overview) | Consistent |
| 2 | AAC&U — VALUE Rubrics | [aacu.md](aacu.md) | §2, §3 | Open (AAC&U website; Integrative Learning rubric PDF) | Consistent |
| 3 | Biggs 1996 — Constructive Alignment | [biggs-1996.md](biggs-1996.md) | §2 | Partial (Auckland University PDF mirror available) | Consistent |
| 4 | Biggs & Tang 2011 — Teaching for Quality Learning | [biggs-tang-2011.md](biggs-tang-2011.md) | §2 (implied) | Partial (commercial book; publisher descriptions) | Consistent |
| 5 | Bloom 1956 — Taxonomy of Educational Objectives | [bloom-1956.md](bloom-1956.md) | §5 | Partial (commercial; Wikipedia and secondary) | Consistent |
| 6 | Manning 2025 — Education Agent Skills Library | [manning-skills.md](manning-skills.md) | §10 | Open (GitHub repository; README verified) | Consistent |
| 7 | González & Wagenaar 2003/2005/2008 — Tuning Project | [tuning.md](tuning.md) | §3, §5 | Partial (PDFs available but binary-encoded; secondary descriptions) | Consistent |
| 8 | NECHE 2015 — CBE Policy Statement | [neche.md](neche.md) | §2 | Partial (PDF located; binary-encoded for fetch; secondary descriptions) | Consistent |
| 9 | Tomlinson 1999/2014 — The Differentiated Classroom | [tomlinson-1999.md](tomlinson-1999.md) | §5 | Partial (commercial; ASCD and secondary descriptions) | Consistent |
| 10 | Tomlinson & Imbeau 2010 — Leading and Managing | [tomlinson-imbeau-2010.md](tomlinson-imbeau-2010.md) | §5 (implied) | Partial (commercial; ASCD descriptions, ERIC abstract) | Consistent |
| 11 | Wiggins & McTighe 2005 — Understanding by Design | [wiggins-2005.md](wiggins-2005.md) | §2, §5, §7 | Partial (commercial; Wikipedia; extensive secondary) | Consistent |
| 12 | Willingham 2007 — Critical Thinking: Why So Hard to Teach? | [willingham-2007.md](willingham-2007.md) | §4 | **Open** (Reading Rockets full text verified accessible) | Consistent |
| 13 | McPeck 1981 — Critical Thinking and Education | [mcpeck-1981.md](mcpeck-1981.md) | §4 | Partial (commercial book; philosophical reviews available) | Consistent |
| 14 | Chi, Feltovich & Glaser 1981 — Physics Problems Expert/Novice | [chi-1981.md](chi-1981.md) | §4 | Partial (Wiley paywall; DTIC archive PDF; Semantic Scholar) | Consistent |
| 15 | Larkin, McDermott, Simon & Simon 1980 — Models of Competence | [larkin-1980.md](larkin-1980.md) | §4 | **Open** (CMU library archive PDF; Jim Davies summary) | Consistent |
| 16 | Sweller 1988 — Cognitive Load During Problem Solving | [sweller-1988.md](sweller-1988.md) | §4 | **Open** (Matuschak archive PDF; extensive secondary) | Consistent |
| 17 | Kapur 2008 — Productive Failure | [kapur-2008.md](kapur-2008.md) | §4 | **Open** (KU Leuven archive PDF; ERIC) | Consistent |
| 18 | Kapur 2016 — Productive/Unproductive Failure/Success | [kapur-2016.md](kapur-2016.md) | §4 | Partial (Margulieux summary verified; ERIC abstract) | Consistent |
| 19 | Sinha & Kapur 2021 — When Problem Solving Followed by Instruction Works | [sinha-kapur-2021.md](sinha-kapur-2021.md) | §4 | Partial (SAGE paywall; multiple detailed secondary descriptions) | Consistent |
| 20 | Kapur, Saba & Roll 2023 — Prior Achievement and Inventive Production | [npj-2023.md](npj-2023.md) | §4 | **Verified via source PDF** (open access) | Consistent (after 2026-06-01 background.html revision) |
| 21 | Bjork 1994 — Desirable Difficulties | [bjork-1994.md](bjork-1994.md) | §4 | Partial (Gwern PDF binary; extensive secondary descriptions) | Consistent |
| 22 | Schön 1983 — The Reflective Practitioner | [schon-1983.md](schon-1983.md) | §4 | Partial (commercial; extensive secondary literature) | Consistent |
| 23 | Kolb 1984 — Experiential Learning | [kolb-1984.md](kolb-1984.md) | §4 | Partial (commercial; Wikipedia; Simply Psychology) | Consistent |
| 24 | Tannenbaum & Cerasoli 2013 — Debriefs Meta-Analysis | [tannenbaum-cerasoli-2013.md](tannenbaum-cerasoli-2013.md) | §4 | **Open** (Safety Insights summary; PubMed abstract) | Consistent |
| 25 | Perkins & Salomon 1992 — Transfer of Learning | [perkins-salomon-1992.md](perkins-salomon-1992.md) | §4 | Partial (McTighe PDF binary; educationforproblemsolving.net summary) | Consistent |
| 26 | Ericsson, Krampe & Tesch-Römer 1993 — Deliberate Practice | [ericsson-1993.md](ericsson-1993.md) | §4 | Partial (APA paywall; open Royal Society revisit; secondary) | Consistent |
| 27 | Macnamara, Hambrick & Oswald 2014 — Deliberate Practice Meta-Analysis | [macnamara-2014.md](macnamara-2014.md) | §4 | **Verified via source PDF** (paywall; full text fetched via Clemson library) | Consistent (after 2026-06-01 source-PDF verification — see note below) |
| 28 | NACE — Job Outlook (annual) | [nace.md](nace.md) | §4, §8 | Partial (member paywall; public press releases freely available) | Consistent |
| 29 | Doignon & Falmagne 1985 — Spaces for the Assessment of Knowledge (KST) | [doignon-1985.md](doignon-1985.md) | §2 | Partial (Elsevier paywall; DOI + secondary confirmed) | Corrected (2026-06-05; surmise-relation gloss softened after adversarial review) |
| 30 | Falmagne, Cosyn, Doignon & Thiéry 2006 — KST in Theory & Practice (ALEKS) | [aleks-2006.md](aleks-2006.md) | §2 | Partial (Springer/Elsevier paywall; DBLP + product pages confirmed) | Consistent |
| 31 | Kingston & Broaddus 2017 — Learning Map Systems (DLM) | [dlm-2017.md](dlm-2017.md) | §2 | **Open** (MDPI Education Sciences) | Corrected (2026-06-05; DAG/prerequisite framing removed after adversarial review) |
| 32 | Salomon & Perkins 1989 — Rocky Roads to Transfer | [salomon-perkins-1989.md](salomon-perkins-1989.md) | §4 | **Open** (BCcampus PDF, full text read) | Consistent |
| 33 | Bransford & Schwartz 1999 — Rethinking Transfer (PFL) | [bransford-schwartz-1999.md](bransford-schwartz-1999.md) | §4 | Partial (AAA Lab PDF binary; constructs in secondary) | Consistent |
| 34 | Schwartz & Martin 2004 — Inventing to Prepare for Future Learning | [schwartz-martin-2004.md](schwartz-martin-2004.md) | §4 | Partial (AAA Lab PDF binary; abstract + ERIC + citing sources) | Consistent |
| 35 | Gick & Holyoak 1980/1983 — Analogical Transfer & Schema Induction | [gick-holyoak-1980-1983.md](gick-holyoak-1980-1983.md) | §4 (anchor `ref-gick-holyoak-1980-1983`) | **Verified** (both PDFs held; reviewer 2026-06-20) | Consistent (one numerical caveat) |
| 36 | Gentner, Loewenstein & Thompson 2003 — Analogical Encoding | [gentner-loewenstein-thompson-2003.md](gentner-loewenstein-thompson-2003.md) | §4 (anchor `ref-gentner-loewenstein-thompson-2003`) | **Verified** (full-text PDF held; reviewer 2026-06-20) | Consistent |
| 37 | Barnett & Ceci 2002 — A Taxonomy for Far Transfer | [barnett-ceci-2002.md](barnett-ceci-2002.md) | §4 | Partial (abstract + secondary) | Consistent |
| 38 | Hatano & Inagaki 1986 — Two Courses of Expertise (routine/adaptive) | [hatano-inagaki-1986.md](hatano-inagaki-1986.md) | §4 | Partial (book chapter; secondary syntheses) | Consistent |
| 39 | Sala & Gobet 2017 — Does Far Transfer Exist? (+ Sala et al. 2019) | [sala-gobet-2017.md](sala-gobet-2017.md) | §4 | **Open** (PMC / LSE CC-BY) | Consistent |
| 40 | Donker et al. 2014 — Learning-Strategy Instruction Meta-Analysis | [donker-2014.md](donker-2014.md) | §4 | Partial (Elsevier paywall; Groningen landing + Semantic Scholar) | Consistent |
| 41 | Nisbett & Wilson 1977 — Telling More Than We Can Know | [nisbett-wilson-1977.md](nisbett-wilson-1977.md) | §4 | Partial (APA paywall; ResearchGate full text; 13k+ cites) | Consistent |
| 42 | Xu et al. 2026 — Evaluating 21st-Century Competencies with LLMs | [xu-2026.md](xu-2026.md) | §7 | **Accessible** (arXiv:2601.10983 preprint, full text read) | **Partially inconsistent → background.html corrected 2026-06-20** (see Findings #3) |

**Reviewer-expansion rows (wired into the live docs 2026-06-20):**

| # | Short title | File | §cited | Accessibility | Verdict |
|---|---|---|---|---|---|
| 43 | Abrami et al. 2015 — Teaching Critical Thinking: A Meta-Analysis | [abrami-2015.md](abrami-2015.md) | §4 | Accessible (held PDF) | Consistent — wired as the §4 immersion-over-generic corroboration |
| 44 | Thorndike & Woodworth 1901 — Influence of Improvement in One Mental Function | [thorndike-woodworth-1901.md](thorndike-woodworth-1901.md) | §4 | Verified (PDF) | Consistent |
| 45 | Detterman 1993 — Transfer as an Epiphenomenon | [detterman-1993.md](detterman-1993.md) | §4 | Secondary (no copy held) | Consistent (sourcing caveat) |
| 46 | Sala et al. 2019 — Near and Far Transfer: Second-Order Meta-Analysis | [sala-2019.md](sala-2019.md) | §4 | Verified (PDF) | Consistent |
| 47 | Veenman et al. 2006 — Metacognition and Learning | [veenman-2006.md](veenman-2006.md) | §4 | Accessible (held PDF) | Consistent |
| 48 | Schoenfeld 1992 — Learning to Think Mathematically | [schoenfeld-1992.md](schoenfeld-1992.md) | §4 (+ deep-dive prose) | Accessible (held PDF) | Consistent |
| 49 | NRC 2010 — Review of O*NET | [nrc-onet-2010.md](nrc-onet-2010.md) | §11 | Accessible (PDF) | Consistent |
| 50 | Gonczi 1994 — Competency-Based Assessment in the Professions | [gonczi-1994.md](gonczi-1994.md) | §11 | Accessible (OCR PDF) | Consistent |
| 51 | Brockmann, Clarke & Winch 2008 — Knowledge, Skills, Competence (VET) | [brockmann-clarke-winch-2008.md](brockmann-clarke-winch-2008.md) | §11 | Accessible (PDF) | Consistent |
| 52 | Dearden, McGranahan & Sianesi 2004 — Returns to NVQs at Level 2 | [dearden-2004.md](dearden-2004.md) | §11 | Accessible (PDF) | Partially inconsistent (source) → **§11 now cites it precisely** (poor-to-negative returns + ability-bias caveat); see Findings #4 |

**Staged cards** (reviewer-supplied 2026-06-20; present in `docs/references/` but the source is **not yet cited in any live doc** — left staged deliberately):

| Card | Would support | Accessibility | Why staged |
|---|---|---|---|
| [belenky-nokes-malach-2012.md](belenky-nokes-malach-2012.md) | §5/PFL (mastery-goals → preparation for future learning) | Accessible (PDF) | **Partially inconsistent** — a §5 citation as drafted would *invert* the study's central interaction; needs careful phrasing before wiring |
| [bilalic-2009.md](bilalic-2009.md) | §5 (chess specialization / Einstellung) | Verified (PDF) | Consistent, but no natural anchor in the current docs yet |
| [camerer-loewenstein-weber-1989.md](camerer-loewenstein-weber-1989.md) | §7 (curse of knowledge) | Verified (PDF) | **Partially inconsistent** (narrow: application context) — hold until the §7 use is pinned down |

*Also present: `_NEW_from_measurement_hypotheses_spec.md` — the reviewer's Tier-1/2/3 triage of which 2026-06-19 measurement-hypotheses citations belong in the pedagogical lit review vs. a separate methods/architecture bibliography. Not an audit row.*

---

## Findings requiring attention

### 1. npj 2023 (Kapur, Saba & Roll) — "degrees not thresholds" framing [file: npj-2023.md]

**Discrepancy:** The background doc says this paper "establishes that productive failure works in degrees rather than at a discrete threshold." The paper's data more naturally supports a *threshold* reading: students need sufficient topic-specific prerequisite knowledge to engage, but once past that threshold, global prior achievement becomes less predictive (with inventive production being the stronger predictor). The paper does not explicitly frame its findings as "degrees not thresholds." The doc's caveat in the same paragraph — "productive failure can benefit lower-achieving students disproportionately when at least minimal relevant knowledge is in place" — is actually a more precise characterization of the paper's findings than the "degrees not thresholds" sentence. **Severity: Minor.** The core empirical claim (PF can benefit lower-achieving students; inventive production > prior achievement as predictor) is correctly represented.

### 2. Macnamara 2014 — RESOLVED 2026-06-01 (false positive)

The audit-agent flagged the "~12%" figure as potentially understating
the paper, citing "~18%" as an alternative figure circulating in
secondary literature. Direct read of the source PDF (now in
`docs/references/_pdfs/macnamara-hambrick-oswald-2014.pdf`) confirms
the paper's headline meta-analytic estimate is precisely 12% (95% CI
[9%, 15%]). The "18%" in the paper is the sports-specific domain
estimate (games 26%, music 21%, sports 18%, education 4%, professions
<1%) — not an overall figure. The "~18% of reliable variance" the
agent thought might apply is from Hambrick et al. 2014, a different
paper. The background doc's "~12%" is exactly correct; no revision
needed.

### 3. Xu et al. 2026 — selective κ + unverified venue [file: xu-2026.md] — RESOLVED 2026-06-20

**Discrepancy (two parts).** The §7 prose cited the inter-rater κ as "collapsed to 0.17–0.29" to motivate the evidence-above-zero rule. Reading the arXiv preprint (full text, arXiv:2601.10983) confirms those values are real — but they are the **initial calibration-round** disagreements (EU Key Competences κ=0.841, O*NET κ=0.288, ESDC κ=0.168); after the annotation guidelines were refined to separate "outside the course" from "potentially relevant but lacking textual evidence," the same annotators reached **κ ≈ 0.92–0.94**. The original prose acknowledged the refinement ("until the coding guidelines explicitly separated…") but omitted the recovered value — which actually *strengthens* the framework's argument (the very evidence/aspiration distinction the framework draws is what resolved the disagreement). Separately, the citation's venue ("Journal of Learning Analytics (to appear)") is **not stated on the preprint** and could not be verified. **Severity: Minor, and the framework's point is reinforced rather than weakened.** **Resolution:** `background.html` §7 + §15 corrected 2026-06-20 — added the κ≈0.92–0.94 recovery (reframing the disagreement as the absence of the evidence/aspiration line, not noise), the full paper title and annotation count (7,600), and softened the venue claim to "cited as forthcoming … venue unverified from the preprint."

### 4. Dearden et al. 2004 — the NVQ claim overstated its source [file: dearden-2004.md] — RESOLVED 2026-06-20

**Discrepancy.** §11 (and the §3 comparison table) asserted the UK NVQ system "measurably hurt graduates' labour-market prospects (IFS)" — a causal claim stronger than Dearden, McGranahan & Sianesi (2004) support. The paper finds poor-to-negative *wage returns* to NVQ Level 2 (≈ −7% to −9% after controls) but explicitly raises **ability bias** (NVQ2 takers are disproportionately lower-ability), notes returns move toward zero once ability/background are controlled, and that NVQ2 often functions as a **stepping-stone**; the large negatives concentrate in *government-training* routes. **Severity: Minor but exposed** — it was the most pull-able single citation (writeup-review §2.1). **Resolution:** `background.html` §11 now reads "an explicit competency-checklist credential whose Level 2 delivered poor and frequently negative wage returns (Dearden, McGranahan, & Sianesi, 2004) … (with the caveat that ability-bias confounds part of the raw effect)"; the §3 table mention was softened the same way; the bare "(IFS)" causal attribution was dropped.

### 2 (HISTORICAL, NOW RESOLVED). Macnamara 2014 — "~12% of expertise variance" figure [file: macnamara-2014.md]

**Discrepancy:** The background doc says "practice time alone explains only ~12% of expertise variance across domains." The meta-analysis reports domain-specific figures (games: 26%, music: 21%, sports: 18%, education: 4%, professions: <1%) and an overall estimate that varies by methodology — approximately 12% of *raw variance* or ~18% of *reliable variance*. The "~12%" figure is defensible but on the low end of the cited range and is not the figure most prominently reported in the paper's abstract. Secondary sources cite both "12%" and "18%" for this paper, leading to confusion. **Severity: Minor.** The substantive point — that practice time explains only a fraction of expertise variance — is robustly supported. The doc's use of "~" appropriately signals approximation.

---

## Load-bearing references — focused assessment

The audit priority was §4 (problem-solving as program-level emergent property) and §6 (depth extension). These are the load-bearing references and their status:

| Reference | Load-bearing claim in background doc | Verified? |
|---|---|---|
| Willingham 2007 | "processes of thinking are intertwined with the content of thought" | Yes — full text verified |
| McPeck 1981 | "no general thinking skills, since thinking is always thinking about some subject-matter" | Yes — consistent with philosophical literature |
| Chi et al. 1981 | Experts sort by principles, novices by surface features | Yes — confirmed via Semantic Scholar/DTIC |
| Larkin et al. 1980 | Experts forward-chain; novices backward-chain for lack of schemas | Yes — full text verified (CMU archive) |
| Sweller 1988 | Working-memory load crowds out schema acquisition | Yes — full text verified (Matuschak archive) |
| Kapur 2008 | Two-phase generate-then-consolidate; failure before instruction improves transfer | Yes — KU Leuven archive |
| Kapur 2016 | Four-quadrant framework; unproductive failure lacks consolidation | Yes — Margulieux summary |
| Sinha & Kapur 2021 | g ≈ 0.36, 53 studies, 166 comparisons, no procedural advantage | Yes — confirmed via multiple sources |
| npj 2023 | "degrees not thresholds" on prior achievement | **Resolved 2026-06-01** — references entry + §4 prose softened to match what the paper actually shows (inventive production dominates prior achievement when topic-specific prerequisites are present; degrees-not-thresholds is now explicitly the framework's interpretation, not the paper's claim) |
| Tannenbaum & Cerasoli 2013 | ~25% performance improvement from structured debriefs | Yes — confirmed |
| Perkins & Salomon 1992 | Far transfer requires explicit scaffolding; low-road vs high-road | Yes — secondary sources confirm |
| Ericsson 1993 | Deliberate practice → expertise | Yes — partial access; well-documented |
| Macnamara 2014 | ~12% variance explained | Partial — figure is on low end; 18% is also reported |

---

## Notes on accessibility methodology

Several PDFs were located by URL but returned binary content that the WebFetch tool could not parse as text (including the Biggs 1996 Helsinki mirror, Bjork 1994 Gwern PDF, Macnamara 2014 Gwern PDF, NECHE 2015 PDF, and Tuning project PDFs). In all these cases, the framework's claims were verified against: (a) detailed secondary literature from Semantic Scholar, ERIC, and educational psychology summaries, (b) the abstract (where available via publisher page), and (c) the extensive citations to these works in the broader literature. No content was fabricated; where verification was limited, this is stated explicitly in the individual file.
