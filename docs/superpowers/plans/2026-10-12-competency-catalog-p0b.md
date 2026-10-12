# Competency Catalog P0b (merges + per-competency scoring) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the two owner-approved competency merges. Switch coverage scoring from per target (with target context) to per competency (the competency's own descriptors only). Re-score the merged competencies. Retire P0a's scaffolding: the frozen `snapshot_target_coverage` backup, `coverage_scores`, and the deprecated `sub_competencies.career_target_id` / `display_order` mirrors.

**Architecture:** Migration 0057 is hand-written SQL in one transaction. It refuses to run twice, and it never deletes a competency.
- Survivors get the merged descriptors. Merged-away competencies are retired with a `merged_into` pointer.
- Every reference is re-pointed to the survivor, using one deterministic "highest evidence wins" rule.
- Old disagreements become open faculty flags. Nothing is averaged.
- The migration records the mapping in `sub_competency_map` and drops the P0a scaffolding.

On the code side:
- The target-batch planner and the seed constants become catalog-aware: one competency can belong to several targets.
- The scorer takes a list of competencies instead of a target.
- The wiki stops regenerating retired competencies.

A one-off re-score script, run against live only with the owner's go-ahead, re-scores the two survivors for every snapshot.

**Tech Stack:**
- Next.js 15 (App Router) and TypeScript strict.
- Drizzle ORM 0.45.2.
- Postgres 17 (Postgres.app, `127.0.0.1:5433`).
- Vitest 3 (DB tests use `// @vitest-environment node`).
- pnpm.

**Spec:** [`docs/superpowers/specs/2026-10-11-competency-catalog-and-career-demand-design.md`](../specs/2026-10-11-competency-catalog-and-career-demand-design.md). This plan implements §8 **P0b**, plus the P0b cleanups the P0a plan deferred (its Rulings 1, 2, 7 and 8; STATE Deferred/debt P0a items (1), (2) and M-6). It also follows §4 steps 1–3 and 5 and §9.

**Owner decisions this plan carries (2026-10-12):**
- Merge #1: `domain-knowledge` ← `gc-production-literacy` + `domain-grounding`.
- Merge #2: `project-management` ← `timeline-management`.
- Every other overlap stays separate.
- The merged descriptors are approved as written in Task 2.

## Global Constraints

- **US spelling** in code, comments, docs and ids.
- **Never print credentials.** Get `DATABASE_URL` only through `$(scripts/migrations/p0b-scratch-db.sh url)`, the scratch database built in Task 1. Never echo it. Never read `.env.local` by hand.
- **Never touch the live `gc_curriculum` database** in any task before Task 11. This includes tests, scripts, migrations and builds. The dev `.env.local` points at LIVE. Every DB test refuses to run unless `DATABASE_URL` names `gc_curriculum_p0b_scratch`. Every `pnpm build` runs with `DATABASE_URL` set explicitly to the scratch URL.
- **Live apply and the live re-score are owner-gated.** Task 11 starts with **STOP: ask owner**. The re-score makes paid AI calls.
- **Build agents work only in the worktree** `/Users/admin/projects/curriculum_developer-wt-p0b`, on branch `feat/competency-catalog-p0b` (created in Task 1). Never edit, stage or commit in the main checkout, the deploy checkout, or the P0a worktree.
- **Never run `launchctl`**, never touch the running app or the watchdog, and never `pkill`/`killall`.
- **Red-proof every regression test.** Show it failing before its fix, and record the red output in the task report.
- **Adversarial review is required before merge** (Task 10). Iterate until an honest ACCEPT.
- **STATE.md is updated in the same commit** as each schema change, and finalized in Task 9. Deferrals go in **Deferred / debt**.
- **OpenAI strict-schema rule:** every property in `properties` is listed in `required`. Optional fields are nullable unions. This applies recursively.
- **Tooling:** `pnpm exec tsx` does not resolve in worktrees. Use `node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs <script>`. Postgres binaries are `/Applications/Postgres.app/Contents/Versions/17/bin/{psql,pg_dump,pg_restore}`.
- **Commit messages** end with the attribution lines from your session's system reminder.
- **Shell state does not persist.** Every command `cd`s into the worktree.

## Rulings

1. **Survivor ids are existing ids** (`domain-knowledge`, `project-management`). *Why:* no new id means the survivors' existing coverage, intended coverage, edges, flags and wiki pages keep their keys. Only the merged-away ids need re-pointing.
2. **Merged-away competencies are retired, never deleted.** They get `retired = true` and `merged_into = <survivor>`, and their `snapshot_competency_coverage` cells stay as history. They have no requirement rows after 0057, so no target view shows them. *Why:* nothing that cites them breaks, and the history is auditable.
3. **"Highest evidence wins" is the single carry rule** for coverage cells, intended coverage and prerequisite edges. The order is:
   1. `d` descending, then `u` descending, then `k` descending (NULL counts as −1);
   2. confidence high > medium > low;
   3. the survivor's own row first;
   4. competency id ascending.

   For prerequisite edges, `confirmed` comes first, then `expected_d`, `expected_u`, `expected_k`, and the same tie-breaks. *Why:* spec §4.3 says keep the highest-evidence row and flag the disagreement, never average.
4. **Disagreement means a gap of 2 or more on any axis** among a group's cells for one non-retired snapshot. Each (course, survivor) with a disagreement gets one open `faculty_flags` row:
   - `target_kind = 'coverage_cell'` and `flagged_by = 'P0b merge (system)'`;
   - `career_target_id = 'production-operations'`, the survivors' home target;
   - `sub_competency_id = <survivor>`;
   - a note listing each member's values;
   - `flagged_context` holding the carried cell's K/U/D, so read-time drift shows once the re-score lands.

   *Why:* the existing flag panel on `/program` surfaces these flags with no new UI. The gap-of-2 threshold matches the numbers the owner saw.

   **Amendment (2026-10-12, Task 2 review):** the brief's SQL left `flagged_context` NULL — a defect in the brief, not the implementer. The flag-exists condition above is unchanged. The note and `flagged_context` both come from ONE representative snapshot per (course, survivor): the course's latest non-retired snapshot with group cells, ordered by `created_at DESC` then `id DESC`. The note lists that representative snapshot's (pre-merge) member values plus "largest gap across N captures: G". `flagged_context` is `jsonb_build_object('k', …, 'u', …, 'd', …, 'matchedCompetency', …, 'rationale', …)` built from the representative snapshot's CARRIED survivor cell (post-carry — the migration now runs the coverage-carry step before inserting flags, specifically so this read sees the carried value), matching the `FlaggedContext` interface in `lib/db/schema.ts`. The gap/detail condition itself still reads the pre-merge member cells (the survivor's own pre-merge cell from `p0b_premerge_survivor_coverage`, the merged-away members' untouched rows from `snapshot_competency_coverage`) — not the now-overwritten post-carry survivor row — so reordering carry before flags does not change which (course, survivor) pairs get flagged.
