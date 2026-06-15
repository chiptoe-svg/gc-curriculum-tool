# Occupational-Framework Utilization — Design / Utilization Plan

**Status:** Design spec (a *utilization plan*, not an implementation plan; not yet scheduled — **not urgent**). Companion to and grounded in the [occupational-frameworks research memo](./2026-06-15-occupational-frameworks-onet-research.md) and four research agents (2 conceptual, 2 operational, 2026-06-15).
**Decision basis:** the memo's split verdict + the operational inventory below.

> **One-line thesis:** Keep our hand-curated, evidence-anchored sub-competencies as the backbone. Use O*NET only for **career-destination SOC binding + a demand-side benchmark**, source the **GC-specific domain vocabulary from industry standards** (not O*NET, which is too shallow for GC), and treat **embeddings as candidate-surfacing with depth-aware human adjudication** — all **post-process**, with the capture interview left untouched.

---

## 1. Non-negotiable principles (from the research)

1. **Hand-curated backbone.** The canonical sub-competency set stays human-authored, GC-specific, evidence-anchored. No external skill list becomes the structural backbone (CBE atomization critique; UK NVQ failure).
2. **Domain tier + demand side only.** O*NET enters at its domain-anchored layers and as a demand benchmark — **never** the generic-skill tier (Critical Thinking et al.), which our own cited authorities + the National Academies reject.
3. **Demand ≠ attainment — separate columns, never merged.** O*NET Level is a *job-demand* rating with **no published crosswalk** to a KUD/Bloom depth. It is shown as a distinct "employer-required depth (demand-side)" reference, never folded into the evidence-anchored KUD score.
4. **GC vocabulary comes from industry standards, not O*NET.** Agent C confirmed O*NET omits GC's actual disciplines (color management as ICC/rendering-intent practice, imposition, substrate properties, trapping, PDF/X, packaging, press chemistry). Source domain granularity from **Idealliance/G7, Ghent Workgroup, FTA/FIRST, PRINTING United / GAERF competency models** + the GC curriculum itself. O*NET's *production-tier* DWAs/Tasks (prepress/press) are a useful partial checklist; its designer/management tiers are generic.
5. **Embeddings surface; reasoning adjudicates.** Vector similarity generates candidates and a near-miss queue; a depth-aware human/LLM step decides. Match (binary) and depth (KUD) are kept orthogonal.
6. **Capture untouched; post-process.** Nothing here changes the evidence-first interview. Any coverage-radar is a later, fenced, optional optimization.

---

## 2. Grounded inputs (from the operational agents)

### 2a. SOC binding for the 5 career targets (Agent C)

| Target | SOC code(s) | Occupation | Match | Note |
|---|---|---|---|---|
| Account Management | **11-2011** (+41-3011) | Advertising & Promotions Managers ("Account Executive" alt-title) | Moderate | sell-side via 41-3011 |
| Brand Strategy | **11-2021** (+11-2011) | Marketing Managers ("Brand Manager" alt-title) | Moderate | GC brand *execution* absent |
| Production & Operations | **51-5112 + 51-5111** (+11-3051) | Press Operators + Prepress Technicians (+ Industrial Production Mgrs) | Good (operator tier) | manager tier generic |
| Creative Generalist | **27-1024** (+27-1011) | Graphic Designers (+ Art Directors) | Good | strongest match |
| AI Workflow Orchestrator | **none** | — | **No SOC home** | off-taxonomy; define in-tool |

So **2 of 5 targets** (AI Workflow Orchestrator fully; Creative Generalist partially via the design/production split) need bespoke definition; the other three bind cleanly enough to anchor a demand benchmark.

### 2b. O*NET access mechanics (Agent D)

- **Bulk download** (`onetcenter.org/database.html`, **PostgreSQL export available**, quarterly, currently 30.3): the relevant files are `Knowledge`, `Work Activities`, `Task Statements`, `Task Ratings`, `GWAs to IWAs to DWAs`, `Tasks to DWAs`. Join on `O*NET-SOC Code` + `Element ID` + `Scale ID` (`IM`=Importance 1–5, `LV`=Level 0–7, both also standardized 0–100).
- **Caveat that shapes design:** **DWAs carry no direct IM/LV scores** — they inherit from parent Generalized Work Activities via the hierarchy. The API DWA endpoint returns only `id`/`title`. So demand-depth must come from Work-Activity / Task ratings, not DWA rows.
- **REST API** `api-v2.onetcenter.org`, `X-API-Key`, polite-delay on HTTP 429. For a local app: ingest the bulk PostgreSQL export once per quarter; use the API only for fresh lookups.
- **License:** CC-BY-4.0 — must display the exact attribution string.

### 2c. Mapping precedent (Agent D)

- **Course-Skill Atlas** (Sabet/Bana, *Nature Sci. Data* 2024) mapped **3M+ US syllabi → O*NET DWAs** via SBERT embeddings + **max-cosine aggregation** per DWA. No gold labels exist; validation is qualitative + stability. This is the closest precedent and validates the embedding-candidate approach **and its limits**.
- **UniSkill** (2025): curriculum→competency binary match; annotator **κ ≈ 0.45**, best **F1 ≈ 0.83**; implicit/indirect skill mentions are the dominant failure mode; **proficiency is orthogonal to match.**
- **Embedding HITL pattern:** three-zone routing (auto-accept ≥ high threshold; **dead-zone → review queue**; auto-reject ≤ low threshold), thresholds **calibrated on a domain golden set** (κ 0.45 means borrow nothing). **Domain-adapted embeddings beat generic by +27–42 pts** (ESCOXLM-R / JobBERT-v3 / a fine-tuned skill model vs. `all-MiniLM`).
- **Level→KUD:** **no published crosswalk.** Keep O*NET Level a labeled demand reference; if binned, label the binning as engineering judgment, not science.

