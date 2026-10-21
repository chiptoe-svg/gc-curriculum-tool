# P3 addendum: which competencies a career target shows, decided by weight — design

Status: **draft for owner review (2026-10-21).** Extends [`2026-10-21-p3-career-weights-design.md`](./2026-10-21-p3-career-weights-design.md) and replaces its build plan's Ruling 1 ("weights only for existing member pairs").

## 1. The problem

The catalog was meant to decouple competencies from career targets: one competency can matter to several careers. Today that decoupling stops at the data. A competency "belongs to" a target when any row for the pair exists in `career_target_requirements` (the views `target_sub_competencies` and `target_coverage`, migration 0056). The 35 rows there are the old one-target-per-competency lists, so the wiki and the program views still show each competency under about one target.

Writing weights for every pair would, under that definition, make every competency a member of every target. The P3 build avoided that by writing weights only for existing pairs, which keeps the old single-target picture. Neither is what the owner wants.

## 2. The rule

A competency is shown under a career target when **either**:

- **faculty pinned it** to that target, **or**
- its **entry-horizon effective weight** for that target (P3 weights spec §4: faculty override > blend > O*NET > employer > faculty draft) is **at least τ**,

**and** faculty have not **hidden** it from that target.

- τ (the cutoff) is the owner's decision (§6). Recommended **0.5**: on the O*NET scale that is a core item rated about 3 ("important") on average across the target's occupations.
- τ decides only the **stored membership**, the one fixed list that coverage rollups, scoring scope and the database views need. People reading weights see more than that list: a slider in the app and importance bands on the wiki (§5).
- Pinning and hiding are per (target, competency). A hide always wins; a pin always shows.
- Membership uses the entry horizon only; growth weights are stored and shown in the readiness view but do not change the lists.
- Today's 35 links become **pins**, so nothing currently shown disappears.

## 3. Data

- **Weights for every pair.** The recompute writes `onet` and `employer` rows for every active competency × every target that has occupations (replacing Ruling 1). These rows no longer imply membership.
- **Faculty rows carry the pin or hide.** `career_target_requirements.status` gains the value `hidden` (migration: widen the check). A faculty row with status `draft` or `confirmed` is a pin; `hidden` is a hide. Its weight, if set and `confirmed`, is still the faculty override.
- **A derived membership table**, `career_target_membership` (`career_target_id`, `competency_id`, `basis` = `pinned` | `weight`, `effective_weight` real null, `display_order` int, `updated_at`; primary key on the pair). The recompute rewrites it, in the same transaction, from the pins, hides and effective weights. Pinned rows keep their faculty `display_order`; weight-based rows follow, ordered by weight (highest first).
- **The two views read the membership table** instead of grouping requirement rows: `target_sub_competencies` (same columns, `display_order` from the table) and `target_coverage` (same columns). Every reader already goes through these views (final review, question c), so no reader changes.

## 4. Writers that change

- **Removing a competency from a target** (`retireCompetencyFromTarget`, the target-batch `retireCompetency`) today deletes every row of the pair. Under the rule, the weight could bring it straight back, so removal becomes: delete the faculty pin and write a faculty `hidden` row. Weight rows stay (they are data, not membership).
- **Adding a competency to a target** (target batch, catalog insert) writes a pin, as today.
- **Recompute triggers:** as in the P3 build, plus blind submit and blind reset (final review, Important 2), plus after any pin, hide or batch apply. Recomputes serialize on a Postgres advisory lock (final review, Important 1 and Minor 1), so a stale run never overwrites a newer one and a removed pair cannot be re-added by a racing run (a hide is explicit and wins).

## 5. What users will see

- On deploy, nothing changes: the 35 links are pinned and almost no competency has an O*NET weight until core items are confirmed.
- As the owner confirms core items, competencies whose weight reaches τ for other targets appear under those targets too, in the wiki, program views and coverage views.
- **Importance bands.** Weights are shown in three bands that use O*NET's wording, with floors that match τ and the slider stops:

  | Band | Weight |
  |---|---|
  | Very or extremely important | ≥ 0.75 |
  | Important | 0.5 to under 0.75 |
  | Somewhat important | 0.25 to under 0.5 |

  "Extremely important" is folded into the top band, because a weight of 1.0 needs every occupation to rate the item 5. Below 0.25 is not shown. A pinned competency with no weight is listed as "Selected by faculty".
- **A slider in the app.** The app's career-target and program pages get a control, "Show competencies at least: Somewhat important · Important · Very important", that starts at τ. It filters the stored weights for that target. Pins always show; hides never show. It changes only what the viewer sees, never the stored membership.
- **Wiki target pages list by band, not by cutoff.** A static page cannot have a slider, so each target page lists every competency with a weight of at least 0.25, plus pins, grouped by band, with hides left out. This avoids a hard edge where 0.49 disappears and 0.51 appears. The page reads the weights directly, not the membership views.
- **The wiki's target pages need regenerating** for the band layout and whenever weights or membership change. Today the wiki compile loop does not regenerate target pages on its own (STATE, Arc E gap (a)). Until that is fixed, a change is followed by a manual wiki refresh of the affected target pages; the recompute report lists which pairs changed band, entered or left so the refresh can be targeted.
- **Readiness needs no cutoff.** It ranks shortfalls by weight, so a low-importance competency ranks low instead of being excluded.
- An admin view (on `/admin/bundles` or the targets admin) lists, per target, the pinned and weight-based competencies with their weights, and lets faculty pin or hide. Minimal version: a table with Pin / Hide buttons.

## 6. Decisions for the owner

1. **Default cutoff τ** for the stored membership and the slider's starting point: 0.25 · **0.5** (recommended) · 0.75 (kept on a band floor so the list matches a band).
2. **Today's 35 links become pins** (recommended), so they stay visible regardless of weight. The alternative, treating them as ordinary drafts that weight can drop, would remove some competencies from targets as soon as weights exist.
3. **Wiki refresh:** manual, targeted refresh after membership changes until the compile loop handles target pages (recommended), or fix the compile-loop gap first as part of this work.

## 7. Testing

- Rule: pinned below τ shows; hidden above τ does not; weight ≥ τ shows; < τ does not; null weight does not.
- Recompute writes weight rows for non-member pairs without changing membership by itself; membership table matches the rule; views return the same rows as before for an unchanged database (characterization test on a scratch copy of live).
- Removal writes a hide; a later recompute does not re-add the pair.
- Two concurrent recomputes serialize (advisory lock); a removal racing a recompute stays removed.
- Blind submit and reset trigger a recompute.
- Bands: 0.25, 0.5 and 0.75 land in the band they open; 0.2499 is not shown; a weightless pin shows as "Selected by faculty"; a hide never shows.
- Slider: each stop filters by its floor; pins show at every stop; the slider never writes.
- Red-proof each regression test.