5. **The survivors' pre-merge cells are kept** in `p0b_premerge_survivor_coverage`, an exact copy taken before they are overwritten. The table is dropped after the re-score is verified, by a later decision recorded in Deferred/debt. *Why:* the merge can overwrite a survivor's own cell with a better merged-away cell, and those rows would otherwise survive only in the backup dump.
6. **Requirements:**
   - Each target that used a merged-away competency gets a survivor requirement copied from the old row: same horizon, weight, source, depths, status, note and `display_order`.
   - Where the target already has the survivor, the old row is simply deleted. In practice, Production Ops keeps `project-management` and drops the `timeline-management` row.
   - Gaps left in `display_order` are fine.
7. **`sub_competency_map` holds every competency id**: identity rows for the 32 that were not merged, plus the 4 merges, each with a `merge_note`. *Why:* any old id can be resolved to its current id with one lookup.
8. **Drops in 0057:**
   - `snapshot_target_coverage` (P0a Ruling 7);
   - `coverage_scores` (P0a Ruling 8);
   - `sub_competencies.career_target_id`, which removes the M-6 cascade hazard: deleting a target can no longer delete shared competencies;
   - `sub_competencies.display_order`.

   `career_target_demand` stays until P1.
9. **Scoring moves to one function, `scoreSnapshotCompetencies(snapshot, competencies[])`**, with no target context. The AI function id stays `program-score-coverage`. The prompt is rewritten, and the output schema becomes `program_coverage_v2`, with `competency_id` in place of `sub_competency_id` and no `career_target_id`.
   - **Bulk refresh:** for each latest snapshot, scores the active competencies used by any target that have no cell yet, in one call.
   - **Per-pair route:** keeps its URL and re-scores that target's active members.
   - **Visible change (owner-approved spec §8):** every future score is made without target context.
10. **The re-score is a separate owner-gated script** (Task 7), not part of the migration. *Why:* it makes paid AI calls and must run against the deployed new code's scorer.
11. **P0b rollback means restoring the verified pre-apply dump** (`pg_restore --clean`) with the app stopped, then redeploying the previous commit. *Why:* 0057 drops tables and columns, so a SQL rollback would be a second, riskier migration. *Cost:* anything written between the apply and the restore is lost. In practice that is only the re-score output, which can be re-run. Recorded in STATE.
12. **The wiki skips retired competencies.** A merged-away competency's page is replaced with a short stub: "Merged into [survivor] on 2026-10-12" plus a link. *Why:* the merged-away competencies keep their history cells, so wiki regeneration would otherwise keep rebuilding pages for dead items.
13. **The target-batch definitions become catalog-aware.** `lib/domain/seed-targets.ts` defines each competency exactly once, under its home target. Other targets list it by reference (`{ ref: '<id>' }`). `RETIRED_SUB_COMPETENCIES` gains an optional `mergedInto`. *Why:* if the shared definition were written out three times, the copies would drift apart.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `scripts/migrations/p0b-scratch-db.sh` | `create` / `url` / `drop` for `gc_curriculum_p0b_scratch`, cloned from live with `pg_dump` (read-only on live). Same shape and guards as `p0a-scratch-db.sh`. |
| `drizzle/0057_competency_catalog_p0b.sql` | The migration (Task 2). |
| `scripts/migrations/2026-10-12-p0b-verify.sql` | Fail-closed verification. It ends with a `DO` block that raises on any failed check. |
| `scripts/migrations/2026-10-12-p0b-rescore.ts` | Owner-gated re-score of the survivors (Task 7). |
| `scripts/migrations/p0b-apply-db.sh`, `scripts/migrations/2026-10-12-p0b-live-apply.sh` | Live runbook (Task 8), derived from the P0a pair and sourcing `p0a-lib.sh`. |
| `tests/db/p0b/scratch-guard.ts` | `isP0bScratchDb()`. |
| `tests/db/p0b-migration.test.ts`, `tests/db/p0b-characterization.test.ts`, `tests/db/p0b-scoring.test.ts`, `tests/scripts/p0b-live-apply-wrapper.test.ts` | Tests. |

**Modified (main ones):** `lib/db/schema.ts`, `lib/db/competency-catalog-queries.ts`, `lib/domain/{types,seed-targets,target-batch}.ts`, `scripts/{seed-career-targets.ts,targets/apply-target-batch.ts}`, `app/api/targets/[id]/sub-competencies/**`, `lib/ai/analyze/program-score-coverage.ts`, `lib/ai/prompts/program-score-coverage.md`, `lib/db/program-coverage-queries.ts`, `app/api/program/coverage/refresh/**`, `lib/ai/wiki/{update,refresh-all}.ts`, `docs/STATE.md`.

---

### Task 1: Worktree, P0b scratch clone, golden

**Files:**
- Create `scripts/migrations/p0b-scratch-db.sh`.
- Create `tests/db/p0b/scratch-guard.ts`.

