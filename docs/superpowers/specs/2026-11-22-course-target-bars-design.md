# Course pages: bars for each career target — design (short)

Date: 2026-11-22. Owner: chose bars ("just a percentage or bars that show relative contribution to each") and approach C.

## Why

A course page's "Builds toward these career targets" lists every target for every course. Today a course counts toward a target if any coverage score on any of the target's competencies is above zero, and the five targets share most of their competencies, so the list says nothing. The owner wants the field to come from the course's own skills, placed in the department skill tree, not from coverage scores ("cart before the horse").

## What it shows

For each career target: **the share of this course's skills that feed it.** A skill feeds a target when it is placed (not rejected) under a competency that belongs to that target (`career_target_membership`). This includes placements under a parent skill whose master is that competency.

```
Builds toward these career targets
Share of this course's 13 skills that feed each target · 0 of 13 placements confirmed by faculty
Brand strategy         ██████████ 100%
Creative generalist    ██████████ 100%
Account management     ███████    69%
AI workflow            ███████    69%
Production operations  ████       38%
```

- Bars run 0–100% and are sorted largest first. Each target name links to its page.
- The bars do not sum to 100%, because one skill can feed several targets. The line under the heading says what the percentage means.
- The confirmation line counts the course's non-rejected placements that faculty have confirmed. It goes away once all are confirmed.
- If a course has no skills in the tree, the page keeps today's list. Owner may override this.

## Approach (C — owner's pick)

One shared function computes the shares from the skill tree:

```
courseTargetShares(courseCode) ->
  { totalSkills, confirmedPlacements, totalPlacements,
    targets: [{ targetId, skills, pct }] }
```

It has two readers:

1. **The course page in the app** calls the function when the page loads. Faculty confirmations, rejections and moves show at once.
2. **A wiki rebuild** (and `scripts/wiki/stamp-course-targets.ts`) writes the same numbers into the course page's front matter:
   - `contributes_to_targets`: the targets above 0%, largest share first.
   - A new line, `target_skill_shares: {brand-strategy: 100, …}`, so the curriculum chat sees the numbers.
   - The OKF tags follow, as they do today.

   This replaces today's rule (target pages' contributing courses).

**When faculty change a placement:**
- The app page updates at once.
- The markdown the chat reads updates at the next wiki rebuild or stamp run.
- The public Clemson copy updates at its next snapshot (`snapshot-public.mjs`).

The other two approaches were not chosen. Live-only (A) leaves the chat with a meaningless field. Rebuild-only (B) goes stale, because editing the tree does not trigger a rebuild.

## Rules and limits

- **No AI calls, no schema change, no migration.** The database is only read.
- **Paired courses** (for example, the GC 4900 sections) fold onto their parent's page the same way `course-targets.ts` does today. The parent's skills are the union of the sections' skills.
- **Excluded placements:** rejected placements, and placements on retired nodes. A node merged into another counts under the node it was merged into.
- **The stamp script now reads the database**, so a backfill needs the app's database settings. It stays dry-run or `--out` by default. `--in-place` is used on the wiki repo with the owner's yes, as before.
- **Below the bars:** the target pages' own "Contributing courses" lists are unchanged by this design.

## Left to the builder

The bar styling must use the existing wiki tokens. The builder also decides the exact query shape (recursive ancestry, or the tree loader in `lib/`) and how the page component is split.

Tests must cover:
- ancestry through a parent skill
- rejected and retired placements excluded
- the paired-course fold
- a course with no skills
- percentages rounded to whole numbers
- the page falling back to the list