---

## 3. Component architecture

- **A. SOC-binding layer** — add SOC code(s) to each `career_target` (nullable; multi-valued). Records the §2a table; flags off-SOC targets for bespoke definition.
- **B. O*NET reference store** — a local, versioned ingest of the curated subset (the bound SOCs' Knowledge / Work-Activity / Task rows + IM/LV), stamped with the O*NET release. Read-only; never overwrites profile data. Doubles as a preservation win (each demand benchmark records which O*NET version produced it).
- **C. Demand-benchmark layer** — O*NET `IM`/`LV` (and, optionally, job-posting frequency percentiles) as a **demand prior** on the existing Role Outcome Profiles / `career_target_demand`. Three independent demand signals (O*NET survey · live postings · employer survey) **surfaced as consensus/dissent, never averaged** (extends `background.html` §11's existing N≥3-and-surface-dissent intent).
- **D. Domain-vocabulary expansion** — hand-curate the GC sub-competency set upward from ~6/target, using O*NET *production-tier* DWAs/Tasks **and** industry-standards competency models as sourced checklists. This is the substantive answer to "30 is too few" — done by curation, not import.
- **E. Mapping engine (post-process)** — embedding candidate-gen (max-cosine over course competencies/evidence → expanded taxonomy) → **near-miss review queue** → **two-stage adjudication**: (1) *match gate* (binary: is this competency present?), (2) *depth* (KUD, attainment-anchored, separate). O*NET Level shown beside as a demand reference. **Depth-aware near-miss rule:** related-but-distinct skills converge at high depth, split at low (the color-management↔measurement case) — encoded in adjudication, not in cosine.
- **F. Capture** — unchanged. Optional later coverage-radar is fenced advisory only.

---

## 4. Phased plan (build order, when prioritized)

**Phase 0 — SOC binding + read-only demand benchmark (lowest risk, highest immediate validity).**
Bind the 3 cleanly-mapped targets to SOC codes; ingest their O*NET domain-tier elements (Knowledge/Work-Activity/Task + IM/LV) into the reference store; render a read-only "external demand benchmark (O*NET)" panel beside each Role Outcome Profile. **No change to scoring.** Validates the data and delivers external-validity signal immediately. Define the 2 off-SOC targets in-tool.

**Phase 1 — Hand-expand the GC sub-competency taxonomy.** Curate upward using O*NET production-tier checklists + industry-standards models (Idealliance/Ghent/FTA/GAERF) + curriculum. Backbone stays hand-authored + evidence-anchored. Directly fixes the "too few" problem; re-scores existing snapshots against the richer set (post-process, idempotent).

**Phase 2 — Demand-benchmark integration.** Wire O*NET `IM`/`LV` (+ optional postings) as a demand prior into `career_target_demand` / the demand seam; surface consensus/dissent; keep demand and attainment in separate columns. The partner survey now *refines* an O*NET baseline rather than originating it.

**Phase 3 — Embedding candidate-gen + near-miss review queue.** Domain-adapted embeddings; three-zone routing; golden-set-calibrated thresholds; two-stage match/depth separation; adjudication decisions become training data. Powers mapping course competencies → the expanded taxonomy at scale.

**Phase 4 (optional, later) — course-capture coverage radar.** Fenced advisory nudge in the interview; only if the post-process gap-report → re-interview loop proves too slow in practice.

Phases 0–1 are self-contained and deliver most of the value (external validity + the granularity fix) with no change to the evidence-first core.

---

## 5. Open questions / risks (not yet resolved)

- **Level→KUD has no validated mapping.** Treat O*NET Level strictly as a labeled demand reference; do not let it drive KUD.
- **Golden set required** before any embedding thresholds are trusted (κ 0.45 across the literature). Adjudication is non-optional; budget for it.
- **The 2 off-SOC targets** (AI Workflow Orchestrator, Creative Generalist) need bespoke, in-tool demand definitions — O*NET cannot supply them.
- **Industry-standards sources** (Idealliance/G7, Ghent Workgroup, FTA/FIRST, GAERF) must be acquired and curated; licensing/availability to confirm.
- **Domain-adapted embeddings** (vs. generic) materially affect quality — pick/fine-tune before production.
- **Implicit-skill miss** (the dominant false-negative mode) means the mapping will systematically under-detect what a course covers but doesn't name; the post-process gap-report + re-interview loop is the mitigation.

---

## 6. Key sources

Memo + Agents 1–2 (conceptual): National Academies (2010); Willingham; Perkins & Salomon; Gick & Holyoak; Gonczi; Lombarts; Winch; IFS (NVQ); UniSkill; Handel (2016). Agents C–D (operational): O*NET OnLine occupation pages (27-1024, 27-1011, 51-5111, 51-5112, 11-2011, 11-2021, 41-3011, 11-3051); `onetcenter.org/database.html` + `services.onetcenter.org` API reference; Course-Skill Atlas (*Nature Sci. Data* 2024, arXiv:2404.13163); UniSkill (arXiv:2603.03134); ESCO qualification-linking pilot; Lightcast methodology; Gloat (domain embeddings). Full URLs in the four agent transcripts and the companion memo.