- [ ] **Step 1:** From the main checkout at the current `dev`, run `git worktree add /Users/admin/projects/curriculum_developer-wt-p0b -b feat/competency-catalog-p0b`, then `pnpm install --frozen-lockfile` in the worktree.
- [ ] **Step 2:** Write `p0b-scratch-db.sh` by copying `scripts/migrations/p0a-scratch-db.sh`, with the database name `gc_curriculum_p0b_scratch`.
  - `create` must refuse if the scratch DB already exists.
  - It clones live with `pg_dump | pg_restore` (or `psql`), reading the live URL only through `read-env.mjs` inside `$(...)`.
  - It applies **no fixture**. P0b needs live-shaped data. If live has 0 prerequisite edges, Task 2's test inserts its own edge rows inside a rolled-back transaction.
- [ ] **Step 3:** Write `tests/db/p0b/scratch-guard.ts`. `isP0bScratchDb()` returns true only when the database name in `DATABASE_URL`'s path is exactly `gc_curriculum_p0b_scratch`.
- [ ] **Step 4:** `create`, then check the clone's P0a state with `psql -At`:
  - 36 `career_target_requirements` rows;
  - `snapshot_target_coverage` exists;
  - `snapshot_competency_coverage` row count = `target_coverage` row count.

  Record the counts in the report.
- [ ] **Step 5:** Capture the pre-0057 golden with the existing P0a probes. Run `tests/db/p0a-characterization.test.ts` in capture mode, using the env vars its header documents (see `.superpowers/sdd/2026-10-11-competency-catalog-p0a/task-8-report.md` for the exact invocation). Set `DATABASE_URL` to the P0b scratch URL and write to `$HOME/.local/share/gc-curriculum-tool/p0b/golden-pre.json`. If the P0a guard insists on the P0a name, add a second accepted name through `isP0bScratchDb()` instead of weakening the guard.
- [ ] **Step 6:** Commit the script and guard: `chore(p0b): scratch clone + guard`.

### Task 2: Migration 0057 + verify + migration test

**Files:**
- Create `drizzle/0057_competency_catalog_p0b.sql`.
- Create `scripts/migrations/2026-10-12-p0b-verify.sql`.
- Create `tests/db/p0b-migration.test.ts`.

**Interfaces — produces:**
- the column `sub_competencies.merged_into`;
- the tables `sub_competency_map(old_sub_competency_id PK, competency_id, merge_note, created_at)` and `p0b_premerge_survivor_coverage` (same columns as `snapshot_competency_coverage`);
- drops `snapshot_target_coverage`, `coverage_scores`, `sub_competencies.career_target_id` and `sub_competencies.display_order`.

- [ ] **Step 1: Write the failing test**, `tests/db/p0b-migration.test.ts`. Use `// @vitest-environment node` and `describe.skipIf(!isP0bScratchDb())`. Each test runs 0057's body inside `BEGIN … ROLLBACK`: strip the file's own `BEGIN;`/`COMMIT;` lines, the same technique the P0a reviewer used. Assert:
  1. `domain-knowledge` and `project-management` have exactly the new name and K/U/D text from Step 3. Then:
     - `gc-production-literacy`, `domain-grounding` and `timeline-management` have `retired = true`, `merged_into` set to their survivor, and no requirement rows;
     - `account-management` has `domain-knowledge` at `display_order` 4;
     - `ai-workflow` has `domain-knowledge` at 8;
     - `production-operations` has no `timeline-management` row;
     - the requirement count is 36 − 3 + 2 = 35.
  2. For every snapshot that had a cell on any group member, the survivor's cell equals the highest-evidence member cell (Ruling 3), computed independently in TypeScript from the rows read before the migration. A carried cell's rationale starts with `[P0b merge: carried from <id>] `.
  3. `p0b_premerge_survivor_coverage` equals the survivors' cells as read before the migration.
  4. One open flag per (course, survivor) where some non-retired snapshot's group cells differ by 2 or more on an axis, and no flag otherwise. Compute the expected set in TypeScript.
  5. **Intended coverage:** no rows remain on merged-away ids. The survivor's row per course equals the highest-evidence group row.
  6. **Prerequisite edges:** insert, inside the transaction and before running the migration, two edges for the same (focal, prereq) pair:
     - one on `gc-production-literacy` with `confirmed = true` and `expected_d = 2`;
     - one on `domain-knowledge` with `confirmed = false` and `expected_d = 4`.

     After the migration exactly one edge remains: re-pointed to `domain-knowledge`, with `confirmed = true` and `expected_d = 2` (confirmed beats depth).
  7. `faculty_flags` rows on merged-away ids are re-pointed. Insert one first to check this.
  8. `sub_competency_map` has 36 rows: the 4 merge rows map to the survivors, and the 32 others are identity rows.
  9. `snapshot_target_coverage` and `coverage_scores` no longer exist, and `sub_competencies` has no `career_target_id` or `display_order` column.
  10. Running 0057 a second time in the same transaction raises `0057: already applied` and changes nothing.
  11. Running it when a survivor or a merged-away id is missing or already retired raises `0057: precondition`.
- [ ] **Step 2:** Run `DATABASE_URL="$(scripts/migrations/p0b-scratch-db.sh url)" pnpm exec vitest run tests/db/p0b-migration.test.ts`. It is expected to FAIL because the file is missing.
- [ ] **Step 3: Write the migration**:

