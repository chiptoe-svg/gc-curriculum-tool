# P3 addendum 3: AI-drafted provisional weights — design

Status: **approved by the owner (2026-10-21, "yes")**, before the 2026-10-22 demo. Extends the P3 weights spec and addenda 1–2 (`2026-10-21-p3-membership-from-weights-design.md`, `2026-10-21-p3-provisional-weights-design.md`).

## Why

A live trial run of the O*NET weight (with addendum 2's AI-proposed core items) gave every target 30–37 of 46 competencies and implausible top lists (production operations led by campaign measurement and competitive analysis). Cause: the weight takes the single most important core item per occupation, and generic O*NET work activities ("Getting Information", IM 4.9 almost everywhere) were placed as core for many competencies. Fixing that method is a later decision.

## Rule

- New weight source **`ai`** (migration 0063 widens `career_target_requirements_weight_source_check`): one entry-horizon row per (target, competency), `weight` 0–1 on the O*NET importance scale (0 not, 0.25 somewhat, 0.5 important, 0.75 very, 1 extremely), `note` = `AI draft (<model>): <one-sentence reason>`.
- Effective weight: **faculty override > AI draft > blend > O*NET > employer > faculty draft**. Basis `ai`. While an AI draft exists, the O*NET and employer weights are stored components only.
- Anything resting on an AI draft is shown as **provisional** (admin membership page, /program column labels, wiki target pages, which may also show the reason).
- The recompute never writes or deletes `ai` rows. They are loaded by `scripts/catalog/import-ai-weights.ts` (`--file`, `--expect-db`, dry run default, `--apply`; one transaction under the membership lock, then `rebuildMembership`).
- First draft: Opus (`claude-opus-5-5`), 230 ratings, 2026-10-21, from the competency descriptors and each target's alumni occupation mix.

## Testing

- Pure: an override beats the AI draft; the AI draft beats blend, O*NET and employer; basis `ai`.
- DB: imported rows decide membership; a recompute leaves them; the list reader marks them provisional with the reason; the import rejects a bad file and its dry run writes nothing.
