# Links Drive Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every reader of course/competency levels follows one rule: faculty level, else AI level, else the scorer's level unless faculty rejected every link, else "needs a level". Every new score makes its own link.

**Architecture:** A database view `competency_levels` (migration 0072) holds the rule. `target_coverage` is redefined over it, so its readers follow without code changes. The direct table readers that show or compute levels switch to the new view. `snapshot_competency_coverage` stays the scorer's record, used for scoring, staleness and reset. `upsertCoverageCell` adds a `scoring` link through a helper shared with the seed script. /build takes its levels from the view.

**Tech Stack:** Postgres 17 views, Drizzle `pgView(...).existing()`, Next.js routes, Vitest (DB-gated rehearsal tests on a scratch copy).

**Spec:** `docs/superpowers/specs/2026-11-20-links-drive-coverage-design.md`

## Global Constraints

- Day one: every level any reader shows is identical before and after (diff = 0), apart from /build's inflated "highest skill" levels.
- "Counts" = `status = 'confirmed'` OR (`status = 'proposed'` AND `source <> 'embedding'`). Rejected never counts.
- Foundational competencies (`sub_competencies.foundational`): K and U are NULL in every row of the view.
- Never change or remove an existing link, a faculty decision or a roll-up from code paths in this plan.
- Live DB: migration and backfill only on the owner's explicit go-ahead, after a checked `pg_dump` backup; `--expect-db` guards on scripts.
- No model calls anywhere in this plan.
- US spelling; plain UI wording: "set by hand", "AI judgment", "scorer", "needs a level", "rejected by faculty".

## Ruling (recorded in the spec's spirit)

A scored cell with **no links of any kind** keeps the scorer's level (method `scoring`). The spec's rule 3 says "when at least one link counts". Applied literally, a cell whose `matched_competency` matches no skill statement would silently drop to 0. The only things that should lower a level are faculty decisions, so only "every link rejected" does. On day one this is identical, since every above-zero cell gets a scoring link.

## Review Focus