```sql
-- 0057_competency_catalog_p0b.sql — competency merges + P0a scaffolding drop.
-- Apply with the app stopped — run scripts/migrations/2026-10-12-p0b-live-apply.sh.
-- Owner decisions 2026-10-12: domain-knowledge <- gc-production-literacy + domain-grounding;
-- project-management <- timeline-management. Plan: docs/superpowers/plans/2026-10-12-competency-catalog-p0b.md
BEGIN;

LOCK TABLE sub_competencies, career_target_requirements, snapshot_competency_coverage,
  course_intended_coverage, prerequisite_edges, faculty_flags IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF to_regclass('public.sub_competency_map') IS NOT NULL THEN
    RAISE EXCEPTION '0057: already applied (sub_competency_map exists)';
  END IF;
  IF to_regclass('public.snapshot_target_coverage') IS NULL OR to_regclass('public.target_coverage') IS NULL THEN
    RAISE EXCEPTION '0057: precondition — P0a (0056) is not applied';
  END IF;
  IF (SELECT count(*) FROM sub_competencies
      WHERE id IN ('domain-knowledge','project-management','gc-production-literacy','domain-grounding','timeline-management')
        AND NOT retired) <> 5 THEN
    RAISE EXCEPTION '0057: precondition — a merge competency is missing or already retired';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('gc-production-literacy','account-management'), ('domain-grounding','ai-workflow'),
      ('timeline-management','production-operations'), ('domain-knowledge','production-operations'),
      ('project-management','production-operations')) e(cid, tid)
    WHERE (SELECT array_agg(DISTINCT career_target_id) FROM career_target_requirements WHERE competency_id = e.cid)
          IS DISTINCT FROM ARRAY[e.tid]) THEN
    RAISE EXCEPTION '0057: precondition — a merge competency is not in exactly its expected target';
  END IF;
END $$;

CREATE TEMP TABLE merge_plan (old_id text PRIMARY KEY, survivor text NOT NULL, note text NOT NULL) ON COMMIT DROP;
INSERT INTO merge_plan VALUES
  ('gc-production-literacy', 'domain-knowledge',  'Owner merge #1 (2026-10-12): production domain knowledge'),
  ('domain-grounding',       'domain-knowledge',  'Owner merge #1 (2026-10-12): production domain knowledge'),
  ('timeline-management',    'project-management','Owner merge #2 (2026-10-12): scheduling folded into project management');

CREATE TEMP TABLE merge_group ON COMMIT DROP AS
  SELECT survivor, old_id AS member FROM merge_plan
  UNION SELECT DISTINCT survivor, survivor FROM merge_plan;

-- 1. New catalog columns and tables.
ALTER TABLE sub_competencies ADD COLUMN merged_into text REFERENCES sub_competencies(id) ON DELETE RESTRICT;
ALTER TABLE sub_competencies ADD CONSTRAINT sub_competencies_merged_into_retired_check
  CHECK (merged_into IS NULL OR retired);
CREATE TABLE sub_competency_map (
  old_sub_competency_id text PRIMARY KEY REFERENCES sub_competencies(id) ON DELETE RESTRICT,
  competency_id text NOT NULL REFERENCES sub_competencies(id) ON DELETE RESTRICT,
  merge_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE p0b_premerge_survivor_coverage AS
  SELECT c.* FROM snapshot_competency_coverage c
  WHERE c.competency_id IN (SELECT DISTINCT survivor FROM merge_plan);

-- 2. Survivor descriptors (owner-approved text, 2026-10-12).
UPDATE sub_competencies SET
  name = 'Production domain knowledge: processes, substrates, materials and equipment',
  know_descriptor = 'Knows what print, packaging and brand production processes can and cannot do — substrates, inks, finishing, and the equipment and technology involved — well enough to judge whether a design, specification, workflow or AI output is producible and fit for purpose.',
  understand_descriptor = 'Understands why material, process and equipment constraints shape what is creatively and commercially possible, and why advice or systems built without this knowledge look right but fail at the point of production.',
  do_descriptor = 'Uses this knowledge on real production decisions: specifies substrate and finishing for a job, briefs a production team or a sales engineer accurately, or shows with specific production reasons where a workflow, template or AI step would succeed or fail. (Color management — profiles, calibration, process control — is scored under Color management, not here.)',
  updated_at = now()
WHERE id = 'domain-knowledge';
UPDATE sub_competencies SET
  know_descriptor = 'Knows the project life cycle (scope, plan, schedule, budget, risk, change control, close-out) and its tools — work breakdown, dependencies, critical path, status reporting — and the lead-time structure of print and packaging production at varying complexity.',
  understand_descriptor = 'Understands why projects fail at scope and handoff rather than at execution, why schedule slippage compounds and early warning signals matter more than aggressive deadlines, and why a plan has to be re-baselined when scope, budget or dates change.',
  do_descriptor = 'Plans and runs a real creative or production project from brief to delivery: defines scope, builds the schedule and budget across vendors or teams, surfaces timeline risk early enough to act, tracks changes, reports status, and closes out with a lessons-learned record.',
  updated_at = now()
WHERE id = 'project-management';

-- 3. Disagreement flags (Ruling 4), computed from the pre-merge cells.
INSERT INTO faculty_flags (target_kind, course_code, career_target_id, sub_competency_id, note, flagged_by, flagged_context)
SELECT 'coverage_cell', d.course_code, 'production-operations', d.survivor,
       'Before the P0b merge into ' || d.survivor || ', the merged competencies disagreed by 2+ levels for this course: '
         || d.detail || '. Re-scored against the merged descriptor; please check the new reading.',
       'P0b merge (system)', NULL
FROM (
  SELECT s.course_code, g.survivor,
         string_agg(DISTINCT c.competency_id || ' K' || coalesce(c.k_depth::text,'-') || '/U' || coalesce(c.u_depth::text,'-') || '/D' || c.d_depth, '; ') AS detail,
         max(gap) AS max_gap
  FROM merge_group g
  JOIN snapshot_competency_coverage c ON c.competency_id = g.member
  JOIN course_capture_snapshots s ON s.id = c.snapshot_id AND s.retired_at IS NULL
  JOIN (
    SELECT g2.survivor, c2.snapshot_id,
           greatest(max(coalesce(c2.k_depth,0)) - min(coalesce(c2.k_depth,0)),
                    max(coalesce(c2.u_depth,0)) - min(coalesce(c2.u_depth,0)),
                    max(c2.d_depth) - min(c2.d_depth)) AS gap
    FROM merge_group g2 JOIN snapshot_competency_coverage c2 ON c2.competency_id = g2.member
    GROUP BY 1, 2
  ) x ON x.survivor = g.survivor AND x.snapshot_id = c.snapshot_id
  GROUP BY 1, 2
) d
WHERE d.max_gap >= 2;

-- 4. Coverage carry (Ruling 3). Merged-away cells stay as history.
WITH ranked AS (
  SELECT g.survivor, c.*,
         row_number() OVER (PARTITION BY g.survivor, c.snapshot_id ORDER BY
           c.d_depth DESC, coalesce(c.u_depth,-1) DESC, coalesce(c.k_depth,-1) DESC,
           CASE c.confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
           (c.competency_id = g.survivor) DESC, c.competency_id) AS rn
  FROM merge_group g JOIN snapshot_competency_coverage c ON c.competency_id = g.member
)
INSERT INTO snapshot_competency_coverage (snapshot_id, competency_id, k_depth, u_depth, d_depth,
  matched_competency, evidence_excerpt, confidence, rationale, model, generated_at)
SELECT snapshot_id, survivor, k_depth, u_depth, d_depth, matched_competency, evidence_excerpt, confidence,
       CASE WHEN competency_id = survivor THEN rationale
            ELSE '[P0b merge: carried from ' || competency_id || '] ' || rationale END,
       model, generated_at
FROM ranked WHERE rn = 1
ON CONFLICT (snapshot_id, competency_id) DO UPDATE SET
  k_depth = EXCLUDED.k_depth, u_depth = EXCLUDED.u_depth, d_depth = EXCLUDED.d_depth,
  matched_competency = EXCLUDED.matched_competency, evidence_excerpt = EXCLUDED.evidence_excerpt,
  confidence = EXCLUDED.confidence, rationale = EXCLUDED.rationale, model = EXCLUDED.model,
  generated_at = EXCLUDED.generated_at;

-- 5. Intended coverage: carry the best group row to the survivor, remove merged-away rows.
WITH ranked AS (
  SELECT g.survivor, i.*,
         row_number() OVER (PARTITION BY g.survivor, i.course_code ORDER BY
           coalesce(i.intended_d,-1) DESC, coalesce(i.intended_u,-1) DESC, coalesce(i.intended_k,-1) DESC,
           CASE i.confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
           (i.sub_competency_id = g.survivor) DESC, i.sub_competency_id) AS rn
  FROM merge_group g JOIN course_intended_coverage i ON i.sub_competency_id = g.member
)
INSERT INTO course_intended_coverage (course_code, sub_competency_id, intended_k, intended_u, intended_d,
  confidence, rationale, model, generated_at)
SELECT course_code, survivor, intended_k, intended_u, intended_d, confidence, rationale, model, generated_at
FROM ranked WHERE rn = 1
ON CONFLICT (course_code, sub_competency_id) DO UPDATE SET
  intended_k = EXCLUDED.intended_k, intended_u = EXCLUDED.intended_u, intended_d = EXCLUDED.intended_d,
  confidence = EXCLUDED.confidence, rationale = EXCLUDED.rationale, model = EXCLUDED.model,
  generated_at = EXCLUDED.generated_at;
DELETE FROM course_intended_coverage WHERE sub_competency_id IN (SELECT old_id FROM merge_plan);

-- 6. Prerequisite edges: keep the best edge per (focal, prereq, survivor); confirmed beats depth.
WITH ranked AS (
  SELECT e.id, g.survivor,
         row_number() OVER (PARTITION BY e.focal_course_code, e.prereq_course_code, g.survivor ORDER BY
           e.confirmed DESC, coalesce(e.expected_d,-1) DESC, coalesce(e.expected_u,-1) DESC,
           coalesce(e.expected_k,-1) DESC, CASE e.confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
           (e.sub_competency_id = g.survivor) DESC, e.sub_competency_id) AS rn
  FROM merge_group g JOIN prerequisite_edges e ON e.sub_competency_id = g.member
)
DELETE FROM prerequisite_edges WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
UPDATE prerequisite_edges e SET sub_competency_id = m.survivor, updated_at = now()
FROM merge_plan m WHERE e.sub_competency_id = m.old_id;

-- 7. Faculty flags: re-point.
UPDATE faculty_flags f SET sub_competency_id = m.survivor
FROM merge_plan m WHERE f.sub_competency_id = m.old_id;

-- 8. Requirements (Ruling 6).
INSERT INTO career_target_requirements (career_target_id, competency_id, horizon, weight, weight_source,
  required_k, required_u, required_d, depth_source, status, note, contributing_position_ids, display_order)
SELECT r.career_target_id, m.survivor, r.horizon, r.weight, r.weight_source, r.required_k, r.required_u,
       r.required_d, r.depth_source, r.status, r.note, r.contributing_position_ids, r.display_order
FROM career_target_requirements r JOIN merge_plan m ON m.old_id = r.competency_id
ON CONFLICT ON CONSTRAINT career_target_requirements_unique DO NOTHING;
DELETE FROM career_target_requirements WHERE competency_id IN (SELECT old_id FROM merge_plan);

-- 9. Retire merged-away competencies; record the map.
UPDATE sub_competencies s SET retired = true, merged_into = m.survivor, updated_at = now()
FROM merge_plan m WHERE s.id = m.old_id;
INSERT INTO sub_competency_map (old_sub_competency_id, competency_id, merge_note)
SELECT s.id, coalesce(m.survivor, s.id), m.note
FROM sub_competencies s LEFT JOIN merge_plan m ON m.old_id = s.id;

-- 10. Drop P0a scaffolding (Ruling 8).
DROP TABLE snapshot_target_coverage;
DROP TABLE coverage_scores;
ALTER TABLE sub_competencies DROP COLUMN career_target_id;
ALTER TABLE sub_competencies DROP COLUMN display_order;

-- 11. Post-checks.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM career_target_requirements r JOIN sub_competencies s ON s.id = r.competency_id
             WHERE s.merged_into IS NOT NULL) THEN
    RAISE EXCEPTION '0057: a merged-away competency still has requirements';
  END IF;
  IF (SELECT count(*) FROM career_target_requirements) <> 35 THEN
    RAISE EXCEPTION '0057: expected 35 requirement rows, found %', (SELECT count(*) FROM career_target_requirements);
  END IF;
  IF (SELECT count(*) FROM sub_competency_map) <> (SELECT count(*) FROM sub_competencies) THEN
    RAISE EXCEPTION '0057: sub_competency_map does not cover every competency';
  END IF;
  IF EXISTS (
    SELECT g.survivor, c.snapshot_id FROM merge_group g JOIN snapshot_competency_coverage c ON c.competency_id = g.member
    EXCEPT SELECT competency_id, snapshot_id FROM snapshot_competency_coverage
           WHERE competency_id IN ('domain-knowledge','project-management')) THEN
    RAISE EXCEPTION '0057: a snapshot lost its survivor cell';
  END IF;
  IF EXISTS (SELECT 1 FROM course_intended_coverage i JOIN merge_plan m ON m.old_id = i.sub_competency_id)
     OR EXISTS (SELECT 1 FROM prerequisite_edges e JOIN merge_plan m ON m.old_id = e.sub_competency_id)
     OR EXISTS (SELECT 1 FROM faculty_flags f JOIN merge_plan m ON m.old_id = f.sub_competency_id) THEN
    RAISE EXCEPTION '0057: a reference still points at a merged-away competency';
  END IF;
END $$;

COMMIT;
```

