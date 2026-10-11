# Shared competency catalog and weighted career demand — design

**Date:** 2026-10-11 · **Status:** draft for owner review (brainstorming → spec). Builds on [`2026-10-11-career-demand-sources-options.md`](./2026-10-11-career-demand-sources-options.md) (owner chose revised option A) and [`2026-06-15-occupational-framework-utilization-plan.md`](./2026-06-15-occupational-framework-utilization-plan.md). Changes how career targets are built; does not change the capture interview.

## 1. Why

Two problems block the career-readiness question (Q1):

1. **Competencies are owned by one career target.** `sub_competencies.career_target_id` is required, so a competency several careers need is written several times — e.g. color/substrate knowledge appears as Sales "Domain literacy in production technology, equipment, and process", Production "Domain knowledge: substrates, color, materials" and Creative Technology "Color management". The same competency can't matter to a sales rep at low depth and to a prepress technician at high depth.
2. **Demand has depth but no weight.** `career_target_demand` stores required K/U/D per sub-competency (0 rows today) but nothing says how much a requirement matters, and nothing reads O*NET's ratings.

## 2. Decisions (owner, 2026-10-11)

- **Revised option A:** career demand is composed from O*NET (elements and tasks of the occupations GC graduates enter) plus GC-authored competencies O*NET lacks; weights come from more than one source; ESCO supplies names; industry standards are an internal cross-check.
- **One shared competency catalog, independent of career targets.** Career targets refer to catalog competencies, each with a weight and a required depth.
- **Weight and required depth are separate fields.** Weight = how much the competency matters to the career (O*NET's "Importance" question). Required depth = how much of it is needed, on our K/U/D 0–5 scales (O*NET's "Level" question). O*NET's own numbers for the two are nearly identical (r ≈ 0.97 on our 21 destination SOCs; NRC 2010 calls them "largely redundant"), so O*NET seeds the weight and its level descriptions help faculty write the depth; faculty and employers set the two independently.
- **No invented category set.** Categories are an optional tag on competencies for review and reporting, not tied to career targets, and not needed for stage 1. More than five are expected.
- **SkillsUSA standards stay internal** (member-only terms): used to check coverage and phrase Do descriptors, never quoted or published.
- **Business acumen gets explicit competencies:** financial literacy (pricing, margins, P&L), spreadsheet and business data analysis, business systems (CRM, ERP, print MIS), negotiation and contracts. O*NET covers these well (e.g. Sales and Marketing knowledge Importance 4.7–4.8 for Marketing and Sales Managers; Microsoft Excel is the most in-demand software across the 38 destination O*NET codes).
- **AI drafts, faculty confirm** for new competencies, merges and weights O*NET can't supply; employer captures refine them once `/partners/*` is reachable off campus.

- **Two time horizons: entry and growth (owner, 2026-10-11).** Many entry jobs could have been done without a GC background; graduates are often hired for their perceived ability to grow. Weighting only by first jobs would understate what the program provides. So every requirement carries a horizon:
  - **Entry** — demand from first-job occupations (what the curriculum answers for at graduation; what the outcome study measures).
  - **Growth** — demand from the occupations graduates hold 5–10 years after graduating. In the alumni data, Marketing Managers rise from 3.9% of first jobs to 8.8% of latest positions and Prepress Technicians fall from 10.1% to 4.4%, with general/operations managers, sales managers and executives appearing (descriptive; second-coder check pending).
  - **Growth requirements ask for a foundation, not mastery:** usually Know and Understand depth with Do low, because Do for management-level work mostly develops on the job. The program is neither credited nor blamed for on-the-job learning.
  - The two horizons are reported side by side, never blended.
  - Out of scope here: testing whether GC graduates progress faster than others from the same entry roles, and what predicts it (graduate-outcome study, trajectory work).

