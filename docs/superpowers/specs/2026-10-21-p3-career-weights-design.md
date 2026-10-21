# P3 career weights: O*NET base, employer refinement — design

Status: **draft for owner review (2026-10-21).** Supersedes step 4 ("O*NET weight seed") of [`2026-10-11-competency-catalog-and-career-demand-design.md`](./2026-10-11-competency-catalog-and-career-demand-design.md) §4; everything else in that spec stands.

## 1. Why this changes

Weight answers one question: **how much does this competency matter for this career?** (O*NET's Importance question; the 2026-10-11 spec, decision 3). It is not "how distinctive is it for this career": a skill every GC job needs is important for each of them.

The 2026-10-11 seed took, per occupation, the **highest** Importance among a competency's confirmed O*NET items. Computed on live data after the 2026-10-21 re-map (all core + related items treated as confirmed), almost every competency lands between 0.75 and 0.90 for every target (median 0.76–0.89; 10th–90th percentile spread about 0.1). Cause: each bundle has 20–50 linked items, many only loosely connected (e.g. a broad "communicating with supervisors" element as *related*), and one of them is always rated highly important. The weight then reflects the most important thing loosely attached to the competency, not the competency.

A distinctiveness formula (importance here minus importance across all GC destination occupations) was tested and **rejected by the owner**: it would mark down skills that matter everywhere. Its better score against the draft target lists is not evidence, because those lists name what is specific to each career and omit what every career needs.

## 2. O*NET weight (the base)

For target *t*, horizon *h*, competency *c*:

- Each confirmed O*NET item's Importance (1–5) is rescaled to 0–1 as (IM − 1) / 4 (unchanged).
- **Only items at position `core` count fully.** `related` items count at a discount *d* (owner decision, §6); `fringe` items never count. Position is the reviewer's confirmed position, not the AI's.
- Per occupation: the highest discounted Importance among the competency's counting items in that occupation (an element counts in every occupation it is rated for; a task only in its own occupation).
- `w_onet(t, h, c)` = Σ over the target's occupations (occupation share × that per-occupation value). Occupations where the competency has no counting item contribute 0.
- A competency with no counting item anywhere has **no O*NET weight** (not 0): it falls to the AI-drafted faculty weight, as in the 2026-10-11 spec §4 step 5.

Consequence for review: only **core** items (and related items, if *d* > 0) can change a weight, so the P2 member review is limited to them (§5).

Weights may still cluster: O*NET Importance for relevant work mostly sits between 3 and 4.5. That is a faithful outcome. Required depth (separate field) does more of the work of distinguishing careers; weight then separates "matters a lot" from "matters some".

## 3. Employer weight from Position Capture

Position Capture already records, per interviewed position (`position_captures`, one per partner position, linked to a career target):

- **Rated experiences**: 10 items, each tagged with a catalog competency (`sub_competency_id`, may be null), rated by the partner 1–7 for importance.
- **Qualifying competencies** from synthesis, each with a required K/U/D and a competency id (best effort).

Per capture *p* and competency *c*:

- `imp_p(c)` = the highest rating among the experiences tagged *c*, rescaled (r − 1) / 6.
- A competency named in qualifying competencies but with no rated experience: recorded as **named, unrated** (it counts as evidence that the competency matters, but contributes no number; shown in the source view).
- A competency not mentioned: **no data**, never 0. Ten experiences cannot cover 46 competencies; silence is not a rating of "unimportant".

`w_emp(t, h, c)` = mean of `imp_p(c)` over the target's submitted captures that rated *c*; *n* = how many did. Entry horizon only at first; growth uses the trajectory question already planned in the 2026-10-11 spec §4 step 6 ("filled for immediate requirements or for growth potential; where it leads in 3–5 years") once that question exists.

Retired or superseded captures (`retired_at`, `supersedes`) are excluded.

## 4. Combining sources

`weight(t, h, c)` = (k × w_onet + n × w_emp) / (k + n)

- With no captures (*n* = 0) the weight is the O*NET weight.
- *k* is how many employer ratings O*NET is "worth" (owner decision, §6). Each employer who rates the competency moves the weight toward the employer view; after *k* such employers the two count equally.
- With no O*NET weight, the weight is `w_emp` when *n* ≥ 1, otherwise the AI-drafted faculty weight.
- **Faculty can always override** a weight; the override is stored with `weight_source = faculty` and a note, and wins until removed.
- `career_target_requirements` keeps one effective weight per (target, competency, horizon). The components (`w_onet`, `w_emp`, *n*, override) are stored beside it so the **source view** (2026-10-11 spec §5) shows each source and flags a disagreement when |w_onet − w_emp| ≥ 0.25 with *n* ≥ 2.
- Recompute is deterministic and cheap (no AI): on member confirmation changes, on capture submission or retirement, and on faculty override. A recompute never overwrites a faculty override.

Required depth (K/U/D) is unchanged by this spec: O*NET Level is not used (2026-10-11 spec, risk "O*NET Level redundancy"); employer `required_for_success` from synthesis adds `employer` depth rows beside faculty drafts, as already planned.

## 5. Review scope (replaces the full P2 item review)

The owner does not review all ~1,500 proposed members. Review covers, per bundle:

- every **core** item (typically 5–10), and **related** items only if *d* > 0;
- in the order of their Importance in the target occupations, highest first, since the highest counting item per occupation sets the weight.

Fringe items stay `proposed` and feed nothing. The admin page's existing Confirm / Reject / Change position actions are enough; a "core first, by Importance" ordering of the review queue is the only UI change.

## 6. Decisions for the owner

1. **Related discount *d*:** 0 (core only; smallest review) · 0.5 · 0.7. Recommended: **0** to start, because "related" is where the loose items that caused the clustering sit; raise it later if core-only leaves good competencies without a weight.
2. **Employer strength *k*:** how many employer ratings equal O*NET. Recommended: **3**, so one employer moves a weight noticeably but cannot flip it alone, and three agreeing employers count as much as the national data.
3. **Disagreement flag** at |w_onet − w_emp| ≥ 0.25 with *n* ≥ 2: keep or change.
4. **Draft target lists:** two listed competencies (`change-management`, `prompt-design`) are no longer active bundles; the lists are drafts from before the catalog and should be refreshed when P3 requirements are seeded.

## 7. Testing

- Pure weight function with fixed inputs: core-only vs discounted related; an element counted across occupations vs a task only in its own; occupations with no counting item contribute 0; no counting items → no O*NET weight (null, not 0).
- Employer: max of tagged ratings per capture; untagged and named-unrated experiences contribute no number; retired captures excluded; *n* counts only captures that rated *c*.
- Blend: *n* = 0 returns `w_onet`; no O*NET weight with *n* ≥ 1 returns `w_emp`; a faculty override survives a recompute.
- Red-proof each regression test (shown failing with the fix reverted).
- On live data, after review: report the distribution of weights per target next to the 2026-10-21 baseline (0.75–0.90 cluster), as information, not a pass/fail gate.