The implementer verifies two details before running this:
- **The `faculty_flags` insert.** Check the enum casts against the live column types. `target_kind` is the `flag_target_kind` enum; add `::flag_target_kind` if Postgres requires it.
- **The re-point UPDATE.** Check that every `faculty_flags` re-point row type-checks. The `UPDATE` of `prerequisite_edges` after the de-duplicating `DELETE` cannot violate `uq_prerequisite_edges_focal_prereq_subcomp`, because at most one group edge per (focal, prereq) is left.

- [ ] **Step 4:** Write `2026-10-12-p0b-verify.sql`. It produces readable `-At` rows and ends in a `DO` block that raises on any failure, so it fails closed (P0a review M-a). It checks:
  - requirements = 35;
  - no requirement row on a retired-merged competency;
  - map count = catalog count;
  - every non-retired snapshot with a pre-merge group cell has a survivor cell (via `p0b_premerge_survivor_coverage` ∪ the merged-away history cells);
  - the dropped objects are absent;
  - `target_coverage` row count = Σ over requirement memberships of cells;
  - open P0b flags exist only for survivors.
- [ ] **Step 5:** Run the test. Expect PASS. Red-proof by temporarily changing the carry rule's first ORDER BY term to `c.d_depth ASC`; test 2 must fail. Restore it.
- [ ] **Step 6:** Commit `feat(db): migration 0057 — competency merges, P0a scaffolding drop`, with STATE.md: Schema (0057, not yet applied) and Deferred/debt (Rulings 5 and 11).

