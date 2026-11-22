# Blind judge instructions: wiki pages (agents vs single calls)

Companion to `2026-11-22-blind-judge-prompt.md` (scoring). Same blinding rules; a different question.
`<out>` is the wiki run's output directory (`scripts/bench/agent-wiki.ts`).

## What you may read

- Your batch file `<out>/judge/batches/b<N>.json` (first judge) or `<out>/judge/pairs-second.json`
  (second judge). Each pair is `{id, course, competency, A, B}`; `course` is the wiki page id
  (e.g. `courses/gc-1010`, `targets/brand-strategy`). `A` and `B` are two versions of that page,
  each `{ markdown }`. Ids are opaque; order is shuffled.
- `<out>/judge/facts.json`: the database facts for each page (counts, course lists, career-target
  ids), read from the bench copy of the database.
- Read-only SQL on the bench database (`gc_curriculum_builder_scratch`) if you need more of the
  underlying data (course profiles, capture snapshots, prerequisites).
- `lib/ai/prompts/shared/depth-scale.md` and the wiki writer prompt `lib/ai/wiki/` for what a page
  is meant to do.

## What you must not open

Nothing else under `<out>`: not `blind-key.json`, `summary.*`, `calls.json`, other batches, or
another judge's verdicts. Do not infer which version is which from ids, order, front-matter style
or wording. Do not write anywhere except your verdicts file.

## The question for each pair

> Which version is the more accurate and more useful page for a faculty reader, given the data?

In this order:
1. **Accuracy.** Numbers, course lists, prerequisites and career-target references must match
   `facts.json` and the database. A wrong or invented fact outweighs any gain in prose.
2. **Supported claims.** Statements about what students do must follow from the data (evidence above
   zero, per the depth scale). Claims that go beyond the data count against a page.
3. **Usefulness.** Clear, specific, organized for a faculty member deciding what to change.

Do not favor a version because it is longer, more confident, more polished or formatted
differently. A shorter page that is right beats a longer page with one wrong fact.

Answer `A`, `B`, or `tie`, with one sentence of reason naming the deciding point.

## Output

One JSON array: `<out>/judge/verdicts-b<N>.json` (first judge) or `<out>/judge/verdicts-second.json`
(second judge), entries `{"id": "p001", "winner": "A"|"B"|"tie", "reason": "..."}`, one per pair in
your file. Judge every pair.

## Residual tell (accepted)

The current wiki page recurs across several pairs for the same page id, so a judge may recognize it.
Do not use that. The `competencies/problem-solving` current page is built from a fixed template, so
that page's pairs are not effectively blind; they are reported separately.
