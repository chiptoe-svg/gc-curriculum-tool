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
- **The wiki's target pages need regenerating when membership changes.** Today the wiki compile loop does not regenerate target pages on its own (STATE, Arc E gap (a)). Until that is fixed, a membership change is followed by a manual wiki refresh of the affected target pages; the recompute report lists which pairs entered or left so the refresh can be targeted.
- An admin view (on `/admin/bundles` or the targets admin) lists, per target, the pinned and weight-based competencies with their weights, and lets faculty pin or hide. Minimal version: a table with Pin / Hide buttons.

## 6. Decisions for the owner

1. **Cutoff τ:** 0.4 · **0.5** (recommended) · 0.6.
2. **Today's 35 links become pins** (recommended), so they stay visible regardless of weight. The alternative, treating them as ordinary drafts that weight can drop, would remove some competencies from targets as soon as weights exist.
3. **Wiki refresh:** manual, targeted refresh after membership changes until the compile loop handles target pages (recommended), or fix the compile-loop gap first as part of this work.

## 7. Testing

- Rule: pinned below τ shows; hidden above τ does not; weight ≥ τ shows; < τ does not; null weight does not.
- Recompute writes weight rows for non-member pairs without changing membership by itself; membership table matches the rule; views return the same rows as before for an unchanged database (characterization test on a scratch copy of live).
- Removal writes a hide; a later recompute does not re-add the pair.
- Two concurrent recomputes serialize (advisory lock); a removal racing a recompute stays removed.
- Blind submit and reset trigger a recompute.
- Red-proof each regression test.