### Task 3: Schema + catalog code without the mirrors

**Files:** `lib/db/schema.ts`, `lib/db/competency-catalog-queries.ts`, `app/api/targets/[id]/sub-competencies/{route.ts,[scId]/retire/route.ts}`, `scripts/seed-career-targets.ts`, `tests/db/p0a-guards.test.ts` (extend), `tests/api/targets.test.ts`.

**Interfaces — produces:**
- `subCompetencies` with no `deprecatedCareerTargetId` or `deprecatedDisplayOrder`, plus `mergedInto: text('merged_into')`;
- `subCompetencyMap` and `p0bPremergeSurvivorCoverage` tables in Drizzle;
- `retireCompetencyFromTarget(tx, careerTargetId, competencyId): Promise<'retired' | 'removed-from-target'>`.

- [ ] **Step 1: Failing tests.**
  - Extend the guard test: no file outside `drizzle/` and `scripts/migrations/` references `deprecatedCareerTargetId`, `deprecatedDisplayOrder`, `snapshotTargetCoverage` or `coverageScores`.
  - Add a scratch-gated test, run after 0057 is applied: `retireCompetencyFromTarget(tx, 'account-management', 'domain-knowledge')` deletes only account-management's requirement rows for it, returns `'removed-from-target'`, and leaves `retired = false`.
  - On a competency used by one target, it sets `retired = true` and returns `'retired'`.
- [ ] **Step 2:** Run them. Expect FAIL.
- [ ] **Step 3: Implement:**
  - Remove the two deprecated fields from `subCompetencies` and add `mergedInto`. Add the two tables. Delete the `snapshotTargetCoverage` and `coverageScores` Drizzle tables.
  - Remove the mirror writes from `insertCompetencyForTarget`, `setCompetencyOrderInTarget` and the seed script.
  - Remove `catalogBatchWriter`'s "exactly one target" reorder guard. Order now lives only on requirements.
  - Add `retireCompetencyFromTarget` and use it in the retire route.
  - Every Drizzle insert into `sub_competencies` must stop setting the dropped columns.