**Recommended, awaiting owner confirmation:**
- **Each career target's occupation mix is derived from the alumni data**, using gc_alumni's tested rule that classifies first jobs into the five targets (gc_alumni commit f545652, n = 661), instead of one hand-picked SOC per target (the app's seeds and the June plan disagree, and both miss e.g. Project Management Specialists at 6.2% of first jobs). To confirm with the gc_alumni session that the rule's output is ready to consume.

## 3. Data model

New and changed tables (Postgres, Drizzle; hand-written migration applied with the owner's go-ahead, as for 0051):

| Table | Purpose | Key fields |
|---|---|---|
| `competencies` | The shared catalog | `id` (stable slug), `name`, `know_descriptor`, `understand_descriptor`, `do_descriptor`, `foundational` (D-only, K/U null), `origin` (`migrated` \| `gc_authored` \| `onet_seeded`), `retired`, `created_by`, timestamps |
| `competency_tags` | Optional categories | `competency_id`, `tag` |
| `competency_links` | Links to outside vocabularies | `competency_id`, `source` (`onet_element` \| `onet_task` \| `esco_skill` \| `industry_internal`), `external_id`, `external_label`, `match` (`strong` \| `partial` \| `weak`), `status` (`proposed` \| `confirmed` \| `rejected`), `proposed_by`, `confirmed_by`, timestamps |
| `career_target_occupations` | Which occupations make up a target, per horizon | `career_target_id`, `horizon` (`entry` \| `growth`), `onet_soc_code`, `share` (0–1), `source` (`alumni_rule` \| `faculty`), `source_version` (e.g. gc_alumni commit + data stamp), `as_of` |
| `career_target_requirements` | What a target asks of each competency (replaces `career_target_demand`) | `career_target_id`, `competency_id`, `horizon` (`entry` \| `growth`), `weight` (0–1), `weight_source` (`onet` \| `employer` \| `faculty`), `required_k`, `required_u`, `required_d` (0–5, nullable per axis), `depth_source`, `status` (`draft` \| `confirmed`), `note`, `contributing_position_ids`; one row per (target, competency, horizon, source) so horizons stay separate and sources can disagree visibly |
| `onet_release`, `onet_occupation_ratings`, `onet_task_ratings` | Versioned read-only O*NET reference store for the destination occupations | release (31.0); element ratings (Importance, Level) and task ratings (Importance, Relevance, Frequency) for the O*NET-SOC codes in `career_target_occupations` |
| `snapshot_competency_coverage` | A course's evidenced depth on a competency (replaces `snapshot_target_coverage`) | `snapshot_id`, `competency_id`, `k_depth`, `u_depth`, `d_depth`, rationale, evidence excerpt, model |
| `sub_competency_map` | Migration record | `old_sub_competency_id` → `competency_id`, `merge_note` |

Changed references: `prerequisite_edges.sub_competency_id`, `course_intended_coverage.sub_competency_id` and `faculty_flags.sub_competency_id` point to `competencies`. `coverage_scores` (0 rows) and `career_target_demand` (0 rows) are dropped. `sub_competencies` is kept read-only until the migration is verified, then retired.

**Scoring changes from per-target to per-competency.** Today a course is scored once per (career target × sub-competency) — 764 rows over 23 snapshots and 5 targets. A course's evidenced depth on a competency doesn't depend on which career is asking, so it is scored once per (snapshot × competency), using the competency's own descriptors. This removes duplicate scoring of the same skill under different targets.

## 4. Migration of what exists

Current data (2026-10-11): 5 targets, 34 active + 2 retired sub-competencies, 764 `snapshot_target_coverage` rows, 162 `course_intended_coverage` rows; `prerequisite_edges`, `career_target_demand`, `coverage_scores`, `faculty_flags`, `position_captures` are empty.

1. **Propose merges.** An AI pass groups the 34 sub-competencies into catalog competencies (e.g. the three color items) and writes merged descriptors; the owner/faculty confirm each merge. Unmerged items become competencies one-to-one.
2. **Record the mapping** in `sub_competency_map`.
3. **Carry coverage over.** Each `snapshot_target_coverage` row maps to its competency. Where a merge combines rows for the same snapshot that disagree, keep the highest-evidence row and flag the disagreement for re-scoring rather than averaging.
4. **Seed requirements.** Each old (target, sub-competency) pair becomes a `career_target_requirements` row with `weight_source = faculty`, `status = draft` and no weight, so nothing silently gains a weight.
5. **Verify** row counts and a sample of scores before retiring `sub_competencies`.

## 5. Building a career target's demand

1. **Occupations:** `career_target_occupations` from the alumni data, with shares — **entry** from first jobs (via the target-classification rule) and **growth** from positions held 5–10 years after graduation, attributed to the target of the graduate's first job.
2. **O*NET reference store:** load O*NET 31.0 element and task ratings for those O*NET-SOC codes (CC BY 4.0 attribution shown).
3. **Links:** for each catalog competency, propose O*NET element/task and ESCO skill links (embedding shortlist → reasoning step → faculty confirmation in a review queue; match quality stamped; "no clean match" recorded). The ESCO↔O*NET occupation crosswalk (exact/close matches plus reviewed print matches) pulls the destination occupations' ESCO essential skills in as candidate names. ESCO use carries the attribution "This service uses the ESCO classification of the European Commission."
4. **O*NET weight seed:** each O*NET Importance (1–5) is rescaled to 0–1 as (IM − 1) / 4. For a competency, weight = Σ over the target's occupations of (occupation share × the highest rescaled Importance among its confirmed linked O*NET items in that occupation). Taking the highest link, not the sum, keeps a competency with many weak links from outweighing one with a single strong link. Recorded as `weight_source = onet`, `status = draft`.
5. **Weights O*NET can't give:** competencies with no confirmed O*NET link (e.g. workflow-technology and AI competencies, which O*NET doesn't carry for these occupations) get an AI-drafted weight with rationale from the course captures and target descriptions, `weight_source = faculty`, `status = draft`, for faculty to confirm.
6. **Required depth:** drafted per axis with O*NET's level descriptions as wording aids; faculty confirm. Growth-horizon drafts default to foundation depth (Know/Understand set, Do low) unless faculty decide otherwise. Employer Position Capture rows add `employer` rows beside them later; the interview gains one question — whether the role was filled for its immediate requirements or for growth potential, and where it leads in 3–5 years — giving growth weights an employer source.
7. **New competencies:** business-acumen and other missing competencies are AI-drafted (descriptors, links) and faculty-confirmed before they enter the catalog.

## 6. Career readiness (stage 1 — no fitted parameters)

Per career target and horizon, from confirmed requirements and coverage — shown as two readings side by side, **Ready to enter** and **Foundation for growth**, never blended:
- **Shortfalls**, ranked by weight: a competency whose best evidenced depth across the sequence is below its required depth on any axis. A high-weight shortfall is always listed on its own, never averaged into a total.
- **Met once, never reinforced:** competencies whose required depth is reached in only one course and not used in any later course.
- **Coverage of the target's demand:** share of requirement weight met, shown with the shortfall list, not as a headline readiness percentage.
- **Source view:** each requirement shows its weight and depth sources and any disagreement between them.

Stage 2 (later, separate spec): recency-weighted fading (Half-Life Regression / FSRS or PFA-Decay form) once outcome data allow fitting.

## 7. Surfaces that change

- **Program Coverage Matrix** (`/program`): rows become a target's requirements over shared competencies; cells read `snapshot_competency_coverage`; refresh scores per competency.
- **Career target editor** (`/api/targets/...`, admin synthesis, sufficiency panel): edits requirements (weight, required depth, sources) instead of owned sub-competencies; a catalog editor manages competencies, merges, tags and links.
- **Link review queue** (new admin page): confirm/reject proposed O*NET and ESCO links and AI-drafted weights.
- **Readiness view** (new page, `/program/readiness`, linked from `/program`).
- **Prerequisite edges, intended coverage, scaffolding, flags, Explore (career-fit, ripple, scenario), wiki pages, Position Capture rated items, synthesis**: re-pointed from sub-competencies to competencies.
- **Capture interview: unchanged.**

About 60 source files and 31 test files reference sub-competencies today; the plan must sequence them so the app keeps working between steps.

## 8. Phasing

- **P0 — Catalog and migration (no behavior change for faculty).** New tables, merge proposals + owner confirmation, coverage carried over, all references re-pointed, per-competency scoring. Coverage matrix and other views render as before, from the new tables.
- **P1 — Occupations, O*NET store, requirements.** Alumni-derived occupation mixes for both horizons (entry: first jobs; growth: 5–10 years out); O*NET 31.0 reference store; requirements with draft weights (O*NET-seeded where linked, AI-drafted otherwise) and draft depths; business-acumen competencies added.
- **P2 — Links and review.** Embedding shortlist + reasoning + faculty review queue for O*NET/ESCO links; golden set of confirmed links before any automatic thresholds are trusted.
- **P3 — Readiness view (stage 1).**
- **Later:** categories (AI-proposed tags, faculty-named), employer refinements, stage 2 decay.

## 9. Testing

- Migration: row-count and spot-check tests (every old coverage row maps; no snapshot loses a competency; merged disagreements flagged, not averaged); red-proof each regression test.
- Requirement math: weight seed from known O*NET values and occupation shares; shortfall ranking; a high-weight shortfall never hidden by strengths elsewhere; reinforcement count; drafts never counted as confirmed.
- Source handling: disagreeing sources shown side by side; no averaging.
- Adversarial review before merge (the migration rewrites persistent data).

## 10. Risks and open questions

- **Merge judgment.** Merging competencies changes what past scores mean; every merge needs owner/faculty confirmation, and disagreements are re-scored, not averaged.
- **Link quality.** Published agreement on curriculum-to-skill matching is modest (κ ≈ 0.45 in UniSkill; LLM–expert agreement "mostly Fair" in Zamecnik et al. 2024); nothing is weighted from an unconfirmed link.
- **Alumni rule readiness** and the second-coder check on alumni coding.
- **Workload.** Faculty confirmation of merges, links, weights and depths is real work; the review queue should batch it and show AI rationale.
- **O*NET Level redundancy** means O*NET can't independently inform required depth; depth rests on faculty and employer judgment.
- **Out of scope:** changing the capture interview; publishing SkillsUSA content; stage 2 decay; job-posting signals.
