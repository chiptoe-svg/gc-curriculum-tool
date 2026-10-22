# P3 addendum 2: provisional weights from AI-proposed core items — design

Status: **approved by the owner (2026-10-21, "yes")**, before the 2026-10-22 demo. Extends [`2026-10-21-p3-career-weights-design.md`](./2026-10-21-p3-career-weights-design.md) §2 and [`2026-10-21-p3-membership-from-weights-design.md`](./2026-10-21-p3-membership-from-weights-design.md).

## Problem

A weight came only from **confirmed** core items. On live, 9 of 46 competencies have confirmed items (the blind-check bundles), so a real recompute would spread those 9 across most career targets and leave the other 37 on one target each. The picture would follow which bundles were sampled, not the careers. 38 bundles hold 223 AI-proposed core items awaiting review.

## Rule

For each competency (bundle), the O*NET weight uses:

- its **confirmed** O*NET members, if it has at least one confirmed O*NET member; otherwise
- its **AI-proposed core** O*NET members (`status = 'proposed'`, `position = 'core'`), as a **provisional** weight;

and never members of a bundle whose blind sample is not yet submitted (blind lock).

The formula is unchanged (core counts fully, related × d = 0, fringe never).

- A provisional `onet` row carries `note = 'provisional: AI-proposed core items'`. A confirmed one carries no note. The first confirmed member of a bundle switches it to confirmed-only on the next recompute (any review click).
- Readers show "provisional" next to the importance where the effective weight rests on a provisional O*NET weight (basis `onet` or `blend`): the admin membership page, /program column labels, and the wiki target pages.

## Why

In the blind check, about 4 in 5 of the AI's core/related items were ones the owner also chose (precision 78%). Its errors were mostly omissions, and a weight takes the single most important core item per occupation, so an omission lowers a weight only if it was the top item.

## Testing

- A bundle with only proposed core items gets a provisional weight; with one confirmed member it uses confirmed items only and loses the note; a blind-locked bundle's proposed items are ignored.
- The list reader, the wiki substrate and the /program columns carry the provisional flag.