- [ ] **Step 4:** Apply 0057 to the P0b scratch database. This is the only way to get a post-0057 scratch state; the migration test only runs it inside a rolled-back transaction. Command: `psql "$(scripts/migrations/p0b-scratch-db.sh url)" -X -v ON_ERROR_STOP=1 -f drizzle/0057_competency_catalog_p0b.sql`, then run the verify script. From here on, scratch stays at post-0057, and re-running the migration test needs the re-baseline procedure (Step 5).
- [ ] **Step 5:** Add a `restore-pre` subcommand to `p0b-scratch-db.sh`. It drops and re-clones the scratch database, then re-applies 0057 only if `--post` is passed. Document it at the top of the script. Tests that need the pre-0057 state (Task 2's) run against a fresh `restore-pre` clone.
- [ ] **Step 6:** Run `tsc --noEmit`, the touched tests and the guard. Expect PASS. Commit `refactor(db): drop deprecated catalog mirrors; shared-aware retire`.

### Task 4: Catalog-aware definitions and target-batch planner

**Files:** `lib/domain/types.ts`, `lib/domain/seed-targets.ts`, `lib/domain/target-batch.ts`, `lib/db/competency-catalog-queries.ts` (`readCatalogState`, `catalogBatchWriter`), `scripts/targets/apply-target-batch.ts`, `scripts/seed-career-targets.ts`, `lib/domain/__tests__/target-batch.test.ts`.

**Interfaces — produces:**

```ts
// lib/domain/types.ts
export type TargetCompetencyEntry = SubCompetency | { ref: string };
// CareerTarget.subCompetencies: TargetCompetencyEntry[]
// RetiredSubCompetency gains: mergedInto?: string

// lib/domain/target-batch.ts
export interface DbSubRow { id: string; name: string; knowDescriptor: string; understandDescriptor: string; doDescriptor: string; retired: boolean; mergedInto: string | null; }
export interface DbMembershipRow { careerTargetId: string; competencyId: string; displayOrder: number; }
export function planTargetBatch(desired: CareerTarget[], retired: RetiredSubCompetency[], dbTargets: DbTargetRow[], dbSubs: DbSubRow[], dbMemberships: DbMembershipRow[]): BatchPlan;
// TargetPlan gains: membershipInserts: { competencyId: string; displayOrder: number }[]; orderUpdates: { competencyId: string; from: number; to: number }[]; membershipRemovals: string[]
```

**Rules (each needs a unit test):**
1. **One definition per id.** A competency id has exactly one full definition across all targets; every other target uses `{ ref }`. Two definitions → error `competency <id> is defined more than once`. A `ref` with no definition → error `ref <id> has no definition`.
2. **Catalog fields are diffed once per definition**, not per target. A changed descriptor shows up as one update.
3. **Memberships:** for each target, the desired members, in list order 0..n-1, are compared with `dbMemberships`. The result is inserts, order updates, and `membershipRemovals`. A removal is a current member that is not desired for this target and is not listed as retired. It is reported only, never applied automatically, like today's `unmanaged`.
4. **Retired entries:** `retired` sets `retired = true` and `merged_into`. An entry listed as retired that is still desired anywhere → error.
5. **The P0a M-5 hazard can't recur.** Membership is explicit, so a definition placed under a different target never silently adds a second membership. A moved definition shows up as a membership insert plus a removal in the plan output.

- [ ] **Step 1: Write the failing unit tests**, one per rule.
- [ ] **Step 2:** Run them. Expect FAIL.
- [ ] **Step 3: Implement the planner and writer.** Then update `seed-targets.ts`:
  - `domain-knowledge` and `project-management` get the merged text from Task 2, Step 3, defined under `production-operations`.
  - `account-management` lists `{ ref: 'domain-knowledge' }` where `gc-production-literacy` was.
  - `ai-workflow` lists `{ ref: 'domain-knowledge' }` where `domain-grounding` was.
  - `timeline-management` is removed from `production-operations`.
  - The three merged-away items go into `RETIRED_SUB_COMPETENCIES` with `retiredOn: '2026-10-12'`, `mergedInto`, and a reason quoting the owner decision.

  Update the seed script for an empty DB: it inserts each definition once, then the memberships.
- [ ] **Step 4:** Run `apply-target-batch.ts --dry-run` against the post-0057 scratch database, with `DATABASE_URL` explicitly the scratch URL. It must report **zero changes and zero errors**. This proves the constants and the migration agree.
- [ ] **Step 5:** Commit `feat(targets): catalog-aware definitions and batch planner (shared competencies)`.

### Task 5: Per-competency scoring

**Files:** `lib/ai/analyze/program-score-coverage.ts`, `lib/ai/prompts/program-score-coverage.md`, `lib/db/program-coverage-queries.ts` (`listStalePairs` → `listStaleSnapshots`), both refresh routes and their tests, `tests/db/p0b-scoring.test.ts`.

**Interfaces — produces:**

```ts
export interface ScoreCompetenciesInput {
  snapshotId: string; courseCode: string; snapshotProfile: CaptureProfile;
  competencies: Array<{ id: string; name: string; knowDescriptor: string; understandDescriptor: string; doDescriptor: string }>;
  modelOverride?: string; reasoningEffortOverride?: string;
}
export async function scoreSnapshotCompetencies(input: ScoreCompetenciesInput): Promise<{ result: { snapshot_id: string; generated_at: string; cells: CompetencyCoverageCell[] }; model: string; costUsdCents: number }>;
// CompetencyCoverageCell: { competency_id, matched_competency, k_depth, u_depth, d_depth, evidence_excerpt, confidence, rationale }
export async function listStaleSnapshots(): Promise<Array<{ snapshotId: string; courseCode: string; missingCompetencyIds: string[] }>>;
```

- [ ] **Step 1: Failing tests:**
  - **The prompt carries no target context.** With the provider mocked, the captured user message contains the competencies' descriptors and contains none of the five career-target names or `career_target_id`.
  - **Strict schema.** Every `properties` key is listed in `required`, checked recursively. Use the pattern in `lib/ai/agent/audit-response-schema.ts`.
  - **Unknown ids are dropped.** Cells for competency ids that were not in the input are dropped. This replaces P0a Ruling 10's member filter.
  - **Stale detection.** `listStaleSnapshots`, run against scratch after 0057 inside a rolled-back transaction: deleting one survivor cell for one latest snapshot makes that snapshot stale with exactly that id missing.
  - **Bulk route.** With the scorer mocked, one call per stale snapshot, carrying only the missing ids.
  - **Per-pair route.** It scores exactly that target's active members.
- [ ] **Step 2:** Run them. Expect FAIL.
- [ ] **Step 3: Implement:**
  - Rewrite the prompt for a list of competencies, keeping the depth-scale include and the evidence rules. Every listed competency gets a row, and a 0 needs a rationale.
  - Use schema name `program_coverage_v2`.
  - Bulk route: one call per stale snapshot.
  - Per-pair route: same URL, scores that target's active members.
  - Both routes upsert by (snapshot, competency).
  - The daily-cap and spend accounting stays as it is today.
- [ ] **Step 4:** Run the tests, `tsc` and eslint on the changed files. Expect PASS.
- [ ] **Step 5:** Commit `feat(scoring): score coverage per competency without target context`, with STATE.md: the AI function `program-score-coverage` prompt and schema v2.

### Task 6: Wiki: skip retired competencies, stub merged pages

**Files:** `lib/ai/wiki/update.ts`, `lib/ai/wiki/refresh-all.ts`, and the module that writes competency page files (find it from `updateWikiForSnapshot`'s competency branch), plus tests.

- [ ] **Step 1: Failing tests:**
  - Regeneration for a snapshot with cells on `gc-production-literacy` (retired, merged) does not call the LLM for that competency.
  - `refresh-all` excludes retired competencies from its competency list.
  - A function `writeMergedStub(oldId, survivorId, survivorName)` produces a page whose body names and links the survivor, and makes no LLM call.
- [ ] **Step 2:** Run them. Expect FAIL.
- [ ] **Step 3:** Implement. Run the stub writer for the three merged-away ids as part of the Task 7 script, not at import time.
- [ ] **Step 4:** Run them. Expect PASS. Commit `feat(wiki): skip retired competencies; merged-into stubs`.

### Task 7: Owner-gated re-score script

**Files:** `scripts/migrations/2026-10-12-p0b-rescore.ts` and `tests/db/p0b-rescore.test.ts`.

**Behavior:**
- **Arguments:** `--dry-run` (default) or `--apply`, plus `--expect-db <name>`, which is required. The script refuses unless `current_database()` equals it.
- **Scope:** finds every non-retired latest snapshot (the `listStaleSnapshots` latest-snapshot rule) that has a cell on any group member, using the merged-away history cells and the premerge table.
- **Scoring:** for each such snapshot, calls `scoreSnapshotCompetencies` with exactly `[domain-knowledge, project-management]` and upserts the two survivor cells. It checks the daily cap before each call and stops cleanly if the cap trips.
- **Wiki stubs:** writes the merged-away wiki stubs (Task 6) and fires one `regenerateWikiInBackground` per re-scored snapshot.
- **Output:** a table of old (carried) versus new K/U/D per (course, survivor), plus totals and cost. It never prints the URL.
- **Flags:** no flag is created or closed. The flags from 0057 stay open for faculty, and their `flagged_context` shows the drift.

- [ ] **Step 1: Failing test** (scratch, scorer mocked):
  - `--dry-run` writes nothing.
  - `--apply` upserts exactly 2 cells per in-scope snapshot.
  - A wrong `--expect-db` exits non-zero before any read.
- [ ] **Step 2:** Run it. Expect FAIL. Then implement it and run again. Expect PASS.
- [ ] **Step 3: Real run on scratch,** with `--apply --expect-db gc_curriculum_p0b_scratch`. This makes real paid calls, a small number: roughly one per in-scope snapshot, with two competencies each. Record the cost and the old/new table in the report.
- [ ] **Step 4:** Commit `feat(p0b): owner-gated survivor re-score script`.

### Task 8: Live-apply runbook for P0b

**Files:** `scripts/migrations/p0b-apply-db.sh`, `scripts/migrations/2026-10-12-p0b-live-apply.sh` and `tests/scripts/p0b-live-apply-wrapper.test.ts`.

- [ ] **Step 1:** Derive both scripts from the P0a pair, keeping every guard:
  - the DB-name guard and the other-sessions guard;
  - the verified `-Fc` backup with TABLE DATA;
  - the URL never on any argv;
  - the state-aware EXIT trap;
  - the SHA ↔ migration consistency check;
  - fail-closed verify.

  Differences from P0a:
  - The migration is 0057 and the verify script is P0b's.
  - Apply-mode precondition: the target SHA contains `drizzle/0057_competency_catalog_p0b.sql`.
  - **After `launchctl bootstrap`, run `launchctl kickstart`** for both jobs. This is the 2026-10-11 bootstrap-without-spawn finding.
  - **Rollback mode = restore.** `pg_restore --clean --if-exists --no-owner -d <live>` from a dump path given as an argument. The dump must pass the same verifier and its name must match `pre-apply-*.dump`. Same stop/start discipline, and the deploy SHA must NOT contain 0057.
- [ ] **Step 2:** Write the stubbed wrapper tests, ported from `tests/scripts/p0a-live-apply-wrapper.test.ts`, plus a test that kickstart is called after bootstrap, and a rollback-restore test against stubs. Each test is red-proofed.
- [ ] **Step 3:** Commit `feat(db): P0b live-apply runbook`.

### Task 9: Final verification + STATE

- [ ] **Step 1: Characterization.** Run the P0a probes against post-0057 scratch, after Task 7's scratch re-score, and compare them to `golden-pre.json`:
  - Every probe output restricted to `brand-strategy` and `creative-generalist` must be identical.
  - For the other three targets, every competency other than the five merge ids must be identical, except the expected order and membership changes listed in Ruling 6.
  - Write the comparison as a test with an explicit allow-list of expected differences, so any unexpected difference fails.
- [ ] **Step 2:** Run the full suite, `tsc`, eslint on changed files, and `next build` with `DATABASE_URL` set to the scratch URL. Poll `pg_stat_activity` during the build to confirm 0 connections to live.
- [ ] **Step 3: STATE.md.** Record:
  - what is live versus pending;
  - Schema (0057);
  - the AI function prompt v2;
  - the visible change (no target context in scoring);
  - Deferred/debt: Rulings 5 and 11, the P0a-worktree cleanup (still pending), and the `career_target_demand` drop in P1.

  Commit.

### Task 10: Adversarial review

- [ ] A fresh-context reviewer runs on the most capable model with a verify-by-running mandate, using scratch only. Iterate until an honest ACCEPT. It must attack:
  - the carry rule and flag generation, against hand-computed expectations;
  - the precondition and re-run refusals;
  - re-point conflicts (intended coverage and edges);
  - the runbook's restore-rollback;
  - the planner's shared-competency rules;
  - the scorer's strict schema;
  - wiki stub idempotence.

  Fixes go through an implementer with red-proofed tests. Then run the whole-branch final review.

### Task 11: STOP: ask owner. Merge, live apply, live re-score

- [ ] **STOP.** Present to the owner: the merge, then `2026-10-12-p0b-live-apply.sh <sha> apply <previous_sha>`, then the smoke test, then `2026-10-12-p0b-rescore.ts --dry-run --expect-db gc_curriculum` (show its plan and estimated cost), then `--apply`. Each step needs its own explicit go-ahead.
- [ ] After the steps: smoke-test `/program`, the flags panel (the P0b flags are visible), wiki target and competency pages (including a merged stub), and Explore. Update STATE.md to "P0b applied to production". Push main with the guarded chain.
