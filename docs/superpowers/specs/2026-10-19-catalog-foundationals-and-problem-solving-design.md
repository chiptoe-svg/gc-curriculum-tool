# Catalog foundationals, communication split, and program-level problem solving — design

**Status:** owner-approved intent 2026-10-19 (session): additions text approved ("1 - approved"), problem-solving measure approved ("2 yes"), capture to record written and spoken communication separately. This spec fixes the technical design; owner review of this file before the plan.

**Inputs (owner-approved text):** [`2026-10-19-catalog-additions.json`](./2026-10-19-catalog-additions.json) (10 new competencies, 2 descriptor revisions, problem solving as a proposed program-level entry) and the 45-card review file [`2026-10-15-bundle-cards.json`](./2026-10-15-bundle-cards.json).

## 1. Why

The five foundationals (Agency, Attention to Detail, Resilience, Curiosity, Communication) are scored in every course capture on D only, but they are not in the competency catalog (`sub_competencies`). So they have no cards, carry no career demand, and O*NET's communication items have nowhere to go. The owner approved bringing them in (Communication split into written and spoken, plus Collaboration and Professional responsibility), adding AI literacy and AI strategy, and calling out problem solving explicitly without scoring it per course.

## 2. Decisions

1. **The catalog learns "foundational".** New column `sub_competencies.foundational boolean not null default false`. For a foundational row, `know_descriptor` and `understand_descriptor` are **null** (KUD+ rule 2: null, not zero, not empty string). The two columns lose `NOT NULL`; a CHECK enforces `foundational = (know_descriptor IS NULL AND understand_descriptor IS NULL)`.
2. **The catalog learns "derived".** New column `sub_competencies.scoring text not null default 'direct'`, CHECK in (`direct`, `derived`). A `derived` competency is never scored per course: `program-score-coverage` skips it and writes no coverage rows for it.
3. **The scorer uses the flag, not names.** `program-score-coverage` today decides "foundational" by matching names in its prompt (Agency, … "or similar"). It will receive each competency's `foundational` flag and must return null K/U for those rows (strict schema + post-check). The prompt's name list becomes an example, not the rule.
4. **AI literacy is not foundational in this sense.** Its stratum is `foundational` (card grouping) but it is scored K/U/D like `quantitative-literacy`, so `foundational = false`. Stratum (card grouping) and the `foundational` flag (D-only scoring) are separate on purpose.
5. **Capture records communication in two parts from now on.** The baseline foundational list becomes six: Agency, Attention to Detail, Resilience, Curiosity, **Written Communication**, **Spoken Communication**. Existing snapshots keep their single "Communication" row unchanged (no rewrite, no recapture). When coverage is scored, an old "Communication" row may match both new catalog competencies but only as **Partial** (the scorer's same-skill rule), so old courses will read lower on each than a recaptured course would. That is accurate, and it is noted on the coverage row's rationale.
6. **Problem solving uses what is already built.** Each captured course already carries the Area-7 conditions block and gets a problem-solving band (`lib/program/problem-solving-band.ts`); the program already has the Scaffolding Strip (`/program/scaffolding`, Phase 1B Stage 1). The `problem-solving` catalog entry (`scoring = 'derived'`, `foundational = true`, D descriptor only) makes it a named competency with a card and a home for O*NET's Complex Problem Solving and Critical Thinking items. Its program view shows the evidence profile: courses by band, which conditions recur across the sequence, and the technical bundles where students reach D4+ (adapts to new conditions). **No single 0–5 number** is computed now; a numeric derived score waits until P3 needs one for career weighting, and gets its own decision then.
7. **Cards apply once, after the insert.** The card apply requires one file covering every active competency, so the order is: insert competencies → revise descriptors → apply the 45-card file.

## 3. Changes

| Area | Change |
|---|---|
| Migration `0060` (hand-written, one transaction) | Add `foundational`, `scoring`; drop NOT NULL on K/U descriptors; add the two CHECKs; backfill `foundational = false`, `scoring = 'direct'` for every existing row. Verify SQL + rollback SQL, as with 0057–0059. |
| Drizzle schema + types | `knowDescriptor`/`understandDescriptor` become `string \| null`. Every reader is updated (codegraph impact on both fields at plan time; the wiki, `/program`, Explore, the objective guide and the scorer prompt builders are the known readers). |
| Insert script | Generalize `scripts/catalog/insert-business-acumen.ts` into `scripts/catalog/insert-catalog-additions.ts` (keep the old script working for its file): reads the additions file, requires `_approval`, `--expect-db`, dry run by default, one transaction, refuses if any id exists. Inserts each new competency (`origin = 'gc_authored'`, flags from the file) plus its identity `sub_competency_map` row; applies `descriptorRevisions` only when the current text equals the expected prior text (refuses otherwise, printing both). Inserts `problem-solving` with `scoring = 'derived'` once the scorer skip ships. |
| Scorer | `program-score-coverage`: pass `foundational`; skip `scoring = 'derived'`; enforce null K/U for foundational rows. |
| Capture | `baselineFoundationalCompetencies` → six; update the capture prompts (`capture-chat-agent`, `capture-synthesis`, `capture-scores` instructions, `intended-skills-extract`), `explore-local-delta`, `lib/ai/explore/scenario.ts`, `shared/depth-scale.md`, and `app/wiki/HowToRead.tsx`. The capture chat's Communication probe splits into a written and a spoken probe. |
| Seed | `lib/domain/seed-targets.ts`: the two revised AI descriptors (keeps a fresh database consistent with live). |
| Problem-solving view | The `problem-solving` wiki competency page and a program panel built from existing band + scaffolding data (§2.6). |
| STATE.md | Schema, scripts, AI behavior, capture change, and the deferral of a numeric problem-solving score. |

## 4. Rollout (each live step needs the owner's yes in session)

1. Backup (`pg_dump`, verified) → apply 0060 → verify SQL.
2. Deploy the code (scorer, capture, readers).
3. `insert-catalog-additions` dry run → `--apply` (10 competencies + 2 revisions), then `problem-solving`.
4. `draft-bundle-cards --apply` with the 45-card file.
5. Coverage rescoring for the new competencies (paid; cost estimate first).

Not linked to career targets in this work: links and weights come with P3, as with the business-acumen set.

## 5. Testing

- Migration on the scratch DB: CHECKs reject a foundational row with K/U text and a non-foundational row without; rollback restores the prior shape.
- Insert script: dry run writes nothing; refuses on existing id, missing approval, wrong DB, or a descriptor whose current text is not the expected prior text; one transaction (a failure leaves nothing).
- Scorer: a foundational competency returns null K/U (non-null is rejected); a derived competency produces no call and no rows. **Red-proof** both.
- Capture: a new synthesis output requires both communication rows; an old snapshot with one "Communication" row still validates and renders.
- Readers: null K/U descriptors render as hidden, never "0" or "null".
- Hostile adversarial review before merge (the migration alters NOT NULL constraints on a live table).