1. A pair whose only links are rejected, plus a proposed embedding suggestion: expect `rejected` with levels 0 (suggestions don't count). Covered in Task 1.
2. A faculty-confirmed embedding link where the scorer cell is 0 or absent: expect `needs_level` with levels 0. It still appears as a row, so the matrix can mark it. Covered in Task 1.
3. Re-scoring a cell that faculty rejected: the auto-link must not re-propose or un-reject it. Covered in Task 2.
4. A retired snapshot or a retired competency must not gain rows from links or roll-ups alone. The view joins only live snapshots and active competencies, as readers do today. Covered in Task 1.
5. A faculty roll-up on a foundational competency with K/U typed in: the view still returns K/U NULL. Covered in Task 1.

---

### Task 1: Migration 0072, the `competency_levels` view, with `target_coverage` redefined over it

**Files:**
- Create: `drizzle/0072_competency_levels.sql`, `scripts/migrations/2026-11-20-levels-rollback.sql`
- Modify: `lib/db/schema.ts` (add `competencyLevels` pgView `.existing()` after `targetCoverage`; update the `targetCoverage` comment)
- Test: `tests/db/levels-migration.test.ts`

**Interfaces:**
- Produces: view `competency_levels(snapshot_id uuid, competency_id text, k_depth int, u_depth int, d_depth int NOT NULL, method text, matched_competency text, evidence_excerpt text, confidence text, rationale text, model text, generated_at timestamptz, rollup_rationale text)`, with `method` ∈ `'faculty'|'ai'|'scoring'|'needs_level'|'rejected'`. Drizzle export `competencyLevels` with camelCase fields (`snapshotId, competencyId, kDepth, uDepth, dDepth, method, matchedCompetency, evidenceExcerpt, confidence, rationale, model, generatedAt, rollupRationale`).
- `target_coverage` keeps its exact column list and order. Its source becomes `competency_levels`, and `confidence`, `rationale`, `model` and `generated_at` stay NOT NULL in practice: for non-scorer rows they come from the roll-up or link (`confidence` = `'medium'`, `rationale` = the roll-up rationale or `'Set by hand in the course builder'` / `'Linked by faculty; needs a level'` / `'Rejected by faculty'`, `model` = `'faculty:<decided_by>'` / the roll-up model / `'links'`).

- [ ] **Step 1: Write the rehearsal test.** Pattern: `tests/db/ca-migration.test.ts`, gated on a scratch DB named `gc_curriculum_links_scratch` (`tests/db/links/scratch-guard.ts`, `isLinksScratchDb()`). Each case runs inside BEGIN … ROLLBACK: it applies the 0072 body, inserts fixtures, and asserts. Cases (`it` names):
  - `scored cell with a counting scoring link → method scoring, scorer K/U/D`
  - `scored cell with no links at all → method scoring (ruling)`
  - `every link rejected, one embedding suggestion proposed → method rejected, K/U/D 0 (U/K null if foundational)`
  - `faculty roll-up beats the scorer → method faculty, roll-up K/U/D`
  - `ai roll-up used when no faculty roll-up → method ai`
  - `confirmed embedding link, no scorer cell → method needs_level, D 0, row present`
  - `confirmed embedding link, scorer cell all zero → method needs_level`
  - `foundational competency with faculty K/U set → K and U null`
  - `retired snapshot / retired competency → no row`
  - `target_coverage over live data: identical row set and values before and after 0072 (EXCEPT both ways = 0 rows)`. This is the day-one guarantee, run after the backfill in Task 2 on the scratch copy.
- [ ] **Step 2: Run** `pnpm exec vitest run tests/db/levels-migration.test.ts`. Expect FAIL (file missing). Then create the scratch DB from the latest live backup: `createdb gc_curriculum_links_scratch && gunzip -c <latest dump> | psql gc_curriculum_links_scratch`.
- [ ] **Step 3: Write `drizzle/0072_competency_levels.sql`** (BEGIN/COMMIT, `CREATE OR REPLACE VIEW` only, no table changes). The rule, which the signature doesn't determine:

```sql
-- pairs = scorer cells ∪ roll-ups ∪ counting links, restricted to non-retired snapshots and non-retired competencies
-- per pair: fr = faculty roll-up, ar = ai roll-up, sc = scorer cell,
--           counting = exists counting link, rejected_only = exists rejected link AND NOT counting
-- method = CASE WHEN fr THEN 'faculty' WHEN ar THEN 'ai'
--               WHEN rejected_only THEN 'rejected'
--               WHEN sc AND greatest(coalesce(k,0),coalesce(u,0),d) > 0 THEN 'scoring'
--               WHEN counting THEN 'needs_level'
--               ELSE 'scoring' END                       -- scorer zero, no counting link: a real 0
-- k/u/d from fr / ar / sc; 0 for rejected and needs_level; k,u forced NULL when foundational
```

  Then `CREATE OR REPLACE VIEW target_coverage` with the same select list as 0062, `FROM competency_levels c JOIN career_target_membership m ON m.competency_id = c.competency_id`. Rollback file: restore 0062's `target_coverage` definition, then `DROP VIEW competency_levels`.
- [ ] **Step 4: Run** the test on the scratch DB. Expect PASS (the live-diff case waits for Task 2's backfill and is marked `todo` until then).
- [ ] **Step 5: Commit** `feat(db): 0072 competency_levels view; target_coverage reads it`.

### Task 2: Auto-links on every score, plus the backfill

**Files:**
- Create: `lib/program/scoring-links.ts`
- Modify: `lib/db/program-coverage-queries.ts` (`upsertCoverageCell`), `scripts/catalog/seed-skill-links.ts` (use the helper for its scoring part; add `--scoring-only`)
- Test: `lib/program/__tests__/scoring-links.test.ts`

**Interfaces:**
- Produces: `scoringLinkFor(statements: string[], matchedCompetency: string | null): { statement: string; skillRef: string } | null`. It matches `matchedCompetency.trim()` against a trimmed statement and uses the same `skillRef` as the seed (`textHash(normalizeStatement(statement))`).
- Produces: `ensureScoringLink(ex, input: { snapshotId: string; competencyId: string; matchedCompetency: string | null; level: number }): Promise<'added' | 'exists' | 'no-match' | 'zero'>`. It inserts `{source:'scoring', status:'proposed'}` with `ON CONFLICT (snapshot_id, skill_ref, competency_id) DO NOTHING`. It reads the statements from the snapshot's `profile.competencies[].statement`.
- `upsertCoverageCell` calls `ensureScoringLink` after its upsert, with level = max(K, U, D).

- [ ] **Step 1: Tests:**
  - `matches the trimmed statement and returns the seed's skillRef`
  - `returns null for a matched text that is no skill statement`
  - `zero level adds no link`
  - `existing rejected link for the same skill/competency is left rejected (DO NOTHING)`
  - `upsertCoverageCell adds a scoring link for an above-zero cell` (mocked db; assert one insert with source 'scoring', status 'proposed')
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.** Move the seed's scoring loop onto `scoringLinkFor`, and add a `--scoring-only` flag that skips the embedding part (no model calls).
- [ ] **Step 4: Run the tests (expect pass).** On the scratch DB, run `seed-skill-links.ts --expect-db gc_curriculum_links_scratch --scoring-only --apply`. Expect exactly 8 links added (professional readiness: GC 4800 ×2, 3710, 3800, 3730, 1010, 1050, 2070). Turn on the Task 1 live-diff case and run it: expect 0 rows.
- [ ] **Step 5: Red-proof.** Revert the `upsertCoverageCell` call, see its test fail, restore it. Commit `feat(program): every score adds its scoring link; seed --scoring-only`.

### Task 3: Direct readers switch to `competency_levels`

**Files (each `from(snapshotCompetencyCoverage)` that shows or computes a level becomes `from(competencyLevels)`, same column names):**
- `lib/what-if/neighbor-helpers.ts:84,143`, `lib/what-if/knock-on.ts:53`
- `lib/ai/wiki/update.ts:383,541,751` (751, `loadCompetencyLinksForSnapshot`: also filter `method <> 'rejected'` and level > 0, so a rejected competency is no longer linked)
- `lib/program/prereq-gaps.ts:338`
- `lib/db/problem-solving-queries.ts:48`, `lib/db/project-trail-queries.ts:120` (raw SQL: `FROM competency_levels`)
- `lib/db/program-coverage-queries.ts:556` (below-cutoff cells)
- **Stay on the table (scorer record):** `program-coverage-queries.ts:268` (staleness), `lib/db/live-captures.ts:25`, `lib/capture/run-course-reset.ts`, `lib/program/score-stale.ts`, `lib/program/refresh-after-scoring.ts`, `scripts/program/score-stale.ts`.
- Test: update the mocks in each file's existing tests to the new table object. Add `tests/lib/db/levels-readers.test.ts`, which asserts by source scan that no file outside the "stay" list selects from `snapshotCompetencyCoverage` / `snapshot_competency_coverage`. This guards against a new reader quietly bypassing the rule.

- [ ] **Step 1: Write the source-scan test.** Expect FAIL, listing the 9 call sites.
- [ ] **Step 2: Switch each call site.** Run that file's tests after each.
- [ ] **Step 3: Run** `pnpm exec tsc --noEmit -p .` and the full suite. Expect the scan to pass and everything green.
- [ ] **Step 4: Commit** `refactor: level readers read competency_levels`.

### Task 4: /build takes levels from the view

**Files:**
- Modify: `lib/builder/library.ts` (coverage query → `competencyLevels`, carrying `method`; when links are in use, depths come from the view, not `rollUp`), `lib/builder/links.ts` (`rollUp` keeps grouping links, unmapped skills and suggestions, and no longer computes levels; its `depths` become the view rows with their links attached), `lib/builder/types.ts` (`method?: 'faculty' | 'ai' | 'scoring' | 'needs_level' | 'rejected'`), `app/build/[id]/CourseDrawer.tsx:323,351` (labels: faculty → "set by hand", ai → "AI judgment", scoring → "scorer", needs_level → "needs a level", rejected → "rejected by faculty"; the clear button reads "Use the scorer's level" and shows when method is faculty or ai), `app/api/build/links/route.ts` (doc comment for `rollup-clear`: "back to the scorer's level")
- Test: `lib/builder/__tests__/links.test.ts` (update), `library-skills-whatif.test.ts` (update)

- [ ] **Step 1: Update the tests.**
  - `a scored competency shows the scorer's level, not the highest skill` (fixture: skill D3 linked, scorer D0 → depth D0, method 'scoring')
  - `needs_level competency appears with D 0 and its links`
  - `suggestions and unmapped unchanged`
- [ ] **Step 2: Run** (expect fail), **implement**, run (expect pass), then run the full suite and tsc.
- [ ] **Step 3: On the scratch DB,** list the /build pairs whose level changes against the current deploy. Expect 262 lower, 0 higher. Save the list to `docs/superpowers/audits/2026-11-20-build-levels-before-after.md` for the owner.
- [ ] **Step 4: Commit** `feat(build): levels follow the shared rule (scorer default)`.

### Task 5: Live apply, deploy, verify, STATE

**Files:**
- Create: `scripts/migrations/2026-11-20-levels-live-apply.sh`, following the shape of `2026-11-18-strings-live-apply.sh`:
  - no argument = read-only preflight; `--apply` = backup, apply 0072, run `seed-skill-links.ts --scoring-only --apply`, verify;
  - its destructive-statement grep refuses DROP TABLE, DELETE, UPDATE, TRUNCATE and ALTER TABLE;
  - verify = `competency_levels` exists and the `target_coverage` row count is unchanged.
- Modify: `docs/STATE.md` (What's live; replace the "matrix does not read skill links yet" entry; Deferred/debt: the AI roll-up call, the AI link judge, and wiki catch-up after faculty edits).

- [ ] **Step 1:** Before applying, save `target_coverage` to a file, sorted.
- [ ] **Step 2 (owner go-ahead required):** run `--apply`. Expect the backup to be ok, 8 links added, and the verify to pass.
- [ ] **Step 3:** Deploy with `deploy.sh <full sha>`. Check /program and /build at `https://gcworkflow.clemson.edu:8443`.
- [ ] **Step 4:** Diff `target_coverage` against Step 1's file. Expect 0 changed rows.
- [ ] **Step 5:** Commit STATE.md and the apply script.
