# Competency Catalog P0a (structure only, no behavior change) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `sub_competencies` the shared competency catalog. Record target membership in a new `career_target_requirements` table and keep coverage in a new `snapshot_competency_coverage` table keyed by (snapshot, competency). Every faculty-visible view must return exactly what it returns today.

**Architecture:** Expand, then contract. Migration 0056 (hand-written SQL, one transaction) drops ownership (`NOT NULL`) from `sub_competencies.career_target_id`. It adds the two tables, seeds one requirement per existing (target, sub-competency) pair, and copies all 764 coverage rows unchanged. It also adds two read-only views, `target_sub_competencies` and `target_coverage`, that rebuild today's per-target shapes by joining through `career_target_requirements`. Readers switch from the old tables to the views (per-target questions) or to the new table (per-competency questions). Writers first dual-write, then stop writing `snapshot_target_coverage`, which stays as a read-only backup. Scoring stays per target with target context; only its write path changes.

**Tech Stack:** Next.js 15 (App Router), TypeScript strict, Drizzle ORM 0.45.2 (`pgTable`, `pgView(...).existing()`), Postgres 17 (Postgres.app, `127.0.0.1:5433`), Vitest 3 (jsdom default; DB tests use `// @vitest-environment node`), pnpm.

**Spec:** [`docs/superpowers/specs/2026-10-11-competency-catalog-and-career-demand-design.md`](../specs/2026-10-11-competency-catalog-and-career-demand-design.md). This plan implements §8 **P0a** only. §3 (data model), §4 steps 2–5 (no merges) and §9 (migration tests, adversarial review) apply.

## Global Constraints

- **US spelling** in code, comments, docs and ids (color, not colour).
- **Never print credentials.** Get `DATABASE_URL` only from the app's own env loader: `node ~/.claude/dashboard/read-env.mjs /Users/admin/projects/curriculum_developer DATABASE_URL`. Use it only inside `$(...)` command substitution and never echo it. Never hand-parse `.env.local`.
- **DB access only through the app's env (read-env).** Development and tests run against the **scratch clone** `gc_curriculum_p0a_scratch` on the same Postgres server (Task 1). Never run a test, script or migration against the live `gc_curriculum` database. Never run `tsx --env-file=.env.local` anything in this plan. Every new DB test refuses to run unless `DATABASE_URL` names the scratch database.
- **Live apply is owner-gated.** Applying 0056 or the rollback to the live DB is Task 10 and starts with **STOP: ask owner**. Never apply it automatically.
- **Deploying is a separate owner-approved step.** It is not part of this plan.
- **Build agents work in their own git worktree:** `/Users/admin/projects/curriculum_developer-wt-catalog` on branch `feat/competency-catalog-p0a` (created in Task 1). Never edit, stage or commit in the main checkout (`/Users/admin/projects/curriculum_developer`) or the deploy checkout (`/Users/admin/projects/curriculum_developer-deploy`).
- **Never kill processes by pattern** (`pkill`/`killall`). Stop only PIDs you started.
- **Adversarial review is required before merge** (CLAUDE.md rule 9). The migration rewrites persistent data, so Task 9 must reach an honest ACCEPT before any merge.
- **STATE.md is updated in the same commit** as every schema change (Tasks 2 and 7) and finalized in Task 8. Decisions not to do something (deferrals) go in **Deferred / debt**.
- **Red-proof every regression test.** Show it failing before the change it guards.
- **Commit messages** end with the attribution lines your session's system reminder specifies.
- **Progress dashboard:** this task has more than 5 steps. Keep `<worktree>/.dashboard/state.json` updated per `~/.claude/CLAUDE.md` ("Progress dashboard"). `.dashboard/` is gitignored.
- **Shell state does not persist between commands.** Every command below is self-contained: it `cd`s into the worktree and re-derives paths.
- Postgres client binaries: `/Applications/Postgres.app/Contents/Versions/17/bin/{psql,pg_dump}` (`psql` is not on `PATH`).

## Rulings (decisions this plan makes, each with its reason)

1. **`sub_competencies.career_target_id` stays during P0a as a nullable, deprecated mirror.** It is still written (create, target batch, seed), never read. *Why:* it keeps the rollback script exact (it can restore `NOT NULL` and rebuild the old coverage table from it). It costs nothing, and from Task 7 a Drizzle rename (`deprecatedCareerTargetId`) makes the compiler prove nothing reads it. It is removed in P0b, when merges make it meaningless.
2. **Display order lives on `career_target_requirements.display_order` (per target).** `sub_competencies.display_order` is kept as a deprecated mirror (`deprecatedDisplayOrder` from Task 7), written alongside and never read. *Why:* order is a property of a competency's place in a target. After P0b a competency can sit in several targets at different positions.
3. **Requirements are seeded for retired sub-competencies too (36 rows, not 34).** *Why:* 12 of the 764 coverage rows sit on the two retired ids. Today those rows keep their target through `career_target_id`, and keeping membership preserves that attribution and the target batch's un-retire path. `retired` stays a catalog attribute on `sub_competencies`, and every reader filters it exactly as today.
4. **Membership = any requirement row for (target, competency).** The view `target_sub_competencies` groups requirements by (target, competency) and takes `min(display_order)`. Uniqueness is `(career_target_id, competency_id, horizon, weight_source)`. The spec's "source" is read as `weight_source`. *Why:* the spec puts one row per source so sources can disagree visibly. P0a writes exactly one row per pair.
5. **Readers move to two views instead of hand-written joins.** `target_coverage` has exactly the old `snapshot_target_coverage` columns; `target_sub_competencies` has the old `sub_competencies` columns. *Why:* each reader change becomes a one-identifier swap, which keeps characterization equality easy to reason about. The join through requirements lives in one place, and the views stay correct after P0b (a merged competency appears once per target that uses it).
6. **Per-competency readers read the table, per-target readers read the view.** Wiki competency substrate, competency links, Explore run-impact and the prereq gap engine ask about a competency → `snapshot_competency_coverage`. Matrix, scaffolding, stale pairs, wiki target pages and affected-page lists ask per target → `target_coverage`.
7. **`snapshot_target_coverage` is kept as a read-only backup** (no writes after Task 7, no reads after Task 4). It is dropped in **P0b**, after the live migration is verified and P0b's merges are approved. It is not dropped in P0a.
8. **`career_target_demand` and `coverage_scores` are left as they are (0 rows each).** *Why:* `career_target_demand` is still read and written behind `DEMAND_COVERAGE_SEAM` (`lib/program/sufficiency-read.ts`, `lib/ai/position-capture/demand-rollup.ts`). Leaving it keeps that flagged path identical. `coverage_scores` has no code readers, so dropping it buys nothing in a no-behavior-change phase and widens the destructive surface. Both drops are deferred: `career_target_demand` to P1, where requirements replace it, and `coverage_scores` to P0b cleanup. This departs from spec §3 ("dropped") and is recorded in Deferred / debt.
9. **Descriptor edits invalidate a competency's cells for every target.** `invalidateCoverageForSubCompetency(careerTargetId, subId)` keeps its signature and deletes by competency. *Why:* a competency's cells are shared. With one target per competency in P0a this is the same rows as today.
10. **The coverage-refresh routes drop AI-returned cells for competencies that are not members of the scored target.** *Why:* the scorer does not validate `sub_competency_id`. Today an off-target id would land in an invisible cross-target row. With per-competency storage it would overwrite another target's visible cell. Dropping it keeps the visible behavior identical.
11. **One-off scripts (`scripts/_one-off/*`) are out of scope.** They are excluded from `tsconfig.json` (`exclude: ["scripts/_one-off"]`), so they cannot break typecheck or `next build`. Four of them (`_check-study-inputs.ts`, `adjudication-cases.ts`, `reliability-study.ts`, `reliability-study-part2b.ts`) read `subCompetencies.careerTargetId` and stop working at runtime after the Task 7 rename. `check-pf-coverage.ts` reads the backup table, so its numbers go stale. Recorded in Deferred / debt.
12. **Migration safety model: apply with the app stopped, immediately before the deploy.** Re-running 0056 is a no-op while the new table still equals the backup. Once the new code has written coverage, the migration detects the divergence and refuses (changes nothing), so it can never copy stale backup rows over newer cells. The rollback treats `snapshot_competency_coverage` as authoritative and rebuilds the old table from it.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `drizzle/0056_competency_catalog_p0a.sql` | The migration: one transaction with preconditions, divergence guard, DDL, seed, copy, views and post-checks. Idempotent before cutover. |
| `scripts/migrations/2026-10-11-p0a-verify.sql` | Read-only verification report (counts and set differences), run after apply. |
| `scripts/migrations/2026-10-11-p0a-rollback.sql` | Rollback: rebuild `snapshot_target_coverage` from the new table, restore `NOT NULL`, drop P0a objects. |
| `scripts/migrations/p0a-scratch-db.sh` | `create` / `url` / `drop` for the scratch clone `gc_curriculum_p0a_scratch`. Never prints credentials except to a `$(...)` caller. |
| `scripts/migrations/2026-10-11-p0a-scratch-fixture.sql` | Scratch-only fixture: a few confirmed prerequisite edges, so the prereq gap engine's measured path is exercised by characterization. |
| `lib/db/competency-catalog-queries.ts` | Catalog and membership writes plus target-batch state: `getTargetCompetency`, `nextDisplayOrderForTarget`, `insertCompetencyForTarget`, `setCompetencyOrderInTarget`, `targetIdsForCompetency`, `readCatalogState`, `catalogBatchWriter`. |
| `tests/db/p0a/scratch-guard.ts` | `isScratchDb()`: true only when `DATABASE_URL` names the scratch DB. |
| `tests/db/p0a/probes.ts` | Characterization probes: canonical outputs of every re-pointed read path. |
| `tests/db/p0a/fixtures.ts` | Fixture competency add/remove for write tests (never touches cloned rows). |
| `tests/db/p0a-characterization.test.ts` | Golden capture/compare (scratch only, `P0A_GOLDEN` set). |
| `tests/db/p0a-migration.test.ts` | Apply → idempotent re-run → divergence refusal → rollback → re-apply (scratch only, `P0A_MIGRATION_TEST=1`). |
| `tests/db/p0a-coverage-writes.test.ts` | Upsert, invalidate and course reset write the new table (scratch only). |
| `tests/db/p0a-catalog-writes.test.ts` | Catalog and membership writers, target-batch state (scratch only, rolled-back transactions). |
| `tests/db/p0a-guards.test.ts` | Static guards (git grep): nothing reads `snapshotTargetCoverage` or `subCompetencies.careerTargetId`. |

**Modified**

| File | Change |
|---|---|
| `lib/db/schema.ts` | Add `careerTargetRequirements`, `snapshotCompetencyCoverage`, views `targetSubCompetencies` and `targetCoverage` (Task 2). Rename `subCompetencies.careerTargetId` → `deprecatedCareerTargetId` (nullable) and `displayOrder` → `deprecatedDisplayOrder`. Mark `snapshotTargetCoverage` as a read-only backup (Task 7). |
| `lib/db/program-coverage-queries.ts` | Upsert and invalidate write `snapshot_competency_coverage` (Task 3, dual-write until Task 7). Cell reads from `targetCoverage` (Task 4). Matrix sub-competencies from `targetSubCompetencies` (Task 5). |
| `lib/capture/run-course-reset.ts` | Snapshot reset deletes from `snapshot_competency_coverage` (Task 3; old-table delete removed in Task 7). |
| `lib/db/scaffolding-queries.ts` | Cells from `targetCoverage` (Task 4), subs from `targetSubCompetencies` (Task 5). |
| `lib/program/prereq-gaps.ts` | Existence check on the catalog plus coverage from `snapshotCompetencyCoverage` (Task 4). |
| `lib/ai/wiki/update.ts` | `export` three loaders (Task 1). Coverage reads → view/table (Task 4). Target subs → view (Task 5). |
| `lib/ai/wiki/refresh-all.ts` | `loadRefreshInputs` cells from `targetCoverage` (Task 4). |
| `lib/ai/explore/run-impact.ts` | `export` two helpers (Task 1). Coverage from `snapshotCompetencyCoverage` (Task 4). |
| `lib/ai/explore/ripple.ts` | Comment only: names the new table (Task 4). |
| `lib/db/career-targets-queries.ts` | `listTargets` membership from `targetSubCompetencies` (Task 5). |
| `lib/wiki/course-views.ts` | `loadCourseViews` and `loadTargetMap` join `targetSubCompetencies` (Task 5). |
| `app/api/program/coverage/refresh/route.ts` | Target subs from the view, plus the off-target cell filter (Task 5). |
| `app/api/program/coverage/refresh/[snapshotId]/[targetId]/route.ts` | Same (Task 5). |
| `scripts/reliability/check.ts`, `scripts/reliability/model-eval.ts` | Target subs from the view (Task 5). |
| `app/api/targets/[id]/sub-competencies/route.ts` | Create via `insertCompetencyForTarget` in a transaction; respond with the membership row (Task 6). |
| `app/api/targets/[id]/sub-competencies/reorder/route.ts` | Reorder via `setCompetencyOrderInTarget` (Task 6). |
| `app/api/targets/[id]/sub-competencies/[scId]/route.ts` | Membership check via the view, catalog update by id, respond with the membership row (Task 6). |
| `app/api/targets/[id]/sub-competencies/[scId]/retire/route.ts` | Membership check via the view, retire by id (Task 6). |
| `scripts/targets/apply-target-batch.ts` | Uses `readCatalogState` and `catalogBatchWriter` (Task 6). |
| `scripts/seed-career-targets.ts` | Also inserts the requirement row (Task 6). |
| `lib/db/__tests__/program-coverage-queries.test.ts` | Mocked schema and table keys follow the new names (Tasks 3, 4, 5, 7). |
| `lib/db/__tests__/scaffolding-queries.test.ts` | Table keys follow the new names (Tasks 4, 5). |
| `tests/api/targets.test.ts` | Mocks `@/lib/db/competency-catalog-queries` plus `db.transaction` (Task 6). |
| `docs/STATE.md` | Schema entry plus Deferred / debt (Tasks 2, 7, 8). |

**Unchanged on purpose:** `prerequisite_edges`, `course_intended_coverage`, `faculty_flags` (ids kept); `lib/ai/analyze/program-score-coverage.ts` (scoring stays per target, with target context); `lib/domain/target-batch.ts` (pure planner); `lib/program/sufficiency*.ts` and `career_target_demand` code (Ruling 8); every file that gets sub-competencies through `listTargets`/`getTargetById`/`getMatrixData` (Explore career-fit/compare/scenario/ripple, wiki graph tools, flags, position capture, synthesis, prereq-edge and intended-skills admin routes, `app/courses/[code]/page.tsx`). Those follow automatically and are covered by characterization.

---

### Task 1: Worktree, scratch clone and characterization golden

**Files:**
- Create: `scripts/migrations/p0a-scratch-db.sh`, `scripts/migrations/2026-10-11-p0a-scratch-fixture.sql`, `tests/db/p0a/scratch-guard.ts`, `tests/db/p0a/probes.ts`, `tests/db/p0a-characterization.test.ts`
- Modify: `lib/ai/wiki/update.ts:320,386,625` (add `export` to `loadCompetencySubstrate`, `loadTargetSubstrate`, `loadCompetencyLinksForSnapshot`), `lib/ai/explore/run-impact.ts:153,211` (add `export` to `resolveSubCompetencyDepths`, `buildBaselineDelivered`)

**Interfaces:**
- Consumes: today's read functions (unchanged).
- Produces: `isScratchDb(): boolean`, `SCRATCH_DB = 'gc_curriculum_p0a_scratch'` (from `tests/db/p0a/scratch-guard.ts`); `collectProbes(): Promise<Record<string, unknown>>` and `canon(v: unknown): unknown` (from `tests/db/p0a/probes.ts`); the golden file at `$HOME/.local/share/gc-curriculum-tool/p0a/golden.json` (not committed); `scripts/migrations/p0a-scratch-db.sh {create|url|drop}`. Record this task's commit SHA as **`P0A_HARNESS_SHA`** in `.dashboard/state.json`. Task 8 re-captures the golden from it.

- [ ] **Step 1: Create the worktree** (from the main checkout, without changing it)

```bash
git -C /Users/admin/projects/curriculum_developer worktree add /Users/admin/projects/curriculum_developer-wt-catalog -b feat/competency-catalog-p0a dev
ln -s /Users/admin/projects/curriculum_developer/.env.local /Users/admin/projects/curriculum_developer-wt-catalog/.env.local
cd /Users/admin/projects/curriculum_developer-wt-catalog && pnpm install --frozen-lockfile
```

Expected: worktree on `feat/competency-catalog-p0a`, install completes. (`.env.local` is linked only so `next build` behaves as in the main checkout. No command in this plan uses it for DB access.)

- [ ] **Step 2: Write the scratch-clone script**

`scripts/migrations/p0a-scratch-db.sh`:

```bash
#!/usr/bin/env bash
# P0a scratch database: a throwaway clone of the live DB on the same Postgres
# server, for migration rehearsal and characterization tests. The live DB is
# only READ (pg_dump). The URL is printed only by `url`, for use inside $(...);
# never run `url` bare.
#   create  drop + recreate gc_curriculum_p0a_scratch from a pg_dump of live
#   url     print the scratch DATABASE_URL (same credentials, scratch db name)
#   drop    drop the scratch database
set -euo pipefail
APP=/Users/admin/projects/curriculum_developer
PGBIN=/Applications/Postgres.app/Contents/Versions/17/bin
SCRATCH=gc_curriculum_p0a_scratch

live_url() { node "$HOME/.claude/dashboard/read-env.mjs" "$APP" DATABASE_URL; }
with_db() {
  node -e 'const u = new URL(process.argv[1]); u.pathname = "/" + process.argv[2]; process.stdout.write(u.toString());' "$1" "$2"
}

case "${1:-}" in
  create)
    LIVE="$(live_url)"
    "$PGBIN/psql" "$(with_db "$LIVE" postgres)" -X -q -v ON_ERROR_STOP=1 \
      -c "DROP DATABASE IF EXISTS $SCRATCH" -c "CREATE DATABASE $SCRATCH"
    "$PGBIN/pg_dump" --no-owner --no-privileges "$LIVE" \
      | "$PGBIN/psql" "$(with_db "$LIVE" "$SCRATCH")" -X -q -v ON_ERROR_STOP=1 >/dev/null
    echo "created $SCRATCH from a read-only dump of the live DB"
    ;;
  url)
    with_db "$(live_url)" "$SCRATCH"
    ;;
  drop)
    LIVE="$(live_url)"
    "$PGBIN/psql" "$(with_db "$LIVE" postgres)" -X -q -c "DROP DATABASE IF EXISTS $SCRATCH"
    echo "dropped $SCRATCH"
    ;;
  *)
    echo "usage: $0 create|url|drop" >&2
    exit 2
    ;;
esac
```

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && chmod +x scripts/migrations/p0a-scratch-db.sh && scripts/migrations/p0a-scratch-db.sh create
```

Expected: `created gc_curriculum_p0a_scratch from a read-only dump of the live DB` (live DB is 21 MB, about 10 s).

- [ ] **Step 3: Write and load the scratch fixture**

`scripts/migrations/2026-10-11-p0a-scratch-fixture.sql`:

```sql
-- P0a characterization fixture — SCRATCH DB ONLY. prerequisite_edges is empty
-- in production, so without this the gap engine's measured path (the one P0a
-- re-points) would never run in the characterization test. Idempotent.
DO $$ BEGIN
  IF current_database() <> 'gc_curriculum_p0a_scratch' THEN
    RAISE EXCEPTION 'scratch fixture refused: connected to %', current_database();
  END IF;
END $$;

WITH latest AS (
  SELECT DISTINCT ON (course_code) id, course_code
  FROM course_capture_snapshots
  WHERE retired_at IS NULL
  ORDER BY course_code, created_at DESC
), cov AS (
  SELECT l.course_code, c.sub_competency_id, s.retired,
         row_number() OVER (PARTITION BY s.retired ORDER BY l.course_code, c.sub_competency_id) AS rn
  FROM latest l
  JOIN snapshot_target_coverage c ON c.snapshot_id = l.id
  JOIN sub_competencies s ON s.id = c.sub_competency_id
), picked AS (
  SELECT course_code, sub_competency_id FROM cov
  WHERE (NOT retired AND rn <= 2) OR (retired AND rn = 1)
), focal AS (
  SELECT code FROM courses
  WHERE code NOT IN (SELECT course_code FROM picked)
    AND code IN (SELECT course_code FROM latest)
  ORDER BY code
  LIMIT 1
)
INSERT INTO prerequisite_edges
  (focal_course_code, prereq_course_code, sub_competency_id, expected_k, expected_u, expected_d,
   source, confidence, confirmed, rationale)
SELECT f.code, p.course_code, p.sub_competency_id, 2, 2, 3,
       'faculty', 'high', true, 'P0a characterization fixture (scratch DB only)'
FROM picked p CROSS JOIN focal f
ON CONFLICT ON CONSTRAINT uq_prerequisite_edges_focal_prereq_subcomp DO NOTHING;

SELECT count(*) AS fixture_edges FROM prerequisite_edges
WHERE rationale = 'P0a characterization fixture (scratch DB only)';
```

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && /Applications/Postgres.app/Contents/Versions/17/bin/psql "$(scripts/migrations/p0a-scratch-db.sh url)" -X -v ON_ERROR_STOP=1 -f scripts/migrations/2026-10-11-p0a-scratch-fixture.sql
```

Expected: `fixture_edges` = 2 or 3. It is 3 only if a latest snapshot has a cell on a retired id.

- [ ] **Step 4: Export the five private loaders** (add the keyword `export`, no other change)

In `lib/ai/wiki/update.ts`:
- `async function loadCompetencySubstrate(subCompetencyId: string)` → `export async function loadCompetencySubstrate(subCompetencyId: string)`
- `async function loadTargetSubstrate(targetId: string)` → `export async function loadTargetSubstrate(targetId: string)`
- `async function loadCompetencyLinksForSnapshot(` → `export async function loadCompetencyLinksForSnapshot(`

In `lib/ai/explore/run-impact.ts`:
- `async function resolveSubCompetencyDepths(` → `export async function resolveSubCompetencyDepths(`
- `async function buildBaselineDelivered(` → `export async function buildBaselineDelivered(`

- [ ] **Step 5: Write the scratch guard**

`tests/db/p0a/scratch-guard.ts`:

```ts
/** P0a DB tests run ONLY against the scratch clone (scripts/migrations/p0a-scratch-db.sh). */
export const SCRATCH_DB = 'gc_curriculum_p0a_scratch';

export function isScratchDb(): boolean {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname === `/${SCRATCH_DB}`;
  } catch {
    return false;
  }
}
```

- [ ] **Step 6: Write the probes**

`tests/db/p0a/probes.ts`:

```ts
/**
 * P0a characterization probes: the outputs of every read path P0a re-points,
 * in canonical JSON form. Captured with the pre-P0a code on a pre-migration
 * scratch clone (the golden), then compared with the P0a code on the migrated
 * clone. Arrays whose order the code defines (ORDER BY or an explicit sort) are
 * kept as returned. Arrays with no defined order (no ORDER BY) go through
 * sortJson, so the comparison does not depend on Postgres heap order.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { listTargets } from '@/lib/db/career-targets-queries';
import {
  getAllCells,
  getCellsForSnapshotTarget,
  getMatrixData,
  listStalePairs,
} from '@/lib/db/program-coverage-queries';
import { loadScaffoldingTarget } from '@/lib/db/scaffolding-queries';
import { computePrereqGaps } from '@/lib/program/prereq-gaps';
import { getTargetSufficiency } from '@/lib/program/sufficiency-read';
import { loadCourseViews, loadRetiredCompetencyIds, loadTargetMap } from '@/lib/wiki/course-views';
import { loadRefreshInputs } from '@/lib/ai/wiki/refresh-all';
import {
  computeAffectedPages,
  loadCompetencyLinksForSnapshot,
  loadCompetencySubstrate,
  loadTargetSubstrate,
} from '@/lib/ai/wiki/update';
import { getSnapshotById } from '@/lib/db/capture-snapshots-queries';
import { buildBaselineDelivered, resolveSubCompetencyDepths } from '@/lib/ai/explore/run-impact';

/** JSON-safe canonical form: Date → ISO string, Map → key-sorted entries, Set → sorted array, object keys sorted. */
export function canon(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Map) {
    return [...v.entries()]
      .map(([k, x]) => [canon(k), canon(x)] as const)
      .sort((a, b) => cmp(JSON.stringify(a[0]), JSON.stringify(b[0])));
  }
  if (v instanceof Set) return [...v].map(canon).sort((a, b) => cmp(JSON.stringify(a), JSON.stringify(b)));
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => cmp(a, b))
        .map(([k, x]) => [k, canon(x)]),
    );
  }
  return v;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sort an array whose order the code does not define. */
function sortJson<T>(xs: readonly T[]): T[] {
  return [...xs].sort((a, b) => cmp(JSON.stringify(canon(a)), JSON.stringify(canon(b))));
}

export async function collectProbes(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};

  const targets = await listTargets();
  out.listTargets = targets; // target and sub-competency order is part of the contract

  const matrix = await getMatrixData();
  out.getMatrixData = { ...matrix, cells: sortJson(matrix.cells) };

  out.listStalePairs = sortJson(await listStalePairs());

  const allCells = sortJson(await getAllCells());
  out.getAllCells = allCells;

  const perPair: Record<string, unknown> = {};
  for (const c of matrix.courses) {
    for (const t of targets) {
      perPair[`${c.snapshotId}|${t.id}`] = sortJson(await getCellsForSnapshotTarget(c.snapshotId, t.id));
    }
  }
  out.getCellsForSnapshotTarget = perPair;

  const scaffolding: Record<string, unknown> = {};
  const sufficiency: Record<string, unknown> = {};
  const targetSubstrate: Record<string, unknown> = {};
  for (const t of targets) {
    scaffolding[t.id] = await loadScaffoldingTarget(t.id);
    sufficiency[t.id] = sortJson(await getTargetSufficiency(t.id));
    const ts = await loadTargetSubstrate(t.id);
    targetSubstrate[t.id] = {
      ...ts,
      coverageRollup: sortJson(ts.coverageRollup),
      contributingCourses: [...ts.contributingCourses].sort(),
    };
  }
  out.loadScaffoldingTarget = scaffolding;
  out.getTargetSufficiency = sufficiency;
  out.loadTargetSubstrate = targetSubstrate;

  const focal = await db.execute(sql`SELECT DISTINCT focal_course_code AS code FROM prerequisite_edges ORDER BY 1`);
  const gapCodes = [...new Set([
    ...(focal.rows as Array<{ code: string }>).map(r => r.code),
    ...matrix.courses.slice(0, 3).map(c => c.courseCode),
  ])].sort();
  const gaps: Record<string, unknown> = {};
  for (const code of gapCodes) {
    const r = await computePrereqGaps(code);
    gaps[code] = { ...r, gaps: sortJson(r.gaps) };
  }
  out.computePrereqGaps = gaps;

  const intended = await db.execute(sql`SELECT DISTINCT course_code AS code FROM course_intended_coverage ORDER BY 1`);
  const viewCodes = [...new Set([
    ...matrix.courses.map(c => c.courseCode),
    ...(intended.rows as Array<{ code: string }>).map(r => r.code),
  ])].sort();
  const views: Record<string, unknown> = {};
  for (const code of viewCodes) views[code] = await loadCourseViews(code);
  out.loadCourseViews = views;
  out.loadTargetMap = await loadTargetMap();
  out.loadRetiredCompetencyIds = await loadRetiredCompetencyIds();

  const refresh = await loadRefreshInputs();
  out.loadRefreshInputs = {
    snapshots: sortJson(refresh.snapshots),
    competencySlugs: refresh.competencySlugs,
    targetSlugs: refresh.targetSlugs,
    hasProductiveFailure: refresh.hasProductiveFailure,
    latestProfileIds: [...refresh.latestProfiles.keys()].sort(),
    pagesPerSnapshot: sortJson(refresh.snapshots.map((s, i) => [s.id, refresh.oldPathPagesPerSnapshot[i]])),
  };

  const snapshotIds = [...new Set(allCells.map(c => c.snapshotId))].sort();
  const affected: Record<string, unknown> = {};
  const links: Record<string, unknown> = {};
  const baseline: Record<string, unknown> = {};
  const rippleDepths: Record<string, unknown> = {};
  for (const id of snapshotIds) {
    const snap = await getSnapshotById(id);
    if (!snap) continue;
    const pages = await computeAffectedPages(snap, null);
    affected[id] = pages.wiki.map(p => `${p.type}:${p.slug}`).sort();
    links[id] = sortJson(await loadCompetencyLinksForSnapshot(id));
    baseline[id] = sortJson(await buildBaselineDelivered(snap.courseCode, id));
    const statements = [...new Set(
      allCells.filter(c => c.snapshotId === id && c.matchedCompetency).map(c => c.matchedCompetency as string),
    )].sort();
    const deltas = statements.map(competency => ({
      competency,
      from: { k: null, u: null, d: 0 },
      to: { k: 1, u: 1, d: 1 },
      confidence: 'medium',
      rationale: 'p0a probe',
    })) as Parameters<typeof resolveSubCompetencyDepths>[1];
    rippleDepths[id] = sortJson(await resolveSubCompetencyDepths(id, deltas));
  }
  out.computeAffectedPages = affected;
  out.loadCompetencyLinksForSnapshot = links;
  out.buildBaselineDelivered = baseline;
  out.resolveSubCompetencyDepths = rippleDepths;

  const comps = await db.execute(sql`SELECT id FROM sub_competencies ORDER BY id`);
  const compSubstrate: Record<string, unknown> = {};
  for (const { id } of comps.rows as Array<{ id: string }>) {
    compSubstrate[id] = sortJson((await loadCompetencySubstrate(id)).contributingCells);
  }
  out.loadCompetencySubstrate = compSubstrate;

  return out;
}
```

- [ ] **Step 7: Write the characterization test**

`tests/db/p0a-characterization.test.ts`:

```ts
// @vitest-environment node
// P0a characterization (scratch DB only; run ALONE, never in the same vitest
// invocation as other DB tests). Capture: P0A_CAPTURE=1 writes the golden.
// Compare: every probe must deep-equal the golden.
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { canon, collectProbes } from './p0a/probes';
import { isScratchDb } from './p0a/scratch-guard';

const GOLDEN = process.env.P0A_GOLDEN;
const CAPTURE = process.env.P0A_CAPTURE === '1';

describe.skipIf(!isScratchDb() || !GOLDEN)('P0a characterization: re-pointed reads return what they returned before', () => {
  it(CAPTURE ? 'captures the golden' : 'matches the golden', async () => {
    const now = JSON.parse(JSON.stringify(canon(await collectProbes()))) as Record<string, unknown>;
    if (CAPTURE) {
      expect((now.getAllCells as unknown[]).length).toBeGreaterThan(0);
      mkdirSync(dirname(GOLDEN!), { recursive: true });
      writeFileSync(GOLDEN!, JSON.stringify(now));
      return;
    }
    const golden = JSON.parse(readFileSync(GOLDEN!, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(now).sort()).toEqual(Object.keys(golden).sort());
    for (const key of Object.keys(golden)) expect(now[key], key).toEqual(golden[key]);
  }, 300_000);
});
```

- [ ] **Step 8: Capture the golden** (pre-P0a code, pre-migration scratch)

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && DATABASE_URL="$(scripts/migrations/p0a-scratch-db.sh url)" P0A_GOLDEN="$HOME/.local/share/gc-curriculum-tool/p0a/golden.json" P0A_CAPTURE=1 pnpm exec vitest run tests/db/p0a-characterization.test.ts
```

Expected: `1 passed`, and the golden file exists (`ls -la ~/.local/share/gc-curriculum-tool/p0a/golden.json`, size above 100 KB). The golden holds course coverage text, so it stays outside the repo and is never committed.

- [ ] **Step 9: Compare run (should pass) and red-proof**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && DATABASE_URL="$(scripts/migrations/p0a-scratch-db.sh url)" P0A_GOLDEN="$HOME/.local/share/gc-curriculum-tool/p0a/golden.json" pnpm exec vitest run tests/db/p0a-characterization.test.ts
```
Expected: `1 passed`.

Red-proof: change one coverage cell on the scratch clone, re-run (must FAIL), then revert.

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && /Applications/Postgres.app/Contents/Versions/17/bin/psql "$(scripts/migrations/p0a-scratch-db.sh url)" -X -v ON_ERROR_STOP=1 -c "UPDATE snapshot_target_coverage SET d_depth = d_depth + 1 WHERE (snapshot_id, career_target_id, sub_competency_id) = (SELECT snapshot_id, career_target_id, sub_competency_id FROM snapshot_target_coverage ORDER BY 1,2,3 LIMIT 1)"
cd /Users/admin/projects/curriculum_developer-wt-catalog && DATABASE_URL="$(scripts/migrations/p0a-scratch-db.sh url)" P0A_GOLDEN="$HOME/.local/share/gc-curriculum-tool/p0a/golden.json" pnpm exec vitest run tests/db/p0a-characterization.test.ts
```
Expected: FAIL with an assertion labeled `getMatrixData` or `getAllCells` (a `dDepth` differs by 1).

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && /Applications/Postgres.app/Contents/Versions/17/bin/psql "$(scripts/migrations/p0a-scratch-db.sh url)" -X -v ON_ERROR_STOP=1 -c "UPDATE snapshot_target_coverage SET d_depth = d_depth - 1 WHERE (snapshot_id, career_target_id, sub_competency_id) = (SELECT snapshot_id, career_target_id, sub_competency_id FROM snapshot_target_coverage ORDER BY 1,2,3 LIMIT 1)"
cd /Users/admin/projects/curriculum_developer-wt-catalog && DATABASE_URL="$(scripts/migrations/p0a-scratch-db.sh url)" P0A_GOLDEN="$HOME/.local/share/gc-curriculum-tool/p0a/golden.json" pnpm exec vitest run tests/db/p0a-characterization.test.ts
```
Expected: `1 passed` again.

- [ ] **Step 10: Typecheck and the normal suite (no DB)**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && pnpm exec tsc --noEmit && pnpm exec vitest run
```
Expected: tsc clean. Vitest passes, with the P0a characterization test and the existing real-DB tests skipped (no `DATABASE_URL`).

- [ ] **Step 11: Commit** and record the SHA as `P0A_HARNESS_SHA` in `.dashboard/state.json`

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && git add scripts/migrations/p0a-scratch-db.sh scripts/migrations/2026-10-11-p0a-scratch-fixture.sql tests/db/p0a/scratch-guard.ts tests/db/p0a/probes.ts tests/db/p0a-characterization.test.ts lib/ai/wiki/update.ts lib/ai/explore/run-impact.ts && git commit -m "test(p0a): scratch clone + characterization golden for every re-pointed read" && git rev-parse HEAD
```

---

### Task 2: Migration 0056, verify, rollback and Drizzle schema

**Files:**
- Create: `drizzle/0056_competency_catalog_p0a.sql`, `scripts/migrations/2026-10-11-p0a-verify.sql`, `scripts/migrations/2026-10-11-p0a-rollback.sql`, `tests/db/p0a-migration.test.ts`
- Modify: `lib/db/schema.ts` (imports at line 1; add after `snapshotTargetCoverage` at about line 548), `docs/STATE.md` (Schema section and Deferred / debt)

**Interfaces:**
- Consumes: `isScratchDb()` (Task 1).
- Produces (Drizzle, `lib/db/schema.ts`):
  - `careerTargetRequirements`: table `career_target_requirements`. Fields `id, careerTargetId, competencyId, horizon: 'entry'|'growth', weight: number|null, weightSource: 'onet'|'employer'|'faculty', requiredK/U/D: number|null, depthSource: 'onet'|'employer'|'faculty'|null, status: 'draft'|'confirmed', note: string|null, contributingPositionIds: string[], displayOrder: number, createdAt, updatedAt`.
  - `snapshotCompetencyCoverage`: table `snapshot_competency_coverage`. Fields `snapshotId, competencyId, kDepth, uDepth, dDepth, matchedCompetency, evidenceExcerpt, confidence, rationale, model, generatedAt`.
  - `targetSubCompetencies`: view `target_sub_competencies`. Fields `careerTargetId, id, name, knowDescriptor, understandDescriptor, doDescriptor, displayOrder, retired, updatedAt` (the old `sub_competencies` row shape).
  - `targetCoverage`: view `target_coverage`. Fields `snapshotId, careerTargetId, subCompetencyId, kDepth, uDepth, dDepth, matchedCompetency, evidenceExcerpt, confidence, rationale, model, generatedAt` (the old `snapshot_target_coverage` row shape).
- Leaves `subCompetencies.careerTargetId` typed `.notNull()` until Task 7. The DB column is nullable from this task on, but every writer still sets it.

- [ ] **Step 1: Write the failing migration test**

`tests/db/p0a-migration.test.ts`:

```ts
// @vitest-environment node
// Migration 0056 rehearsal on the scratch clone. Gated: scratch DB AND
// P0A_MIGRATION_TEST=1, run ALONE (it rolls the migration back and re-applies it).
// Leaves the scratch DB migrated.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { isScratchDb } from './p0a/scratch-guard';

const ROOT = resolve(__dirname, '../..');
const MIGRATION = readFileSync(resolve(ROOT, 'drizzle/0056_competency_catalog_p0a.sql'), 'utf8');
const ROLLBACK = readFileSync(resolve(ROOT, 'scripts/migrations/2026-10-11-p0a-rollback.sql'), 'utf8');
const RUN = isScratchDb() && process.env.P0A_MIGRATION_TEST === '1';

const COV_COLS = `snapshot_id::text, career_target_id, sub_competency_id, k_depth, u_depth, d_depth,
  matched_competency, evidence_excerpt, confidence, rationale, model, generated_at::text`;
const STC = `SELECT ${COV_COLS} FROM snapshot_target_coverage ORDER BY 1,2,3`;
const VIEW_COV = `SELECT ${COV_COLS} FROM target_coverage ORDER BY 1,2,3`;
const SUBS = `SELECT id, career_target_id, name, know_descriptor, understand_descriptor, do_descriptor,
  display_order, retired, updated_at::text FROM sub_competencies ORDER BY id`;
const VIEW_SUBS = `SELECT id, career_target_id, name, know_descriptor, understand_descriptor, do_descriptor,
  display_order, retired, updated_at::text FROM target_sub_competencies ORDER BY id`;

describe.skipIf(!RUN)('migration 0056 (P0a) on the scratch clone', () => {
  let pool: Pool;
  let stcBefore: Record<string, unknown>[];
  let subsBefore: Array<Record<string, unknown> & { id: string; career_target_id: string; display_order: number }>;

  const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    (await pool.query(text, params)).rows as T[];
  /** Run a BEGIN…COMMIT file on one client; on error, roll back so the client is clean. */
  const runFile = async (text: string) => {
    const c = await pool.connect();
    try {
      await c.query(text);
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  };
  const applied = async () =>
    (await q<{ r: string | null }>(`SELECT to_regclass('public.snapshot_competency_coverage')::text AS r`))[0]!.r !== null;
  const nullable = async () =>
    (await q<{ n: string }>(`SELECT is_nullable AS n FROM information_schema.columns
      WHERE table_name = 'sub_competencies' AND column_name = 'career_target_id'`))[0]!.n;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    if (await applied()) await runFile(ROLLBACK); // start from the pre-P0a shape
    stcBefore = await q(STC);
    subsBefore = await q(SUBS);
  });

  afterAll(async () => {
    if (!(await applied())) await runFile(MIGRATION); // later tasks expect a migrated scratch DB
    await pool.end();
  });

  it('applies: every coverage row carried over unchanged, one draft requirement per (target, sub-competency)', async () => {
    await runFile(MIGRATION);

    expect(await nullable()).toBe('YES');
    expect(await q(STC)).toEqual(stcBefore);                 // backup untouched
    expect(await q(VIEW_COV)).toEqual(stcBefore);            // new table + view = old rows, exactly
    const [{ n }] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM snapshot_competency_coverage`);
    expect(n).toBe(stcBefore.length);
    expect(await q(VIEW_SUBS)).toEqual(subsBefore);          // membership view = old rows, exactly

    const reqs = await q(`SELECT career_target_id, competency_id, horizon, weight, weight_source,
        required_k, required_u, required_d, depth_source, status, note, contributing_position_ids, display_order
      FROM career_target_requirements ORDER BY competency_id`);
    expect(reqs).toEqual(subsBefore.map(s => ({
      career_target_id: s.career_target_id,
      competency_id: s.id,
      horizon: 'entry',
      weight: null,
      weight_source: 'faculty',
      required_k: null,
      required_u: null,
      required_d: null,
      depth_source: null,
      status: 'draft',
      note: null,
      contributing_position_ids: [],
      display_order: s.display_order,
    })));
  });

  it('Drizzle reads both views', async () => {
    const { db } = await import('@/lib/db/client');
    const { targetCoverage, targetSubCompetencies } = await import('@/lib/db/schema');
    const cov = await db.select().from(targetCoverage).limit(1);
    const subs = await db.select().from(targetSubCompetencies).limit(1);
    expect(Object.keys(cov[0] ?? {}).sort()).toEqual([
      'careerTargetId', 'confidence', 'dDepth', 'evidenceExcerpt', 'generatedAt', 'kDepth',
      'matchedCompetency', 'model', 'rationale', 'snapshotId', 'subCompetencyId', 'uDepth',
    ]);
    expect(Object.keys(subs[0] ?? {}).sort()).toEqual([
      'careerTargetId', 'displayOrder', 'doDescriptor', 'id', 'knowDescriptor', 'name', 'retired',
      'understandDescriptor', 'updatedAt',
    ]);
  });

  it('is idempotent: a second run changes nothing', async () => {
    const reqsBefore = await q(`SELECT * FROM career_target_requirements ORDER BY id`);
    await runFile(MIGRATION);
    expect(await q(VIEW_COV)).toEqual(stcBefore);
    expect(await q(`SELECT * FROM career_target_requirements ORDER BY id`)).toEqual(reqsBefore);
  });

  it('refuses to re-run once the new table has diverged from the backup (new code live)', async () => {
    const [row] = await q<{ s: string; c: string }>(
      `SELECT snapshot_id::text AS s, competency_id AS c FROM snapshot_competency_coverage ORDER BY 1,2 LIMIT 1`);
    await q(`UPDATE snapshot_competency_coverage SET generated_at = generated_at + interval '1 day'
      WHERE snapshot_id = $1::uuid AND competency_id = $2`, [row!.s, row!.c]);
    await expect(runFile(MIGRATION)).rejects.toThrow(/diverged/);
    await q(`UPDATE snapshot_competency_coverage SET generated_at = generated_at - interval '1 day'
      WHERE snapshot_id = $1::uuid AND competency_id = $2`, [row!.s, row!.c]);
    expect(await q(VIEW_COV)).toEqual(stcBefore);
  });

  it('rollback restores the pre-P0a shape exactly', async () => {
    await runFile(ROLLBACK);
    expect(await applied()).toBe(false);
    expect(await nullable()).toBe('NO');
    expect(await q(STC)).toEqual(stcBefore);
    expect(await q(SUBS)).toEqual(subsBefore);
    const [{ r1, r2 }] = await q<{ r1: string | null; r2: string | null }>(
      `SELECT to_regclass('public.career_target_requirements')::text AS r1, to_regclass('public.target_coverage')::text AS r2`);
    expect([r1, r2]).toEqual([null, null]);
  });

  it('rollback carries cells re-scored or invalidated after cutover back to the old table', async () => {
    await runFile(MIGRATION);
    const [a, b] = await q<{ s: string; c: string }>(
      `SELECT snapshot_id::text AS s, competency_id AS c FROM snapshot_competency_coverage ORDER BY 1,2 LIMIT 2`);
    await q(`UPDATE snapshot_competency_coverage SET rationale = 'rescored after cutover', generated_at = now()
      WHERE snapshot_id = $1::uuid AND competency_id = $2`, [a!.s, a!.c]);
    await q(`DELETE FROM snapshot_competency_coverage WHERE snapshot_id = $1::uuid AND competency_id = $2`, [b!.s, b!.c]);

    await runFile(ROLLBACK);
    const old = await q<{ rationale: string }>(
      `SELECT rationale FROM snapshot_target_coverage WHERE snapshot_id = $1::uuid AND sub_competency_id = $2`, [a!.s, a!.c]);
    expect(old.map(r => r.rationale)).toEqual(['rescored after cutover']);
    const gone = await q(`SELECT 1 FROM snapshot_target_coverage WHERE snapshot_id = $1::uuid AND sub_competency_id = $2`, [b!.s, b!.c]);
    expect(gone).toEqual([]);

    // Repair the scratch clone back to the captured state (the characterization golden depends on it).
    const saved = (k: { s: string; c: string }) =>
      stcBefore.find(r => r.snapshot_id === k.s && r.sub_competency_id === k.c)!;
    const ra = saved(a!);
    const rb = saved(b!);
    await q(`UPDATE snapshot_target_coverage SET rationale = $3, generated_at = $4::timestamptz
      WHERE snapshot_id = $1::uuid AND sub_competency_id = $2`, [a!.s, a!.c, ra.rationale, ra.generated_at]);
    await q(`INSERT INTO snapshot_target_coverage (snapshot_id, career_target_id, sub_competency_id, k_depth, u_depth,
        d_depth, matched_competency, evidence_excerpt, confidence, rationale, model, generated_at)
      VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::timestamptz)`,
      [rb.snapshot_id, rb.career_target_id, rb.sub_competency_id, rb.k_depth, rb.u_depth, rb.d_depth,
       rb.matched_competency, rb.evidence_excerpt, rb.confidence, rb.rationale, rb.model, rb.generated_at]);
    expect(await q(STC)).toEqual(stcBefore);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && DATABASE_URL="$(scripts/migrations/p0a-scratch-db.sh url)" P0A_MIGRATION_TEST=1 pnpm exec vitest run tests/db/p0a-migration.test.ts
```
Expected: FAIL with `ENOENT: no such file or directory, open '.../drizzle/0056_competency_catalog_p0a.sql'`.

- [ ] **Step 3: Write the migration**

`drizzle/0056_competency_catalog_p0a.sql`:

```sql
-- 0056 — Competency catalog, phase P0a: structure only, no behavior change.
-- Spec: docs/superpowers/specs/2026-10-11-competency-catalog-and-career-demand-design.md (§3, §4, §8 P0a)
-- Plan: docs/superpowers/plans/2026-10-11-competency-catalog-p0a.md
-- HAND-WRITTEN, applied with psql (same convention as 0051-0055: drizzle/meta is
-- git-ignored and stale here — see docs/STATE.md Deferred / debt).
--
-- One transaction; any failed check rolls everything back.
--   * sub_competencies becomes the shared catalog: career_target_id loses NOT
--     NULL (kept and still written as a deprecated mirror; nothing reads it).
--     Ids are unchanged, so prerequisite_edges, course_intended_coverage and
--     faculty_flags are untouched.
--   * career_target_requirements records which targets use each competency.
--     Seeded with one row per (target, sub-competency) pair, retired ones
--     included: horizon 'entry', weight NULL, weight_source 'faculty', status
--     'draft' — nothing silently gains a weight.
--   * snapshot_competency_coverage, keyed (snapshot, competency): every
--     snapshot_target_coverage row copied unchanged (1:1 — no merges in P0a).
--   * Views target_sub_competencies and target_coverage rebuild the old
--     per-target shapes through career_target_requirements.
--   * snapshot_target_coverage stays as a read-only backup (dropped in P0b).
--     career_target_demand and coverage_scores (0 rows) are left as they are.
--
-- Safe to re-run while the new table still equals the backup (a no-op). Once
-- the new code has written coverage, a re-run stops at the divergence check and
-- changes nothing. Rollback: scripts/migrations/2026-10-11-p0a-rollback.sql.

BEGIN;

-- 1. Preconditions ------------------------------------------------------------
DO $$
DECLARE
  diverged boolean := false;
BEGIN
  IF EXISTS (
    SELECT 1 FROM snapshot_target_coverage c
    JOIN sub_competencies s ON s.id = c.sub_competency_id
    WHERE s.career_target_id IS DISTINCT FROM c.career_target_id
  ) THEN
    RAISE EXCEPTION '0056: a snapshot_target_coverage row is filed under a target that does not own its sub-competency; the 1:1 carry-over is not valid';
  END IF;

  IF EXISTS (
    SELECT 1 FROM snapshot_target_coverage
    GROUP BY snapshot_id, sub_competency_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION '0056: a (snapshot, sub-competency) pair has coverage under more than one target';
  END IF;

  -- After cutover the new code writes only snapshot_competency_coverage, so any
  -- row there that is missing from, or differs in generated_at from, the backup
  -- (or a backup row missing from it) means the new code is live.
  IF to_regclass('public.snapshot_competency_coverage') IS NOT NULL THEN
    EXECUTE $q$
      SELECT EXISTS (
        SELECT 1 FROM snapshot_competency_coverage n
        LEFT JOIN snapshot_target_coverage o
          ON o.snapshot_id = n.snapshot_id AND o.sub_competency_id = n.competency_id
        WHERE o.snapshot_id IS NULL OR o.generated_at <> n.generated_at
      ) OR EXISTS (
        SELECT 1 FROM snapshot_target_coverage o
        LEFT JOIN snapshot_competency_coverage n
          ON n.snapshot_id = o.snapshot_id AND n.competency_id = o.sub_competency_id
        WHERE n.snapshot_id IS NULL
      )
    $q$ INTO diverged;
    IF diverged THEN
      RAISE EXCEPTION '0056: snapshot_competency_coverage has diverged from snapshot_target_coverage (the new code has written coverage); do not re-run this migration';
    END IF;
  END IF;
END $$;

-- 2. The catalog: career_target_id no longer means ownership -------------------
ALTER TABLE sub_competencies ALTER COLUMN career_target_id DROP NOT NULL;

-- 3. Target requirements -------------------------------------------------------
CREATE TABLE IF NOT EXISTS career_target_requirements (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  career_target_id          text NOT NULL,
  competency_id             text NOT NULL,
  horizon                   text NOT NULL,
  weight                    real,
  weight_source             text NOT NULL,
  required_k                integer,
  required_u                integer,
  required_d                integer,
  depth_source              text,
  status                    text NOT NULL DEFAULT 'draft',
  note                      text,
  contributing_position_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  display_order             integer NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT career_target_requirements_target_fk FOREIGN KEY (career_target_id)
    REFERENCES career_targets(id) ON DELETE CASCADE,
  CONSTRAINT career_target_requirements_competency_fk FOREIGN KEY (competency_id)
    REFERENCES sub_competencies(id) ON DELETE CASCADE,
  CONSTRAINT career_target_requirements_unique
    UNIQUE (career_target_id, competency_id, horizon, weight_source),
  CONSTRAINT career_target_requirements_horizon_check CHECK (horizon IN ('entry', 'growth')),
  CONSTRAINT career_target_requirements_weight_check CHECK (weight IS NULL OR (weight >= 0 AND weight <= 1)),
  CONSTRAINT career_target_requirements_weight_source_check CHECK (weight_source IN ('onet', 'employer', 'faculty')),
  CONSTRAINT career_target_requirements_depth_source_check CHECK (depth_source IS NULL OR depth_source IN ('onet', 'employer', 'faculty')),
  CONSTRAINT career_target_requirements_depth_check CHECK (
    (required_k IS NULL OR required_k BETWEEN 0 AND 5) AND
    (required_u IS NULL OR required_u BETWEEN 0 AND 5) AND
    (required_d IS NULL OR required_d BETWEEN 0 AND 5)),
  CONSTRAINT career_target_requirements_status_check CHECK (status IN ('draft', 'confirmed'))
);
CREATE INDEX IF NOT EXISTS idx_career_target_requirements_competency
  ON career_target_requirements (competency_id);

INSERT INTO career_target_requirements
  (career_target_id, competency_id, horizon, weight, weight_source, status, display_order)
SELECT s.career_target_id, s.id, 'entry', NULL, 'faculty', 'draft', s.display_order
FROM sub_competencies s
WHERE s.career_target_id IS NOT NULL
ON CONFLICT ON CONSTRAINT career_target_requirements_unique DO NOTHING;

-- 4. Per-competency coverage ----------------------------------------------------
CREATE TABLE IF NOT EXISTS snapshot_competency_coverage (
  snapshot_id        uuid NOT NULL,
  competency_id      text NOT NULL,
  k_depth            integer,
  u_depth            integer,
  d_depth            integer NOT NULL,
  matched_competency text,
  evidence_excerpt   text,
  confidence         text NOT NULL,
  rationale          text NOT NULL,
  model              text NOT NULL,
  generated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT snapshot_competency_coverage_pk PRIMARY KEY (snapshot_id, competency_id),
  CONSTRAINT snapshot_competency_coverage_snapshot_fk FOREIGN KEY (snapshot_id)
    REFERENCES course_capture_snapshots(id) ON DELETE CASCADE,
  CONSTRAINT snapshot_competency_coverage_competency_fk FOREIGN KEY (competency_id)
    REFERENCES sub_competencies(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_snapshot_competency_coverage_competency
  ON snapshot_competency_coverage (competency_id);

INSERT INTO snapshot_competency_coverage
  (snapshot_id, competency_id, k_depth, u_depth, d_depth, matched_competency, evidence_excerpt,
   confidence, rationale, model, generated_at)
SELECT snapshot_id, sub_competency_id, k_depth, u_depth, d_depth, matched_competency, evidence_excerpt,
       confidence, rationale, model, generated_at
FROM snapshot_target_coverage
ON CONFLICT ON CONSTRAINT snapshot_competency_coverage_pk DO NOTHING;

-- 5. Views: the old per-target shapes, through career_target_requirements ------
CREATE OR REPLACE VIEW target_sub_competencies AS
SELECT r.career_target_id,
       s.id,
       s.name,
       s.know_descriptor,
       s.understand_descriptor,
       s.do_descriptor,
       min(r.display_order) AS display_order,
       s.retired,
       s.updated_at
FROM career_target_requirements r
JOIN sub_competencies s ON s.id = r.competency_id
GROUP BY r.career_target_id, s.id;

CREATE OR REPLACE VIEW target_coverage AS
SELECT c.snapshot_id,
       m.career_target_id,
       c.competency_id AS sub_competency_id,
       c.k_depth,
       c.u_depth,
       c.d_depth,
       c.matched_competency,
       c.evidence_excerpt,
       c.confidence,
       c.rationale,
       c.model,
       c.generated_at
FROM snapshot_competency_coverage c
JOIN (SELECT DISTINCT career_target_id, competency_id FROM career_target_requirements) m
  ON m.competency_id = c.competency_id;

-- 6. Post-checks ---------------------------------------------------------------
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM sub_competencies s
  WHERE s.career_target_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM target_sub_competencies m
      WHERE m.id = s.id AND m.career_target_id = s.career_target_id AND m.display_order = s.display_order);
  IF n > 0 THEN
    RAISE EXCEPTION '0056: % sub-competencies have no matching target membership', n;
  END IF;

  IF EXISTS (
    SELECT competency_id FROM career_target_requirements
    GROUP BY competency_id HAVING count(DISTINCT career_target_id) > 1
  ) THEN
    RAISE EXCEPTION '0056: a competency belongs to more than one target (not expected in P0a)';
  END IF;

  SELECT count(*) INTO n FROM (
    SELECT snapshot_id, career_target_id, sub_competency_id, k_depth, u_depth, d_depth,
           matched_competency, evidence_excerpt, confidence, rationale, model, generated_at
    FROM snapshot_target_coverage
    EXCEPT ALL
    SELECT snapshot_id, career_target_id, sub_competency_id, k_depth, u_depth, d_depth,
           matched_competency, evidence_excerpt, confidence, rationale, model, generated_at
    FROM target_coverage
  ) missing;
  IF n > 0 THEN
    RAISE EXCEPTION '0056: % coverage rows did not carry over unchanged', n;
  END IF;

  SELECT count(*) INTO n FROM (
    SELECT snapshot_id, career_target_id, sub_competency_id, k_depth, u_depth, d_depth,
           matched_competency, evidence_excerpt, confidence, rationale, model, generated_at
    FROM target_coverage
    EXCEPT ALL
    SELECT snapshot_id, career_target_id, sub_competency_id, k_depth, u_depth, d_depth,
           matched_competency, evidence_excerpt, confidence, rationale, model, generated_at
    FROM snapshot_target_coverage
  ) extra;
  IF n > 0 THEN
    RAISE EXCEPTION '0056: % coverage rows in the new table have no identical old row', n;
  END IF;
END $$;

COMMIT;
```

- [ ] **Step 4: Write the rollback**

`scripts/migrations/2026-10-11-p0a-rollback.sql`:

```sql
-- Rollback of migration 0056 (competency catalog P0a).
-- Run with the app STOPPED, then deploy the pre-P0a commit.
-- After cutover snapshot_competency_coverage is authoritative, so the old table
-- is rebuilt from it: cells re-scored or invalidated after cutover carry back.
-- One transaction; a failed check changes nothing. Not re-runnable: a second
-- run stops at "0056 is not applied".

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.career_target_requirements') IS NULL THEN
    RAISE EXCEPTION 'rollback: 0056 is not applied';
  END IF;
  IF EXISTS (SELECT 1 FROM sub_competencies WHERE career_target_id IS NULL) THEN
    RAISE EXCEPTION 'rollback: a competency has no owning target (created outside P0a); resolve by hand';
  END IF;
  IF EXISTS (
    SELECT competency_id FROM career_target_requirements
    GROUP BY competency_id HAVING count(DISTINCT career_target_id) > 1
  ) THEN
    RAISE EXCEPTION 'rollback: a competency is used by more than one target (P0b data); the old schema cannot hold it';
  END IF;
  IF EXISTS (
    SELECT 1 FROM career_target_requirements r
    JOIN sub_competencies s ON s.id = r.competency_id
    WHERE r.career_target_id <> s.career_target_id
  ) THEN
    RAISE EXCEPTION 'rollback: a requirement names a target other than the competency''s owner';
  END IF;
  IF EXISTS (
    SELECT 1 FROM snapshot_competency_coverage c
    WHERE NOT EXISTS (SELECT 1 FROM career_target_requirements r WHERE r.competency_id = c.competency_id)
  ) THEN
    RAISE EXCEPTION 'rollback: a coverage row has no target membership';
  END IF;
END $$;

DELETE FROM snapshot_target_coverage;

INSERT INTO snapshot_target_coverage
  (snapshot_id, career_target_id, sub_competency_id, k_depth, u_depth, d_depth, matched_competency,
   evidence_excerpt, confidence, rationale, model, generated_at)
SELECT snapshot_id, career_target_id, sub_competency_id, k_depth, u_depth, d_depth, matched_competency,
       evidence_excerpt, confidence, rationale, model, generated_at
FROM target_coverage;

UPDATE sub_competencies s
SET display_order = m.display_order
FROM target_sub_competencies m
WHERE m.id = s.id AND s.display_order <> m.display_order;

ALTER TABLE sub_competencies ALTER COLUMN career_target_id SET NOT NULL;

DO $$
BEGIN
  IF (SELECT count(*) FROM snapshot_target_coverage) <> (SELECT count(*) FROM snapshot_competency_coverage) THEN
    RAISE EXCEPTION 'rollback: coverage row count mismatch after rebuild';
  END IF;
END $$;

DROP VIEW IF EXISTS target_coverage;
DROP VIEW IF EXISTS target_sub_competencies;
DROP TABLE IF EXISTS snapshot_competency_coverage;
DROP TABLE IF EXISTS career_target_requirements;

COMMIT;
```

- [ ] **Step 5: Write the verify report**

`scripts/migrations/2026-10-11-p0a-verify.sql`:

```sql
-- Read-only verification for migration 0056 (P0a). Run right after applying.
-- Every "expect 0" row must be 0; counts must match as noted.
-- Reference values at plan time (2026-10-11): 36 sub-competencies (34 active +
-- 2 retired), 36 requirements, 764 coverage rows in each of the three places.
BEGIN READ ONLY;

SELECT 'sub_competencies total'            AS item, count(*) AS value FROM sub_competencies
UNION ALL SELECT 'sub_competencies retired',          count(*) FROM sub_competencies WHERE retired
UNION ALL SELECT 'sub_competencies without target (expect 0)', count(*) FROM sub_competencies WHERE career_target_id IS NULL
UNION ALL SELECT 'requirements (expect = sub_competencies total)', count(*) FROM career_target_requirements
UNION ALL SELECT 'requirements with a weight (expect 0)', count(*) FROM career_target_requirements WHERE weight IS NOT NULL
UNION ALL SELECT 'requirements not entry/faculty/draft (expect 0)', count(*) FROM career_target_requirements
  WHERE horizon <> 'entry' OR weight_source <> 'faculty' OR status <> 'draft'
UNION ALL SELECT 'competencies with no membership (expect 0)', count(*) FROM sub_competencies s
  WHERE NOT EXISTS (SELECT 1 FROM career_target_requirements r WHERE r.competency_id = s.id)
UNION ALL SELECT 'memberships under a different target (expect 0)', count(*) FROM target_sub_competencies m
  JOIN sub_competencies s ON s.id = m.id WHERE m.career_target_id <> s.career_target_id
UNION ALL SELECT 'display_order differences (expect 0)', count(*) FROM target_sub_competencies m
  JOIN sub_competencies s ON s.id = m.id WHERE m.display_order <> s.display_order
UNION ALL SELECT 'competencies in more than one target (expect 0)', count(*) FROM (
  SELECT competency_id FROM career_target_requirements GROUP BY competency_id
  HAVING count(DISTINCT career_target_id) > 1) x
UNION ALL SELECT 'snapshot_target_coverage rows', count(*) FROM snapshot_target_coverage
UNION ALL SELECT 'snapshot_competency_coverage rows (expect = old)', count(*) FROM snapshot_competency_coverage
UNION ALL SELECT 'target_coverage rows (expect = old)', count(*) FROM target_coverage
UNION ALL SELECT 'old rows missing or changed in the view (expect 0)', count(*) FROM (
  SELECT snapshot_id, career_target_id, sub_competency_id, k_depth, u_depth, d_depth, matched_competency,
         evidence_excerpt, confidence, rationale, model, generated_at FROM snapshot_target_coverage
  EXCEPT ALL
  SELECT snapshot_id, career_target_id, sub_competency_id, k_depth, u_depth, d_depth, matched_competency,
         evidence_excerpt, confidence, rationale, model, generated_at FROM target_coverage) x
UNION ALL SELECT 'view rows with no identical old row (expect 0 right after apply)', count(*) FROM (
  SELECT snapshot_id, career_target_id, sub_competency_id, k_depth, u_depth, d_depth, matched_competency,
         evidence_excerpt, confidence, rationale, model, generated_at FROM target_coverage
  EXCEPT ALL
  SELECT snapshot_id, career_target_id, sub_competency_id, k_depth, u_depth, d_depth, matched_competency,
         evidence_excerpt, confidence, rationale, model, generated_at FROM snapshot_target_coverage) x
UNION ALL SELECT 'snapshots that lost a competency (expect 0)', count(*) FROM (
  SELECT DISTINCT snapshot_id, sub_competency_id FROM snapshot_target_coverage
  EXCEPT
  SELECT DISTINCT snapshot_id, competency_id FROM snapshot_competency_coverage) x
UNION ALL SELECT 'career_target_demand rows (left as is)', count(*) FROM career_target_demand
UNION ALL SELECT 'coverage_scores rows (left as is)', count(*) FROM coverage_scores;

ROLLBACK;
```

- [ ] **Step 6: Add the Drizzle schema**

In `lib/db/schema.ts` line 1, add `pgView` and `check` to the `drizzle-orm/pg-core` import. Add a second import line:

```ts
import { pgTable, pgEnum, pgView, check, uuid, text, jsonb, timestamp, integer, smallint, bigint, real, boolean, primaryKey, index, unique, foreignKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
```

On `subCompetencies.careerTargetId` (line 22), add a comment only (the type flips in Task 7):

```ts
  // Since migration 0056 (P0a) the DB column is NULLABLE and is a deprecated
  // mirror: target membership is career_target_requirements. Renamed and typed
  // nullable in Task 7 of docs/superpowers/plans/2026-10-11-competency-catalog-p0a.md.
  careerTargetId: text('career_target_id').notNull().references(() => careerTargets.id, { onDelete: 'cascade' }),
```

Directly after the `snapshotTargetCoverage` table definition, add:

```ts
/**
 * Competency catalog P0a (spec 2026-10-11 §3, §8): which career targets use
 * each catalog competency (sub_competencies is the catalog). One row per
 * (target, competency, horizon, weight_source) so horizons stay separate and
 * sources can disagree visibly. Seeded by migration 0056 with one
 * entry / faculty / draft row per (target, sub-competency), weight NULL.
 * display_order = the competency's position within the target (every row of a
 * (target, competency) pair carries the same value). Migration 0056 (hand-written).
 */
export const careerTargetRequirements = pgTable('career_target_requirements', {
  id: uuid('id').primaryKey().defaultRandom(),
  careerTargetId: text('career_target_id').notNull(),
  competencyId: text('competency_id').notNull(),
  horizon: text('horizon').$type<'entry' | 'growth'>().notNull(),
  weight: real('weight'),
  weightSource: text('weight_source').$type<'onet' | 'employer' | 'faculty'>().notNull(),
  requiredK: integer('required_k'),
  requiredU: integer('required_u'),
  requiredD: integer('required_d'),
  depthSource: text('depth_source').$type<'onet' | 'employer' | 'faculty'>(),
  status: text('status').$type<'draft' | 'confirmed'>().notNull().default('draft'),
  note: text('note'),
  contributingPositionIds: jsonb('contributing_position_ids').$type<string[]>().notNull().default([]),
  displayOrder: integer('display_order').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  foreignKey({ name: 'career_target_requirements_target_fk', columns: [t.careerTargetId], foreignColumns: [careerTargets.id] }).onDelete('cascade'),
  foreignKey({ name: 'career_target_requirements_competency_fk', columns: [t.competencyId], foreignColumns: [subCompetencies.id] }).onDelete('cascade'),
  unique('career_target_requirements_unique').on(t.careerTargetId, t.competencyId, t.horizon, t.weightSource),
  index('idx_career_target_requirements_competency').on(t.competencyId),
  check('career_target_requirements_horizon_check', sql`${t.horizon} IN ('entry', 'growth')`),
  check('career_target_requirements_weight_check', sql`${t.weight} IS NULL OR (${t.weight} >= 0 AND ${t.weight} <= 1)`),
  check('career_target_requirements_weight_source_check', sql`${t.weightSource} IN ('onet', 'employer', 'faculty')`),
  check('career_target_requirements_depth_source_check', sql`${t.depthSource} IS NULL OR ${t.depthSource} IN ('onet', 'employer', 'faculty')`),
  check('career_target_requirements_depth_check', sql`(${t.requiredK} IS NULL OR ${t.requiredK} BETWEEN 0 AND 5) AND (${t.requiredU} IS NULL OR ${t.requiredU} BETWEEN 0 AND 5) AND (${t.requiredD} IS NULL OR ${t.requiredD} BETWEEN 0 AND 5)`),
  check('career_target_requirements_status_check', sql`${t.status} IN ('draft', 'confirmed')`),
]);

/**
 * A course snapshot's evidenced K/U/D depth on one catalog competency
 * (replaces snapshot_target_coverage; spec §3). Scoring is still per target
 * with target context in P0a — only the storage key changed. Re-scoring
 * upserts on (snapshot, competency). Migration 0056 copied every old row.
 */
export const snapshotCompetencyCoverage = pgTable('snapshot_competency_coverage', {
  snapshotId: uuid('snapshot_id').notNull(),
  competencyId: text('competency_id').notNull(),
  kDepth: integer('k_depth'),
  uDepth: integer('u_depth'),
  dDepth: integer('d_depth').notNull(),
  matchedCompetency: text('matched_competency'),
  evidenceExcerpt: text('evidence_excerpt'),
  confidence: text('confidence').notNull(),
  rationale: text('rationale').notNull(),
  model: text('model').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ name: 'snapshot_competency_coverage_pk', columns: [t.snapshotId, t.competencyId] }),
  foreignKey({ name: 'snapshot_competency_coverage_snapshot_fk', columns: [t.snapshotId], foreignColumns: [courseCaptureSnapshots.id] }).onDelete('cascade'),
  foreignKey({ name: 'snapshot_competency_coverage_competency_fk', columns: [t.competencyId], foreignColumns: [subCompetencies.id] }).onDelete('cascade'),
  index('idx_snapshot_competency_coverage_competency').on(t.competencyId),
]);

/**
 * VIEW (migration 0056): a target's competencies in the old sub_competencies
 * row shape — membership and display_order from career_target_requirements,
 * name / descriptors / retired from the catalog. One row per (target,
 * competency). Read target membership here, never from sub_competencies.
 */
export const targetSubCompetencies = pgView('target_sub_competencies', {
  careerTargetId: text('career_target_id').notNull(),
  id: text('id').notNull(),
  name: text('name').notNull(),
  knowDescriptor: text('know_descriptor').notNull(),
  understandDescriptor: text('understand_descriptor').notNull(),
  doDescriptor: text('do_descriptor').notNull(),
  displayOrder: integer('display_order').notNull(),
  retired: boolean('retired').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}).existing();

/**
 * VIEW (migration 0056): per-target coverage cells in the old
 * snapshot_target_coverage row shape — each snapshot_competency_coverage row
 * once per target that uses the competency. Read-only; write
 * snapshotCompetencyCoverage.
 */
export const targetCoverage = pgView('target_coverage', {
  snapshotId: uuid('snapshot_id').notNull(),
  careerTargetId: text('career_target_id').notNull(),
  subCompetencyId: text('sub_competency_id').notNull(),
  kDepth: integer('k_depth'),
  uDepth: integer('u_depth'),
  dDepth: integer('d_depth').notNull(),
  matchedCompetency: text('matched_competency'),
  evidenceExcerpt: text('evidence_excerpt'),
  confidence: text('confidence').notNull(),
  rationale: text('rationale').notNull(),
  model: text('model').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull(),
}).existing();
```

(`courseCaptureSnapshots` and `subCompetencies` are declared earlier in the file, so the eager `foreignColumns` references are safe.)

- [ ] **Step 7: Run the migration test to verify it passes**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && DATABASE_URL="$(scripts/migrations/p0a-scratch-db.sh url)" P0A_MIGRATION_TEST=1 pnpm exec vitest run tests/db/p0a-migration.test.ts
```
Expected: `6 passed`. The scratch DB is left migrated.

- [ ] **Step 8: Red-proof the carry-over check**

Temporarily comment out the `INSERT INTO snapshot_competency_coverage … ON CONFLICT … DO NOTHING;` statement in `drizzle/0056_competency_catalog_p0a.sql`, re-run Step 7's command, and confirm FAIL with `0056: 764 coverage rows did not carry over unchanged` (the count matches the clone). Restore the statement and re-run Step 7: `6 passed`.

- [ ] **Step 9: Run the verify report on the scratch DB**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && /Applications/Postgres.app/Contents/Versions/17/bin/psql "$(scripts/migrations/p0a-scratch-db.sh url)" -X -v ON_ERROR_STOP=1 -f scripts/migrations/2026-10-11-p0a-verify.sql
```
Expected: every "expect 0" row is 0; requirements = sub_competencies total; the three coverage counts are equal.

- [ ] **Step 10: Characterization still passes** (the readers have not moved yet)

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && DATABASE_URL="$(scripts/migrations/p0a-scratch-db.sh url)" P0A_GOLDEN="$HOME/.local/share/gc-curriculum-tool/p0a/golden.json" pnpm exec vitest run tests/db/p0a-characterization.test.ts
```
Expected: `1 passed`.

- [ ] **Step 11: Typecheck and normal suite**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && pnpm exec tsc --noEmit && pnpm exec vitest run
```
Expected: clean, all pass (DB tests skipped).

- [ ] **Step 12: STATE.md (same commit as the schema change)**

In `docs/STATE.md` under `### Schema (local Postgres 17 via Drizzle)`, insert this paragraph directly above the line starting `Latest migration:`:

```markdown
- **Competency catalog P0a (2026-10-11, branch `feat/competency-catalog-p0a`; NOT applied to production — owner go-ahead pending).** Migration **`0056_competency_catalog_p0a.sql`** (hand-written, one transaction, re-runnable until cutover; verify `scripts/migrations/2026-10-11-p0a-verify.sql`, rollback `scripts/migrations/2026-10-11-p0a-rollback.sql`). `sub_competencies` becomes the shared catalog (`career_target_id` nullable, a deprecated mirror). New **`career_target_requirements`** (target × competency × horizon × weight_source; weight/required depth/status; `display_order` per target), seeded one entry/faculty/draft row per (target, sub-competency), retired included. New **`snapshot_competency_coverage`** keyed (snapshot, competency), all `snapshot_target_coverage` rows copied. Views **`target_sub_competencies`** and **`target_coverage`** give the old per-target shapes; `snapshot_target_coverage` kept as a read-only backup. Spec [`2026-10-11-competency-catalog-and-career-demand-design.md`](./superpowers/specs/2026-10-11-competency-catalog-and-career-demand-design.md) §8 P0a; plan [`2026-10-11-competency-catalog-p0a.md`](./superpowers/plans/2026-10-11-competency-catalog-p0a.md).
```

Under `### Deferred / debt`, insert directly after the heading:

```markdown
- **Competency catalog P0a — deferrals (2026-10-11, plan `2026-10-11-competency-catalog-p0a.md`).** (1) `snapshot_target_coverage` kept as a read-only backup; **drop in P0b** after the live 0056 apply is verified. (2) `sub_competencies.career_target_id` and `display_order` kept as deprecated mirrors (written, never read); **remove in P0b**. (3) `career_target_demand` (still used behind `DEMAND_COVERAGE_SEAM`) and `coverage_scores` (no readers) left in place despite spec §3 "dropped" — drop `career_target_demand` in **P1** when requirements replace it, `coverage_scores` in P0b cleanup. (4) `scripts/_one-off/{_check-study-inputs,adjudication-cases,reliability-study,reliability-study-part2b}.ts` read `subCompetencies.careerTargetId` and stop working after the P0a rename; `check-pf-coverage.ts` reads the frozen backup. They are excluded from tsconfig and were not updated. (5) First `pgView(...).existing()` use in the repo: drizzle-kit would not generate the views, so keep hand-writing migrations.
```

- [ ] **Step 13: Commit**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && git add drizzle/0056_competency_catalog_p0a.sql scripts/migrations/2026-10-11-p0a-verify.sql scripts/migrations/2026-10-11-p0a-rollback.sql tests/db/p0a-migration.test.ts lib/db/schema.ts docs/STATE.md && git commit -m "feat(db): migration 0056 — competency catalog P0a tables, views, verify + rollback"
```

---

### Task 3: Coverage write path → `snapshot_competency_coverage` (dual-write)

**Files:**
- Create: `tests/db/p0a/fixtures.ts`, `tests/db/p0a-coverage-writes.test.ts`
- Modify: `lib/db/program-coverage-queries.ts:1-3,56-74,204-218` (imports, `upsertCoverageCell`, `invalidateCoverageForSubCompetency`), `lib/capture/run-course-reset.ts:3-9,80-93`, `lib/db/__tests__/program-coverage-queries.test.ts:15-29` (mocked schema)

**Interfaces:**
- Consumes: `snapshotCompetencyCoverage`, `careerTargetRequirements`, `targetCoverage` (Task 2), `isScratchDb()`.
- Produces: `upsertCoverageCell(input: UpsertCoverageCellInput): Promise<void>` (signature unchanged; writes the new table, plus the old one until Task 7). `invalidateCoverageForSubCompetency(careerTargetId: string, subCompetencyId: string): Promise<number>` (signature unchanged; returns rows deleted from the new table). `FIXTURE_COMPETENCY`, `addFixtureCompetency(targetId)`, `removeFixtureCompetency()` from `tests/db/p0a/fixtures.ts`.

- [ ] **Step 1: Write the fixtures helper**

`tests/db/p0a/fixtures.ts`:

```ts
/**
 * A throwaway competency for P0a write tests, so a test never deletes or
 * rewrites cloned rows the characterization golden depends on. Deleting it
 * cascades to its requirement and coverage rows.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { careerTargetRequirements, subCompetencies } from '@/lib/db/schema';

export const FIXTURE_COMPETENCY = 'zz-p0a-fixture-competency';

export async function addFixtureCompetency(targetId: string): Promise<void> {
  await db.insert(subCompetencies).values({
    id: FIXTURE_COMPETENCY,
    careerTargetId: targetId,
    name: 'ZZ P0a fixture',
    knowDescriptor: 'k',
    understandDescriptor: 'u',
    doDescriptor: 'd',
    displayOrder: 999,
    retired: false,
  }).onConflictDoNothing();
  await db.insert(careerTargetRequirements).values({
    careerTargetId: targetId,
    competencyId: FIXTURE_COMPETENCY,
    horizon: 'entry',
    weight: null,
    weightSource: 'faculty',
    status: 'draft',
    displayOrder: 999,
  }).onConflictDoNothing();
}

export async function removeFixtureCompetency(): Promise<void> {
  await db.delete(subCompetencies).where(eq(subCompetencies.id, FIXTURE_COMPETENCY));
}
```

- [ ] **Step 2: Write the failing write-path test**

`tests/db/p0a-coverage-writes.test.ts`:

```ts
// @vitest-environment node
// P0a coverage write path (scratch DB only). Fixture course 'ZZ 9997' and the
// fixture competency are created and removed by this file.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  careerTargets,
  courseCaptureSnapshots,
  courses,
  snapshotCompetencyCoverage,
  snapshotTargetCoverage,
  targetCoverage,
} from '@/lib/db/schema';
import { invalidateCoverageForSubCompetency, upsertCoverageCell } from '@/lib/db/program-coverage-queries';
import { runCourseReset } from '@/lib/capture/run-course-reset';
import { isScratchDb } from './p0a/scratch-guard';
import { FIXTURE_COMPETENCY, addFixtureCompetency, removeFixtureCompetency } from './p0a/fixtures';

const CODE = 'ZZ 9997'; // never a real course
const PROFILE = { course_code: CODE, scale_version: 'v1' } as never;
const INPUTS_META = { catalog: {}, builderProfilePresent: false, materials: [], prereqSnapshotsUsed: [], scanPasses: {} } as never;

async function newSnapshot(): Promise<string> {
  const [row] = await db.insert(courseCaptureSnapshots).values({
    courseCode: CODE, profile: PROFILE, inputsMeta: INPUTS_META, scaleVersion: 'v1', model: 'test',
    instructorName: 'P0a Test', createdAt: new Date('2026-10-11T00:00:00Z'),
  } as never).returning({ id: courseCaptureSnapshots.id });
  return row!.id;
}

const cell = (snapshotId: string, targetId: string, dDepth: number, rationale: string) => ({
  snapshotId, careerTargetId: targetId, subCompetencyId: FIXTURE_COMPETENCY,
  kDepth: 1, uDepth: 2, dDepth, matchedCompetency: 'fixture statement', evidenceExcerpt: 'e',
  confidence: 'high' as const, rationale, model: 'test',
});

describe.skipIf(!isScratchDb())('P0a coverage write path', () => {
  let targetId: string;

  beforeAll(async () => {
    const [t] = await db.select({ id: careerTargets.id }).from(careerTargets).orderBy(asc(careerTargets.displayOrder)).limit(1);
    targetId = t!.id;
    await db.insert(courses).values({ code: CODE, title: 'P0a write test', level: 9000, track: 'test' } as never).onConflictDoNothing();
    await addFixtureCompetency(targetId);
  });

  afterAll(async () => {
    await db.delete(courseCaptureSnapshots).where(eq(courseCaptureSnapshots.courseCode, CODE));
    await removeFixtureCompetency();
    await db.delete(courses).where(eq(courses.code, CODE));
  });

  it('upsert keeps one cell per (snapshot, competency), visible under the owning target', async () => {
    const snapshotId = await newSnapshot();
    await upsertCoverageCell(cell(snapshotId, targetId, 3, 'first'));
    await upsertCoverageCell(cell(snapshotId, targetId, 4, 'second'));

    const rows = await db.select().from(snapshotCompetencyCoverage).where(eq(snapshotCompetencyCoverage.snapshotId, snapshotId));
    expect(rows.map(r => [r.competencyId, r.dDepth, r.rationale])).toEqual([[FIXTURE_COMPETENCY, 4, 'second']]);

    const viewRows = await db.select().from(targetCoverage).where(eq(targetCoverage.snapshotId, snapshotId));
    expect(viewRows.map(r => [r.careerTargetId, r.subCompetencyId, r.dDepth])).toEqual([[targetId, FIXTURE_COMPETENCY, 4]]);

    // TRANSITIONAL (Tasks 3-6): the backup table is kept in step. Task 7 flips this to "untouched".
    const old = await db.select().from(snapshotTargetCoverage).where(eq(snapshotTargetCoverage.snapshotId, snapshotId));
    expect(old.map(r => [r.careerTargetId, r.subCompetencyId, r.dDepth])).toEqual([[targetId, FIXTURE_COMPETENCY, 4]]);
  });

  it('invalidate removes every cell of the competency and returns the count', async () => {
    const s1 = await newSnapshot();
    const s2 = await newSnapshot();
    await upsertCoverageCell(cell(s1, targetId, 2, 'a'));
    await upsertCoverageCell(cell(s2, targetId, 2, 'b'));
    const before = await db.select().from(snapshotCompetencyCoverage).where(eq(snapshotCompetencyCoverage.competencyId, FIXTURE_COMPETENCY));

    const n = await invalidateCoverageForSubCompetency(targetId, FIXTURE_COMPETENCY);

    expect(n).toBe(before.length);
    expect(await db.select().from(snapshotCompetencyCoverage).where(eq(snapshotCompetencyCoverage.competencyId, FIXTURE_COMPETENCY))).toEqual([]);
    expect(await db.select().from(targetCoverage).where(eq(targetCoverage.subCompetencyId, FIXTURE_COMPETENCY))).toEqual([]);
  });

  it('course reset with snapshots counts and removes the new-table cells', async () => {
    const snapshotId = await newSnapshot();
    await upsertCoverageCell(cell(snapshotId, targetId, 1, 'reset me'));
    const result = await runCourseReset(CODE, { scope: 'session', includeSnapshots: true });
    expect(result.snapshotCoverageDeleted).toBe(1);
    expect(await db.select().from(snapshotCompetencyCoverage).where(eq(snapshotCompetencyCoverage.snapshotId, snapshotId))).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && DATABASE_URL="$(scripts/migrations/p0a-scratch-db.sh url)" pnpm exec vitest run tests/db/p0a-coverage-writes.test.ts
```
Expected: FAIL. The first test gets `[]` from `snapshotCompetencyCoverage` (upsert still writes only the old table). The reset test gets `snapshotCoverageDeleted` from the old table.

- [ ] **Step 4: Implement the dual-write**

`lib/db/program-coverage-queries.ts`, import line:

```ts
import { snapshotTargetCoverage, snapshotCompetencyCoverage, courseCaptureSnapshots, careerTargets, subCompetencies } from '@/lib/db/schema';
```

Replace `upsertCoverageCell` with:

```ts
/**
 * Upsert one cell. One row per (snapshot, competency): re-scoring overwrites.
 * careerTargetId is the scoring context only — which targets see the cell
 * comes from career_target_requirements (view target_coverage).
 */
export async function upsertCoverageCell(input: UpsertCoverageCellInput): Promise<void> {
  const now = new Date();
  const values = {
    kDepth: input.kDepth,
    uDepth: input.uDepth,
    dDepth: input.dDepth,
    matchedCompetency: input.matchedCompetency,
    evidenceExcerpt: input.evidenceExcerpt,
    confidence: input.confidence,
    rationale: input.rationale,
    model: input.model,
    generatedAt: now,
  };
  await db.insert(snapshotCompetencyCoverage).values({
    snapshotId: input.snapshotId,
    competencyId: input.subCompetencyId,
    ...values,
  }).onConflictDoUpdate({
    target: [snapshotCompetencyCoverage.snapshotId, snapshotCompetencyCoverage.competencyId],
    set: values,
  });
  // TRANSITIONAL (P0a Tasks 3-6; removed in Task 7): keep the backup table in step.
  await db.insert(snapshotTargetCoverage).values({ ...input, generatedAt: now }).onConflictDoUpdate({
    target: [snapshotTargetCoverage.snapshotId, snapshotTargetCoverage.careerTargetId, snapshotTargetCoverage.subCompetencyId],
    set: values,
  });
}
```

Replace `invalidateCoverageForSubCompetency` (keep its doc comment, append the P0a note) with:

```ts
/**
 * Invalidate (delete) all coverage cells for one competency. Called when the
 * competency's descriptor/name changes — the cells were scored against the OLD
 * prose and must be recomputed. listStalePairs() then sees the pair as needing
 * re-score. P0a: cells are per (snapshot, competency) and shared by every
 * target that uses the competency, so all of them go; with one target per
 * competency (P0a) these are exactly the rows the old per-target delete removed.
 * Returns the count of deleted cells.
 */
export async function invalidateCoverageForSubCompetency(
  careerTargetId: string,
  subCompetencyId: string,
): Promise<number> {
  const deleted = await db
    .delete(snapshotCompetencyCoverage)
    .where(eq(snapshotCompetencyCoverage.competencyId, subCompetencyId))
    .returning();
  // TRANSITIONAL (P0a Tasks 3-6; removed in Task 7): keep the backup table in step.
  await db
    .delete(snapshotTargetCoverage)
    .where(and(
      eq(snapshotTargetCoverage.careerTargetId, careerTargetId),
      eq(snapshotTargetCoverage.subCompetencyId, subCompetencyId),
    ));
  return deleted.length;
}
```

`lib/capture/run-course-reset.ts`: add `snapshotCompetencyCoverage` to the schema import and replace the loop body inside `if (includeSnapshots)`:

```ts
    // Coverage rows have a snapshotId FK; clear them first (counted from the
    // per-competency table, which holds the same rows as the old one in P0a).
    const snapshotIds = await db
      .select({ id: courseCaptureSnapshots.id })
      .from(courseCaptureSnapshots)
      .where(eq(courseCaptureSnapshots.courseCode, courseCode));
    let coverageDeleted = 0;
    for (const { id } of snapshotIds) {
      const rows = await db
        .delete(snapshotCompetencyCoverage)
        .where(eq(snapshotCompetencyCoverage.snapshotId, id))
        .returning({ snapshotId: snapshotCompetencyCoverage.snapshotId });
      coverageDeleted += rows.length;
      // TRANSITIONAL (P0a Tasks 3-6; removed in Task 7)
      await db.delete(snapshotTargetCoverage).where(eq(snapshotTargetCoverage.snapshotId, id));
    }
```

`lib/db/__tests__/program-coverage-queries.test.ts`: in the `vi.mock('@/lib/db/schema', …)` object, add (keep the rest):

```ts
  snapshotCompetencyCoverage: {
    snapshotId: 'snapshot_id',
    competencyId: 'competency_id',
  },
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && DATABASE_URL="$(scripts/migrations/p0a-scratch-db.sh url)" pnpm exec vitest run tests/db/p0a-coverage-writes.test.ts lib/db/__tests__/program-coverage-queries.test.ts
```
Expected: all pass. (The mocked invalidate test still sees exactly one `.returning()` call: the backup-table delete does not call `.returning()`.)

- [ ] **Step 6: Characterization, typecheck, suite**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && DATABASE_URL="$(scripts/migrations/p0a-scratch-db.sh url)" P0A_GOLDEN="$HOME/.local/share/gc-curriculum-tool/p0a/golden.json" pnpm exec vitest run tests/db/p0a-characterization.test.ts && pnpm exec tsc --noEmit && pnpm exec vitest run
```
Expected: characterization `1 passed`, tsc clean, suite green.

- [ ] **Step 7: Commit**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && git add tests/db/p0a/fixtures.ts tests/db/p0a-coverage-writes.test.ts lib/db/program-coverage-queries.ts lib/capture/run-course-reset.ts lib/db/__tests__/program-coverage-queries.test.ts && git commit -m "feat(coverage): write snapshot_competency_coverage (dual-write to the backup table during P0a)"
```

---

### Task 4: Coverage readers → `target_coverage` view / `snapshot_competency_coverage`

**Files:**
- Create: `tests/db/p0a-guards.test.ts`
- Modify: `lib/db/program-coverage-queries.ts` (`rowToCell`, `getCellsForSnapshotTarget`, `getAllCells`, `listStalePairs`), `lib/db/scaffolding-queries.ts:14-20,135-140`, `lib/program/prereq-gaps.ts:36-41,54,250-262,306-363`, `lib/ai/wiki/update.ts:18-25,169-176,320-345,425-450,625-634`, `lib/ai/wiki/refresh-all.ts:33,319-331`, `lib/ai/explore/run-impact.ts:11,128-240`, `lib/ai/explore/ripple.ts:10` (comment), `lib/db/__tests__/program-coverage-queries.test.ts`, `lib/db/__tests__/scaffolding-queries.test.ts`

**Interfaces:**
- Consumes: `targetCoverage`, `snapshotCompetencyCoverage` (Task 2).
- Produces: unchanged signatures for every function touched. `CoverageCellRow` is unchanged.

- [ ] **Step 1: Write the failing guard test**

`tests/db/p0a-guards.test.ts`:

```ts
// @vitest-environment node
// P0a static guards: source under app/, lib/, scripts/ (schema.ts, __tests__
// and the tsconfig-excluded one-off scripts are not scanned).
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

function filesMatching(pattern: string): string[] {
  try {
    const out = execFileSync('git', [
      'grep', '--untracked', '-l', '-E', pattern, '--',
      'app', 'lib', 'scripts',
      ':(exclude)scripts/_one-off',
      ':(exclude)lib/db/schema.ts',
      ':(exclude,glob)**/__tests__/**',
    ], { encoding: 'utf8' });
    return out.split('\n').filter(Boolean).sort();
  } catch (e) {
    if ((e as { status?: number }).status === 1) return []; // git grep: no matches
    throw e;
  }
}

describe('P0a guards', () => {
  it('coverage is read from snapshot_competency_coverage / target_coverage, not the backup table', () => {
    expect(filesMatching('snapshotTargetCoverage')).toEqual([
      'lib/capture/run-course-reset.ts',    // TRANSITIONAL dual-write; emptied in Task 7
      'lib/db/program-coverage-queries.ts', // TRANSITIONAL dual-write; emptied in Task 7
    ]);
  });
});
```

Update the mocked tests to the new table keys.

`lib/db/__tests__/program-coverage-queries.test.ts`: add to the mocked schema object

```ts
  targetCoverage: {
    snapshotId: 'snapshot_id',
    careerTargetId: 'career_target_id',
    subCompetencyId: 'sub_competency_id',
  },
```
and in the `getMatrixData — retired sub-competencies` test change `[schema.snapshotTargetCoverage, [cell('kept'), cell('old')]],` to `[schema.targetCoverage, [cell('kept'), cell('old')]],`.

`lib/db/__tests__/scaffolding-queries.test.ts`: change the import to `import { careerTargets, subCompetencies, courseCaptureSnapshots, targetCoverage } from '@/lib/db/schema';` and `rowsByTable.set(snapshotTargetCoverage, []);` to `rowsByTable.set(targetCoverage, []);`.

- [ ] **Step 2: Run to verify it fails**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && pnpm exec vitest run tests/db/p0a-guards.test.ts lib/db/__tests__/program-coverage-queries.test.ts
```
Expected: FAIL. The guard lists additionally `lib/ai/explore/ripple.ts`, `lib/ai/explore/run-impact.ts`, `lib/ai/wiki/refresh-all.ts`, `lib/ai/wiki/update.ts`, `lib/db/scaffolding-queries.ts`, `lib/program/prereq-gaps.ts`. The matrix retired test fails with `expected [] to deeply equal ['kept']`.

- [ ] **Step 3: Re-point `lib/db/program-coverage-queries.ts` reads**

Import: `import { snapshotTargetCoverage, snapshotCompetencyCoverage, targetCoverage, courseCaptureSnapshots, careerTargets, subCompetencies } from '@/lib/db/schema';`

```ts
function rowToCell(row: typeof targetCoverage.$inferSelect): CoverageCellRow {
```
(body unchanged)

```ts
export async function getCellsForSnapshotTarget(snapshotId: string, careerTargetId: string): Promise<CoverageCellRow[]> {
  const rows = await db
    .select()
    .from(targetCoverage)
    .where(and(
      eq(targetCoverage.snapshotId, snapshotId),
      eq(targetCoverage.careerTargetId, careerTargetId),
    ));
  return rows.map(rowToCell);
}

export async function getAllCells(): Promise<CoverageCellRow[]> {
  const rows = await db.select().from(targetCoverage);
  return rows.map(rowToCell);
}
```

In `listStalePairs`, replace the `existing` query:

```ts
  const existing = await db
    .select({
      snapshotId: targetCoverage.snapshotId,
      careerTargetId: targetCoverage.careerTargetId,
    })
    .from(targetCoverage);
```
and change the doc line `Returns pairs missing from snapshot_target_coverage.` to `Returns pairs with no cell in target_coverage.`

- [ ] **Step 4: Re-point `lib/db/scaffolding-queries.ts` cells**

Import block: replace `snapshotTargetCoverage,` with `targetCoverage,`. Replace the cells query:

```ts
  const cells = await db
    .select()
    .from(targetCoverage)
    .where(eq(targetCoverage.careerTargetId, targetId));
```

- [ ] **Step 5: Re-point `lib/program/prereq-gaps.ts`**

Import block (lines 36-41): replace `snapshotTargetCoverage,` with `snapshotCompetencyCoverage,`. In the doc comment at line 54 replace `` `snapshotTargetCoverage` `` with `` `snapshotCompetencyCoverage` ``. In the step list at lines 254-257 replace
`a. Resolve the sub-competency's careerTargetId from \`sub_competencies\`.` with `a. Confirm the competency exists in the catalog (\`sub_competencies\`).`
and `c. Look up the matching \`snapshotTargetCoverage\` row for` with `c. Look up the matching \`snapshotCompetencyCoverage\` row for`.

Replace step (a):

```ts
    // (a) The competency must exist in the catalog
    const [subComp] = await db
      .select({ id: subCompetencies.id })
      .from(subCompetencies)
      .where(eq(subCompetencies.id, subCompetencyId))
      .limit(1);
```

Replace step (c):

```ts
    // (c) Coverage row for (snapshotId, competency)
    const [coverage] = await db
      .select({
        kDepth: snapshotCompetencyCoverage.kDepth,
        uDepth: snapshotCompetencyCoverage.uDepth,
        dDepth: snapshotCompetencyCoverage.dDepth,
      })
      .from(snapshotCompetencyCoverage)
      .where(
        and(
          eq(snapshotCompetencyCoverage.snapshotId, snapshot.id),
          eq(snapshotCompetencyCoverage.competencyId, subCompetencyId),
        ),
      )
      .limit(1);
```

- [ ] **Step 6: Re-point `lib/ai/wiki/update.ts`**

Import: replace `snapshotTargetCoverage,` with `snapshotCompetencyCoverage,` and `targetCoverage,` (keep `careerTargets`, `subCompetencies`, `courses`).

In `computeAffectedPages`:

```ts
  // Competency + target pages: derive from target_coverage for this snapshot.
  const coverageCells = await db
    .select({
      subCompetencyId: targetCoverage.subCompetencyId,
      careerTargetId: targetCoverage.careerTargetId,
    })
    .from(targetCoverage)
    .where(eq(targetCoverage.snapshotId, snapshot.id));
```

In `loadCompetencySubstrate`:

```ts
  const rows = await db
    .select({
      courseCode: courseCaptureSnapshots.courseCode,
      snapshotId: snapshotCompetencyCoverage.snapshotId,
      kDepth: snapshotCompetencyCoverage.kDepth,
      uDepth: snapshotCompetencyCoverage.uDepth,
      dDepth: snapshotCompetencyCoverage.dDepth,
      matchedCompetency: snapshotCompetencyCoverage.matchedCompetency,
      evidenceExcerpt: snapshotCompetencyCoverage.evidenceExcerpt,
      profile: courseCaptureSnapshots.profile,
    })
    .from(snapshotCompetencyCoverage)
    .innerJoin(
      courseCaptureSnapshots,
      and(
        eq(snapshotCompetencyCoverage.snapshotId, courseCaptureSnapshots.id),
        isNull(courseCaptureSnapshots.retiredAt),
      ),
    )
    .where(eq(snapshotCompetencyCoverage.competencyId, subCompetencyId));
```

In `loadTargetSubstrate`, the `cellRows` query:

```ts
  const cellRows = await db
    .select({
      subCompetencyId: targetCoverage.subCompetencyId,
      courseCode: courseCaptureSnapshots.courseCode,
      snapshotId: targetCoverage.snapshotId,
      kDepth: targetCoverage.kDepth,
      uDepth: targetCoverage.uDepth,
      dDepth: targetCoverage.dDepth,
      evidenceExcerpt: targetCoverage.evidenceExcerpt,
    })
    .from(targetCoverage)
    .innerJoin(
      courseCaptureSnapshots,
      and(
        eq(targetCoverage.snapshotId, courseCaptureSnapshots.id),
        isNull(courseCaptureSnapshots.retiredAt),
      ),
    )
    .where(
      and(
        eq(targetCoverage.careerTargetId, targetId),
        inArray(targetCoverage.subCompetencyId, subIds),
      ),
    );
```

In `loadCompetencyLinksForSnapshot`:

```ts
  const rows = await db
    .select({
      matchedCompetency: snapshotCompetencyCoverage.matchedCompetency,
      subCompetencyId: snapshotCompetencyCoverage.competencyId,
    })
    .from(snapshotCompetencyCoverage)
    .where(eq(snapshotCompetencyCoverage.snapshotId, snapshotId));
```

- [ ] **Step 7: Re-point `lib/ai/wiki/refresh-all.ts`**

Import line 33: `import { courseCaptureSnapshots, courses, targetCoverage } from '@/lib/db/schema';`. In `loadRefreshInputs`:

```ts
  const cells = await db
    .select({
      snapshotId: targetCoverage.snapshotId,
      subCompetencyId: targetCoverage.subCompetencyId,
      careerTargetId: targetCoverage.careerTargetId,
    })
    .from(targetCoverage)
    .innerJoin(
      courseCaptureSnapshots,
      and(
        eq(targetCoverage.snapshotId, courseCaptureSnapshots.id),
        isNull(courseCaptureSnapshots.retiredAt),
      ),
    );
```

- [ ] **Step 8: Re-point `lib/ai/explore/run-impact.ts` and the ripple comment**

Import line 11: `import { snapshotCompetencyCoverage, subCompetencies, prerequisiteEdges } from '@/lib/db/schema';`. Replace the comment words `snapshotTargetCoverage` (doc lines about 128, 135, 208) with `snapshotCompetencyCoverage`.

In `resolveSubCompetencyDepths`:

```ts
  const coverageRows = await db
    .select({
      subCompetencyId: snapshotCompetencyCoverage.competencyId,
      matchedCompetency: snapshotCompetencyCoverage.matchedCompetency,
    })
    .from(snapshotCompetencyCoverage)
    .where(eq(snapshotCompetencyCoverage.snapshotId, snapshotId));
```

In `buildBaselineDelivered`:

```ts
  const measuredRows = await db
    .select({
      subCompetencyId: snapshotCompetencyCoverage.competencyId,
      kDepth: snapshotCompetencyCoverage.kDepth,
      uDepth: snapshotCompetencyCoverage.uDepth,
      dDepth: snapshotCompetencyCoverage.dDepth,
    })
    .from(snapshotCompetencyCoverage)
    .where(eq(snapshotCompetencyCoverage.snapshotId, snapshotId));
```

(Keep both dedup blocks. They are now no-ops and harmless. Their comments still describe the old 3-column key, so append `(one row per competency since P0a; kept as a guard)` to each.)

`lib/ai/explore/ripple.ts:10`: change `(from snapshotTargetCoverage)` to `(from snapshotCompetencyCoverage)`.

- [ ] **Step 9: Run the tests to verify they pass**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && pnpm exec vitest run tests/db/p0a-guards.test.ts lib/db/__tests__/program-coverage-queries.test.ts lib/db/__tests__/scaffolding-queries.test.ts lib/ai/wiki/__tests__/update.test.ts tests/program/prereq-gaps.test.ts tests/lib/ai/explore/run-impact.test.ts && pnpm exec tsc --noEmit
```
Expected: all pass, tsc clean.

- [ ] **Step 10: Characterization on the migrated scratch DB**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && DATABASE_URL="$(scripts/migrations/p0a-scratch-db.sh url)" P0A_GOLDEN="$HOME/.local/share/gc-curriculum-tool/p0a/golden.json" pnpm exec vitest run tests/db/p0a-characterization.test.ts
```
Expected: `1 passed`. Every coverage read now goes through the new table or view, and outputs are identical.

- [ ] **Step 11: Full suite with the scratch DB, then without**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && DATABASE_URL="$(scripts/migrations/p0a-scratch-db.sh url)" pnpm exec vitest run --exclude tests/db/p0a-characterization.test.ts --exclude tests/db/p0a-migration.test.ts && pnpm exec vitest run
```
Expected: green both times.

- [ ] **Step 12: Commit**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && git add tests/db/p0a-guards.test.ts lib/db/program-coverage-queries.ts lib/db/scaffolding-queries.ts lib/program/prereq-gaps.ts lib/ai/wiki/update.ts lib/ai/wiki/refresh-all.ts lib/ai/explore/run-impact.ts lib/ai/explore/ripple.ts lib/db/__tests__/program-coverage-queries.test.ts lib/db/__tests__/scaffolding-queries.test.ts && git commit -m "refactor(coverage): read cells from target_coverage / snapshot_competency_coverage"
```

---

### Task 5: Target-membership readers → `target_sub_competencies` view

**Files:**
- Modify: `tests/db/p0a-guards.test.ts`, `lib/db/career-targets-queries.ts:2,16-21`, `lib/db/program-coverage-queries.ts` (`getMatrixData` subs query; import), `lib/db/scaffolding-queries.ts` (subs query; import), `lib/wiki/course-views.ts:17,118-131,151-164`, `lib/ai/wiki/update.ts:409-413`, `app/api/program/coverage/refresh/route.ts:5,36-43` and its upsert loop, `app/api/program/coverage/refresh/[snapshotId]/[targetId]/route.ts:5,39,73-87`, `scripts/reliability/check.ts:27,148-160`, `scripts/reliability/model-eval.ts:26,72`, `lib/db/__tests__/program-coverage-queries.test.ts`, `lib/db/__tests__/scaffolding-queries.test.ts`

**Interfaces:**
- Consumes: `targetSubCompetencies` (Task 2).
- Produces: unchanged signatures (`listTargets`, `getMatrixData`, `loadScaffoldingTarget`, `loadCourseViews`, `loadTargetMap`).

- [ ] **Step 1: Write the failing tests**

Append to the `describe` in `tests/db/p0a-guards.test.ts`:

```ts
  it('target membership is read from target_sub_competencies, not sub_competencies.career_target_id', () => {
    expect(filesMatching('subCompetencies\\.careerTargetId')).toEqual([
      'app/api/targets/[id]/sub-competencies/[scId]/retire/route.ts', // writers; emptied in Task 6
      'app/api/targets/[id]/sub-competencies/[scId]/route.ts',
      'app/api/targets/[id]/sub-competencies/reorder/route.ts',
      'app/api/targets/[id]/sub-competencies/route.ts',
      'scripts/targets/apply-target-batch.ts',
    ]);
  });
```

`lib/db/__tests__/program-coverage-queries.test.ts`: add to the mocked schema

```ts
  targetSubCompetencies: {
    id: 'id',
    name: 'name',
    careerTargetId: 'career_target_id',
    displayOrder: 'display_order',
    retired: 'retired',
  },
```
and in the retired test change `[schema.subCompetencies, [` to `[schema.targetSubCompetencies, [`.

`lib/db/__tests__/scaffolding-queries.test.ts`: import `targetSubCompetencies` instead of `subCompetencies`, and change `rowsByTable.set(subCompetencies, …)` to `rowsByTable.set(targetSubCompetencies, …)`.

- [ ] **Step 2: Run to verify they fail**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && pnpm exec vitest run tests/db/p0a-guards.test.ts lib/db/__tests__/program-coverage-queries.test.ts lib/db/__tests__/scaffolding-queries.test.ts
```
Expected: FAIL. The guard also lists the two refresh routes, `lib/ai/wiki/update.ts`, `lib/db/scaffolding-queries.ts`, `lib/wiki/course-views.ts`, `scripts/reliability/check.ts` and `scripts/reliability/model-eval.ts`. The matrix retired test fails (`subCompetencies` → `[]`), and the scaffolding test fails (`expected [] to deeply equal ['kept']`).

- [ ] **Step 3: `lib/db/career-targets-queries.ts`**

```ts
import { careerTargets, targetSubCompetencies } from './schema';
```

```ts
  const sc = await db
    .select()
    .from(targetSubCompetencies)
    .where(eq(targetSubCompetencies.retired, false))
    .orderBy(asc(targetSubCompetencies.displayOrder));
```
(The `.filter((s) => s.careerTargetId === t.id)` mapping stays: it now reads the view's membership column.)

- [ ] **Step 4: `lib/db/program-coverage-queries.ts` `getMatrixData`**

Import: replace `subCompetencies` with `targetSubCompetencies`.

```ts
  const subs = await db
    .select({
      id: targetSubCompetencies.id,
      name: targetSubCompetencies.name,
      careerTargetId: targetSubCompetencies.careerTargetId,
      displayOrder: targetSubCompetencies.displayOrder,
      retired: targetSubCompetencies.retired,
    })
    .from(targetSubCompetencies);
```

- [ ] **Step 5: `lib/db/scaffolding-queries.ts`**

Import: replace `subCompetencies,` with `targetSubCompetencies,`.

```ts
  const subs = (await db
    .select()
    .from(targetSubCompetencies)
    .where(eq(targetSubCompetencies.careerTargetId, targetId))
    .orderBy(asc(targetSubCompetencies.displayOrder)))
    .filter(s => !s.retired);
```

- [ ] **Step 6: `lib/wiki/course-views.ts`**

Import: `import { courses, courseIntendedCoverage, subCompetencies, targetSubCompetencies, careerTargets } from '@/lib/db/schema';` (`subCompetencies` stays for `loadRetiredCompetencyIds`; `retired` is a catalog attribute).

In `loadCourseViews`:

```ts
      retired: targetSubCompetencies.retired,
    })
    .from(courseIntendedCoverage)
    .innerJoin(targetSubCompetencies, eq(targetSubCompetencies.id, courseIntendedCoverage.subCompetencyId))
    .innerJoin(careerTargets, eq(careerTargets.id, targetSubCompetencies.careerTargetId))
    .where(eq(courseIntendedCoverage.courseCode, code));
```

In `loadTargetMap`:

```ts
  const rows = await db
    .select({
      targetId: careerTargets.id,
      targetName: careerTargets.name,
      targetOrder: careerTargets.displayOrder,
      id: targetSubCompetencies.id,
      name: targetSubCompetencies.name,
      order: targetSubCompetencies.displayOrder,
      retired: targetSubCompetencies.retired,
    })
    .from(careerTargets)
    .leftJoin(targetSubCompetencies, eq(targetSubCompetencies.careerTargetId, careerTargets.id));
```

- [ ] **Step 7: `lib/ai/wiki/update.ts` `loadTargetSubstrate` subs**

Import: replace `subCompetencies,` with `targetSubCompetencies,`.

```ts
  // The target's current competencies (membership from career_target_requirements).
  const subs = await db
    .select()
    .from(targetSubCompetencies)
    .where(and(eq(targetSubCompetencies.careerTargetId, targetId), eq(targetSubCompetencies.retired, false)));
```

- [ ] **Step 8: The two coverage-refresh routes (membership plus off-target filter, Ruling 10)**

`app/api/program/coverage/refresh/[snapshotId]/[targetId]/route.ts`: import `targetSubCompetencies` instead of `subCompetencies`.

```ts
  const subs = await db.select().from(targetSubCompetencies).where(eq(targetSubCompetencies.careerTargetId, targetId));
  // Cells are stored per (snapshot, competency) since P0a; a cell the scorer
  // returns for a competency outside this target would overwrite another
  // target's cell, so only members of this target are written.
  const memberIds = new Set(subs.map(s => s.id));
```

and in the upsert loop:

```ts
    for (const cell of result.cells) {
      if (!memberIds.has(cell.sub_competency_id)) continue;
      await upsertCoverageCell({
```

`app/api/program/coverage/refresh/route.ts`: import `targetSubCompetencies` instead of `subCompetencies`.

```ts
  const targetCache = new Map<string, { target: typeof careerTargets.$inferSelect; subs: Array<typeof targetSubCompetencies.$inferSelect> }>();
  for (const tid of uniqueTargetIds) {
    const [t] = await db.select().from(careerTargets).where(eq(careerTargets.id, tid)).limit(1);
    const subs = await db.select().from(targetSubCompetencies).where(eq(targetSubCompetencies.careerTargetId, tid));
    if (t) targetCache.set(tid, { target: t, subs });
  }
```

and in its upsert loop (`// Upsert every cell from the response.`):

```ts
      // Only competencies that belong to this target (cells are per competency since P0a).
      const memberIds = new Set(targetCtx.subs.map(s => s.id));
      for (const cell of result.cells) {
        if (!memberIds.has(cell.sub_competency_id)) continue;
        await upsertCoverageCell({
```

- [ ] **Step 9: Reliability scripts**

`scripts/reliability/check.ts`: import `careerTargets, targetSubCompetencies`. Replace the subs query:

```ts
    const subs = await db
      .select({
        id: targetSubCompetencies.id,
        name: targetSubCompetencies.name,
        knowDescriptor: targetSubCompetencies.knowDescriptor,
        understandDescriptor: targetSubCompetencies.understandDescriptor,
        doDescriptor: targetSubCompetencies.doDescriptor,
        displayOrder: targetSubCompetencies.displayOrder,
        retired: targetSubCompetencies.retired,
      })
      .from(targetSubCompetencies)
      .where(eq(targetSubCompetencies.careerTargetId, target.id))
      .orderBy(asc(targetSubCompetencies.displayOrder));
```

`scripts/reliability/model-eval.ts`: import `careerTargets, targetSubCompetencies`; line 72:

```ts
    const subs = (await db.select().from(targetSubCompetencies).where(eq(targetSubCompetencies.careerTargetId, t.id)).orderBy(asc(targetSubCompetencies.displayOrder))).filter(s => !s.retired);
```

- [ ] **Step 10: Run the tests to verify they pass**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && pnpm exec vitest run tests/db/p0a-guards.test.ts lib/db/__tests__/program-coverage-queries.test.ts lib/db/__tests__/scaffolding-queries.test.ts && pnpm exec tsc --noEmit
```
Expected: pass, tsc clean.

- [ ] **Step 11: Characterization plus full suites**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && DATABASE_URL="$(scripts/migrations/p0a-scratch-db.sh url)" P0A_GOLDEN="$HOME/.local/share/gc-curriculum-tool/p0a/golden.json" pnpm exec vitest run tests/db/p0a-characterization.test.ts
cd /Users/admin/projects/curriculum_developer-wt-catalog && DATABASE_URL="$(scripts/migrations/p0a-scratch-db.sh url)" pnpm exec vitest run --exclude tests/db/p0a-characterization.test.ts --exclude tests/db/p0a-migration.test.ts && pnpm exec vitest run
```
Expected: characterization `1 passed`; both suites green.

- [ ] **Step 12: Commit**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && git add tests/db/p0a-guards.test.ts lib/db/career-targets-queries.ts lib/db/program-coverage-queries.ts lib/db/scaffolding-queries.ts lib/wiki/course-views.ts lib/ai/wiki/update.ts "app/api/program/coverage/refresh/route.ts" "app/api/program/coverage/refresh/[snapshotId]/[targetId]/route.ts" scripts/reliability/check.ts scripts/reliability/model-eval.ts lib/db/__tests__/program-coverage-queries.test.ts lib/db/__tests__/scaffolding-queries.test.ts && git commit -m "refactor(targets): read target membership from target_sub_competencies"
```

---

### Task 6: Membership writers: catalog module, target editor API, target batch, seed

**Files:**
- Create: `lib/db/competency-catalog-queries.ts`, `tests/db/p0a-catalog-writes.test.ts`
- Modify: `app/api/targets/[id]/sub-competencies/route.ts`, `.../reorder/route.ts`, `.../[scId]/route.ts`, `.../[scId]/retire/route.ts`, `scripts/targets/apply-target-batch.ts:22-83`, `scripts/seed-career-targets.ts:55-77`, `tests/api/targets.test.ts`, `tests/db/p0a-guards.test.ts`

**Interfaces:**
- Consumes: `careerTargetRequirements`, `targetSubCompetencies`, `subCompetencies`, `careerTargets` (Task 2); `BatchWriter`, `DbSubRow`, `DbTargetRow` from `lib/domain/target-batch.ts`.
- Produces (from `lib/db/competency-catalog-queries.ts`):
  - `type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]`
  - `type TargetCompetencyRow = typeof targetSubCompetencies.$inferSelect`
  - `interface NewTargetCompetency { id: string; careerTargetId: string; name: string; knowDescriptor: string; understandDescriptor: string; doDescriptor: string; displayOrder: number; retired?: boolean }`
  - `getTargetCompetency(careerTargetId: string, competencyId: string): Promise<TargetCompetencyRow | null>`
  - `nextDisplayOrderForTarget(careerTargetId: string): Promise<number>`
  - `insertCompetencyForTarget(tx: Tx, row: NewTargetCompetency): Promise<TargetCompetencyRow>`
  - `setCompetencyOrderInTarget(tx: Tx, careerTargetId: string, competencyId: string, displayOrder: number): Promise<number>`
  - `targetIdsForCompetency(tx: Tx, competencyId: string): Promise<string[]>`
  - `readCatalogState(tx: Tx, lock: boolean): Promise<{ targets: DbTargetRow[]; subs: DbSubRow[] }>`
  - `catalogBatchWriter(tx: Tx): BatchWriter`

- [ ] **Step 1: Write the failing tests**

`tests/db/p0a-catalog-writes.test.ts`:

```ts
// @vitest-environment node
// P0a catalog/membership writers (scratch DB only). Every write runs inside a
// transaction that is rolled back, so the cloned rows are never changed.
import { describe, it, expect } from 'vitest';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { careerTargetRequirements, careerTargets, subCompetencies, targetSubCompetencies } from '@/lib/db/schema';
import {
  type Tx,
  catalogBatchWriter,
  getTargetCompetency,
  insertCompetencyForTarget,
  readCatalogState,
  setCompetencyOrderInTarget,
} from '@/lib/db/competency-catalog-queries';
import { planTargetBatch, type DbSubRow } from '@/lib/domain/target-batch';
import { CAREER_TARGETS, RETIRED_SUB_COMPETENCIES } from '@/lib/domain/seed-targets';
import { isScratchDb } from './p0a/scratch-guard';

class Rollback extends Error {}
async function inRolledBackTx(fn: (tx: Tx) => Promise<void>): Promise<void> {
  await expect(db.transaction(async (tx) => {
    await fn(tx);
    throw new Rollback('rollback');
  })).rejects.toBeInstanceOf(Rollback);
}

describe.skipIf(!isScratchDb())('P0a catalog writers', () => {
  it('readCatalogState gives the same sub rows and the same batch plan as the pre-P0a read', async () => {
    // Pre-P0a read, from the deprecated mirror columns (identical to membership in P0a).
    const old = await db.execute(sql`SELECT id, career_target_id, name, know_descriptor, understand_descriptor,
      do_descriptor, display_order, retired FROM sub_competencies ORDER BY id`);
    const oldSubs: DbSubRow[] = (old.rows as Array<Record<string, unknown>>).map(r => ({
      id: r.id as string, careerTargetId: r.career_target_id as string, name: r.name as string,
      knowDescriptor: r.know_descriptor as string, understandDescriptor: r.understand_descriptor as string,
      doDescriptor: r.do_descriptor as string, displayOrder: r.display_order as number, retired: r.retired as boolean,
    }));

    const state = await db.transaction(async (tx) => readCatalogState(tx, false));
    const byId = (a: DbSubRow, b: DbSubRow) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); // JS order, not DB collation
    expect([...state.subs].sort(byId)).toEqual([...oldSubs].sort(byId));
    expect(planTargetBatch(CAREER_TARGETS, RETIRED_SUB_COMPETENCIES, state.targets, state.subs))
      .toEqual(planTargetBatch(CAREER_TARGETS, RETIRED_SUB_COMPETENCIES, state.targets, oldSubs));
  });

  it('insertCompetencyForTarget writes the catalog row and one entry/faculty/draft requirement with no weight', async () => {
    const [t] = await db.select({ id: careerTargets.id }).from(careerTargets).orderBy(asc(careerTargets.displayOrder)).limit(1);
    await inRolledBackTx(async (tx) => {
      const row = await insertCompetencyForTarget(tx, {
        id: 'zz-p0a-insert-test', careerTargetId: t!.id, name: 'ZZ insert', knowDescriptor: 'k',
        understandDescriptor: 'u', doDescriptor: 'd', displayOrder: 42,
      });
      expect(row).toMatchObject({ id: 'zz-p0a-insert-test', careerTargetId: t!.id, displayOrder: 42, retired: false });
      const reqs = await tx.select().from(careerTargetRequirements).where(eq(careerTargetRequirements.competencyId, 'zz-p0a-insert-test'));
      expect(reqs.map(r => [r.careerTargetId, r.horizon, r.weight, r.weightSource, r.status, r.displayOrder]))
        .toEqual([[t!.id, 'entry', null, 'faculty', 'draft', 42]]);
    });
  });

  it('setCompetencyOrderInTarget moves the requirement and the deprecated mirror; other targets are untouched', async () => {
    const [m] = await db.select().from(targetSubCompetencies).where(eq(targetSubCompetencies.retired, false)).orderBy(asc(targetSubCompetencies.id)).limit(1);
    await inRolledBackTx(async (tx) => {
      expect(await setCompetencyOrderInTarget(tx, m!.careerTargetId, m!.id, 77)).toBe(1);
      expect(await setCompetencyOrderInTarget(tx, 'not-a-target', m!.id, 5)).toBe(0);
      const [v] = await tx.select().from(targetSubCompetencies)
        .where(and(eq(targetSubCompetencies.careerTargetId, m!.careerTargetId), eq(targetSubCompetencies.id, m!.id)));
      expect(v!.displayOrder).toBe(77);
      const [c] = await tx.select().from(subCompetencies).where(eq(subCompetencies.id, m!.id));
      expect(c!.displayOrder).toBe(77);
    });
  });

  it('the batch writer refuses to reorder a competency used by two targets (P0a invariant)', async () => {
    const targets = await db.select({ id: careerTargets.id }).from(careerTargets).orderBy(asc(careerTargets.displayOrder));
    const [m] = await db.select().from(targetSubCompetencies).where(eq(targetSubCompetencies.careerTargetId, targets[0]!.id)).limit(1);
    await inRolledBackTx(async (tx) => {
      await tx.insert(careerTargetRequirements).values({
        careerTargetId: targets[1]!.id, competencyId: m!.id, horizon: 'entry', weight: null,
        weightSource: 'faculty', status: 'draft', displayOrder: 0,
      });
      await expect(catalogBatchWriter(tx).updateSub(m!.id, { displayOrder: 3 })).rejects.toThrow(/exactly one target/);
    });
  });

  it('getTargetCompetency finds a member and returns null for a non-member target', async () => {
    const [m] = await db.select().from(targetSubCompetencies).limit(1);
    expect(await getTargetCompetency(m!.careerTargetId, m!.id)).toMatchObject({ id: m!.id, careerTargetId: m!.careerTargetId });
    expect(await getTargetCompetency('not-a-target', m!.id)).toBeNull();
  });
});
```

In `tests/db/p0a-guards.test.ts`, change the membership expectation to `toEqual([])` (and drop the five-entry list).

In `tests/api/targets.test.ts`, add a mock after the `career-targets-queries` mock:

```ts
vi.mock('@/lib/db/competency-catalog-queries', () => ({
  nextDisplayOrderForTarget: vi.fn(async () => 7),
  insertCompetencyForTarget: vi.fn(async (_tx: unknown, row: Record<string, unknown>) => ({
    ...row,
    retired: false,
    updatedAt: new Date(),
  })),
}));
```

add `transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})),` to the mocked `db` object, add the import `import * as catalogModule from '@/lib/db/competency-catalog-queries';` after the route imports, and extend the create test:

```ts
  it('creates a new sub-competency and returns 201', async () => {
    const req = makeRequest('POST', {
      name: 'Brand Voice',
      knowDescriptor: 'Knows the elements of brand voice.',
      understandDescriptor: 'Understands why brand voice requires consistency.',
      doDescriptor: 'Produces copy that reflects a defined brand voice.',
    });
    const res = await postSubComp(req, { params: makeParams({ id: 'production-operations' }) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body).toMatchObject({ careerTargetId: 'production-operations', displayOrder: 7 });
    expect(vi.mocked(catalogModule.insertCompetencyForTarget)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'brand-voice', careerTargetId: 'production-operations', displayOrder: 7 }),
    );
  });
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && DATABASE_URL="$(scripts/migrations/p0a-scratch-db.sh url)" pnpm exec vitest run tests/db/p0a-catalog-writes.test.ts tests/db/p0a-guards.test.ts tests/api/targets.test.ts
```
Expected: FAIL. Catalog test: `Failed to resolve import "@/lib/db/competency-catalog-queries"`. Guard: the five writer files are listed. targets test: the module mock exists but the route does not call it (`insertCompetencyForTarget` not called).

- [ ] **Step 3: Write `lib/db/competency-catalog-queries.ts`**

```ts
/**
 * Competency catalog writes (P0a, migration 0056). sub_competencies is the
 * catalog; career_target_requirements records which targets use a competency
 * and its position in each (display_order). Membership is READ from the view
 * target_sub_competencies. During P0a the deprecated mirror columns
 * sub_competencies.career_target_id / display_order are still written (for the
 * rollback script) and never read. Spec §8 P0a; plan
 * docs/superpowers/plans/2026-10-11-competency-catalog-p0a.md.
 */
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { careerTargetRequirements, careerTargets, subCompetencies, targetSubCompetencies } from '@/lib/db/schema';
import type { BatchWriter, DbSubRow, DbTargetRow } from '@/lib/domain/target-batch';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type TargetCompetencyRow = typeof targetSubCompetencies.$inferSelect;

export interface NewTargetCompetency {
  id: string;
  careerTargetId: string;
  name: string;
  knowDescriptor: string;
  understandDescriptor: string;
  doDescriptor: string;
  displayOrder: number;
  retired?: boolean;
}

/** The competency as a member of the target (old sub_competencies row shape), or null if not a member. */
export async function getTargetCompetency(careerTargetId: string, competencyId: string): Promise<TargetCompetencyRow | null> {
  const [row] = await db
    .select()
    .from(targetSubCompetencies)
    .where(and(eq(targetSubCompetencies.careerTargetId, careerTargetId), eq(targetSubCompetencies.id, competencyId)))
    .limit(1);
  return row ?? null;
}

/** Next display_order for a new competency in the target: last current one + 1, or 0. */
export async function nextDisplayOrderForTarget(careerTargetId: string): Promise<number> {
  const rows = await db
    .select({ displayOrder: targetSubCompetencies.displayOrder })
    .from(targetSubCompetencies)
    .where(and(eq(targetSubCompetencies.careerTargetId, careerTargetId), eq(targetSubCompetencies.retired, false)))
    .orderBy(asc(targetSubCompetencies.displayOrder));
  return rows.length > 0 ? rows[rows.length - 1]!.displayOrder + 1 : 0;
}

/** Create a catalog competency used by one target: catalog row + one entry/faculty/draft requirement (weight NULL). */
export async function insertCompetencyForTarget(tx: Tx, row: NewTargetCompetency): Promise<TargetCompetencyRow> {
  await tx.insert(subCompetencies).values({
    id: row.id,
    careerTargetId: row.careerTargetId, // deprecated mirror (P0a; never read)
    name: row.name,
    knowDescriptor: row.knowDescriptor,
    understandDescriptor: row.understandDescriptor,
    doDescriptor: row.doDescriptor,
    displayOrder: row.displayOrder,     // deprecated mirror (P0a; never read)
    retired: row.retired ?? false,
    updatedAt: new Date(),
  });
  await tx.insert(careerTargetRequirements).values({
    careerTargetId: row.careerTargetId,
    competencyId: row.id,
    horizon: 'entry',
    weight: null,
    weightSource: 'faculty',
    status: 'draft',
    displayOrder: row.displayOrder,
  });
  const [created] = await tx
    .select()
    .from(targetSubCompetencies)
    .where(and(eq(targetSubCompetencies.careerTargetId, row.careerTargetId), eq(targetSubCompetencies.id, row.id)));
  return created!;
}

/** Set a competency's position within one target. Returns rows updated (0 = not a member). */
export async function setCompetencyOrderInTarget(
  tx: Tx,
  careerTargetId: string,
  competencyId: string,
  displayOrder: number,
): Promise<number> {
  const updated = await tx
    .update(careerTargetRequirements)
    .set({ displayOrder, updatedAt: new Date() })
    .where(and(eq(careerTargetRequirements.careerTargetId, careerTargetId), eq(careerTargetRequirements.competencyId, competencyId)))
    .returning({ id: careerTargetRequirements.id });
  if (updated.length > 0) {
    // deprecated mirror (P0a; never read)
    await tx.update(subCompetencies).set({ displayOrder, updatedAt: new Date() }).where(eq(subCompetencies.id, competencyId));
  }
  return updated.length;
}

export async function targetIdsForCompetency(tx: Tx, competencyId: string): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ id: careerTargetRequirements.careerTargetId })
    .from(careerTargetRequirements)
    .where(eq(careerTargetRequirements.competencyId, competencyId));
  return rows.map(r => r.id).sort();
}

/** Target-batch state: targets + one DbSubRow per (target, competency) membership. */
export async function readCatalogState(tx: Tx, lock: boolean): Promise<{ targets: DbTargetRow[]; subs: DbSubRow[] }> {
  if (lock) {
    // A GROUP BY view cannot be locked FOR UPDATE; lock the rows it is built from.
    await tx.select({ id: careerTargets.id }).from(careerTargets).for('update');
    await tx.select({ id: subCompetencies.id }).from(subCompetencies).for('update');
    await tx.select({ id: careerTargetRequirements.id }).from(careerTargetRequirements).for('update');
  }
  const targets = await tx.select().from(careerTargets).orderBy(asc(careerTargets.displayOrder));
  const subs = await tx
    .select()
    .from(targetSubCompetencies)
    .orderBy(asc(targetSubCompetencies.careerTargetId), asc(targetSubCompetencies.displayOrder), asc(targetSubCompetencies.id));
  return {
    targets: targets.map(t => ({
      id: t.id,
      name: t.name,
      shortDefinition: t.shortDefinition,
      industryContexts: t.industryContexts,
      knowDescriptors: t.knowDescriptors,
      understandDescriptors: t.understandDescriptors,
      doDescriptors: t.doDescriptors,
      defensibilityNote: t.defensibilityNote,
      socCode: t.socCode ?? null,
    })),
    subs: subs.map(s => ({
      id: s.id,
      careerTargetId: s.careerTargetId,
      name: s.name,
      knowDescriptor: s.knowDescriptor,
      understandDescriptor: s.understandDescriptor,
      doDescriptor: s.doDescriptor,
      displayOrder: s.displayOrder,
      retired: s.retired,
    })),
  };
}

/** BatchWriter for scripts/targets/apply-target-batch.ts. */
export function catalogBatchWriter(tx: Tx): BatchWriter {
  return {
    async updateTarget(id, fields) {
      await tx.update(careerTargets).set({ ...fields, updatedAt: new Date() }).where(eq(careerTargets.id, id));
    },
    async updateSub(id, fields) {
      if (fields.displayOrder !== undefined) {
        const targets = await targetIdsForCompetency(tx, id);
        if (targets.length !== 1) {
          throw new Error(`P0a: ${id} must be used by exactly one target to reorder it (found ${targets.length})`);
        }
        await setCompetencyOrderInTarget(tx, targets[0]!, id, fields.displayOrder);
      }
      const catalogFields: Partial<typeof subCompetencies.$inferInsert> = {};
      if (fields.name !== undefined) catalogFields.name = fields.name;
      if (fields.knowDescriptor !== undefined) catalogFields.knowDescriptor = fields.knowDescriptor;
      if (fields.understandDescriptor !== undefined) catalogFields.understandDescriptor = fields.understandDescriptor;
      if (fields.doDescriptor !== undefined) catalogFields.doDescriptor = fields.doDescriptor;
      if (fields.retired !== undefined) catalogFields.retired = fields.retired;
      if (Object.keys(catalogFields).length > 0) {
        await tx.update(subCompetencies).set({ ...catalogFields, updatedAt: new Date() }).where(eq(subCompetencies.id, id));
      }
    },
    async insertSub(row) {
      await insertCompetencyForTarget(tx, row);
    },
    async retireSub(id) {
      await tx.update(subCompetencies).set({ retired: true, updatedAt: new Date() }).where(eq(subCompetencies.id, id));
    },
  };
}
```

- [ ] **Step 4: Target editor routes**

`app/api/targets/[id]/sub-competencies/route.ts`. Imports:

```ts
import { db } from '@/lib/db/client';
import { subCompetencies, prototypeTargetEdits } from '@/lib/db/schema';
import { getTargetById, clearTargetCache } from '@/lib/db/career-targets-queries';
import { insertCompetencyForTarget, nextDisplayOrderForTarget } from '@/lib/db/competency-catalog-queries';
import { hashIp } from '@/lib/ip-hash';
import { eq } from 'drizzle-orm';
```

Replace from `// Get next display_order` through the `.returning();` of the insert with:

```ts
    // Next position in this target (membership from career_target_requirements)
    const nextOrder = await nextDisplayOrderForTarget(id);

    const created = await db.transaction((tx) => insertCompetencyForTarget(tx, {
      id: candidateId,
      careerTargetId: id,
      name: parsed.data.name,
      knowDescriptor: parsed.data.knowDescriptor,
      understandDescriptor: parsed.data.understandDescriptor,
      doDescriptor: parsed.data.doDescriptor,
      displayOrder: nextOrder,
      retired: false,
    }));
```
(The slug-uniqueness loop over `subCompetencies.id` stays as is: ids are catalog-wide.)

`app/api/targets/[id]/sub-competencies/reorder/route.ts`. Imports:

```ts
import { db } from '@/lib/db/client';
import { prototypeTargetEdits } from '@/lib/db/schema';
import { getTargetById, clearTargetCache } from '@/lib/db/career-targets-queries';
import { setCompetencyOrderInTarget } from '@/lib/db/competency-catalog-queries';
import { hashIp } from '@/lib/ip-hash';
```

Replace the update loop with:

```ts
    // Update each competency's position in this target; ids that are not
    // members of the target are ignored (as before).
    await db.transaction(async (tx) => {
      for (let i = 0; i < order.length; i++) {
        await setCompetencyOrderInTarget(tx, id, order[i]!, i);
      }
    });
```

`app/api/targets/[id]/sub-competencies/[scId]/route.ts`. Imports:

```ts
import { db } from '@/lib/db/client';
import { subCompetencies, prototypeTargetEdits } from '@/lib/db/schema';
import { clearTargetCache } from '@/lib/db/career-targets-queries';
import { getTargetCompetency } from '@/lib/db/competency-catalog-queries';
import { invalidateCoverageForSubCompetency } from '@/lib/db/program-coverage-queries';
import { hashIp } from '@/lib/ip-hash';
import { eq } from 'drizzle-orm';
```

Replace the `current` lookup and the update:

```ts
    // The competency must be a member of this target (old row shape, for the audit log)
    const current = await getTargetCompetency(id, scId);

    if (!current) {
      return NextResponse.json({ error: `sub-competency not found: ${scId}` }, { status: 404 });
    }

    const updates: Partial<typeof subCompetencies.$inferInsert> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.knowDescriptor !== undefined) updates.knowDescriptor = parsed.data.knowDescriptor;
    if (parsed.data.understandDescriptor !== undefined) updates.understandDescriptor = parsed.data.understandDescriptor;
    if (parsed.data.doDescriptor !== undefined) updates.doDescriptor = parsed.data.doDescriptor;

    // Name and descriptors live on the catalog row
    await db.update(subCompetencies).set(updates).where(eq(subCompetencies.id, scId));
    const updated = await getTargetCompetency(id, scId);
```
(The audit insert, `invalidateCoverageForSubCompetency(id, scId)`, `clearTargetCache()` and `return NextResponse.json(updated);` stay.)

`app/api/targets/[id]/sub-competencies/[scId]/retire/route.ts`. Imports:

```ts
import { db } from '@/lib/db/client';
import { subCompetencies, prototypeTargetEdits } from '@/lib/db/schema';
import { clearTargetCache } from '@/lib/db/career-targets-queries';
import { getTargetCompetency } from '@/lib/db/competency-catalog-queries';
import { hashIp } from '@/lib/ip-hash';
import { eq } from 'drizzle-orm';
```

```ts
    const current = await getTargetCompetency(id, scId);

    if (!current) {
      return NextResponse.json({ error: `sub-competency not found: ${scId}` }, { status: 404 });
    }

    if (current.retired) {
      return NextResponse.json({ error: 'sub-competency is already retired' }, { status: 409 });
    }

    // retired is a catalog attribute (P0a: one target per competency, so this
    // is exactly the old per-target retire)
    await db
      .update(subCompetencies)
      .set({ retired: true, updatedAt: new Date() })
      .where(eq(subCompetencies.id, scId));
```

- [ ] **Step 5: `scripts/targets/apply-target-batch.ts`**

Replace the imports and the local `Tx`/`readState`/`drizzleWriter` (lines 22-83) with:

```ts
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { CAREER_TARGETS, RETIRED_SUB_COMPETENCIES } from '@/lib/domain/seed-targets';
import { planTargetBatch, applyPlan, formatPlan } from '@/lib/domain/target-batch';
import { catalogBatchWriter, readCatalogState } from '@/lib/db/competency-catalog-queries';
```

In `main()`: `readState(tx, apply)` → `readCatalogState(tx, apply)`, `drizzleWriter(tx)` → `catalogBatchWriter(tx)`, `readState(tx, false)` → `readCatalogState(tx, false)`. In the header comment, replace `Touches ONLY career_targets and sub_competencies` with `Touches ONLY career_targets, sub_competencies and career_target_requirements (membership + display order, P0a)`.

- [ ] **Step 6: `scripts/seed-career-targets.ts`**

After the `INSERT INTO sub_competencies … ON CONFLICT (id) DO NOTHING` statement, inside the same loop, add:

```ts
      await db.execute(sql`
        INSERT INTO career_target_requirements (
          career_target_id, competency_id, horizon, weight, weight_source, status, display_order
        ) VALUES (
          ${t.id}, ${sc.id}, 'entry', NULL, 'faculty', 'draft', ${j}
        )
        ON CONFLICT ON CONSTRAINT career_target_requirements_unique DO NOTHING
      `);
```
and update the header comment's first line to `reads CAREER_TARGETS constant and inserts into career_targets, sub_competencies and career_target_requirements (migration 0056).`

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && DATABASE_URL="$(scripts/migrations/p0a-scratch-db.sh url)" pnpm exec vitest run tests/db/p0a-catalog-writes.test.ts tests/db/p0a-guards.test.ts tests/api/targets.test.ts && pnpm exec tsc --noEmit
```
Expected: all pass, tsc clean.

- [ ] **Step 8: Target-batch dry run on the scratch DB** (read-only transaction, so nothing is written)

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && DATABASE_URL="$(scripts/migrations/p0a-scratch-db.sh url)" pnpm exec tsx scripts/targets/apply-target-batch.ts --dry-run
```
Expected: `DRY RUN`, with zero updates/inserts/retires per target (production was applied 2026-10-06, and the clone mirrors it).

- [ ] **Step 9: Characterization plus full suites**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && DATABASE_URL="$(scripts/migrations/p0a-scratch-db.sh url)" P0A_GOLDEN="$HOME/.local/share/gc-curriculum-tool/p0a/golden.json" pnpm exec vitest run tests/db/p0a-characterization.test.ts
cd /Users/admin/projects/curriculum_developer-wt-catalog && DATABASE_URL="$(scripts/migrations/p0a-scratch-db.sh url)" pnpm exec vitest run --exclude tests/db/p0a-characterization.test.ts --exclude tests/db/p0a-migration.test.ts && pnpm exec vitest run
```
Expected: green.

- [ ] **Step 10: Commit**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && git add lib/db/competency-catalog-queries.ts tests/db/p0a-catalog-writes.test.ts tests/db/p0a-guards.test.ts tests/api/targets.test.ts "app/api/targets/[id]/sub-competencies/route.ts" "app/api/targets/[id]/sub-competencies/reorder/route.ts" "app/api/targets/[id]/sub-competencies/[scId]/route.ts" "app/api/targets/[id]/sub-competencies/[scId]/retire/route.ts" scripts/targets/apply-target-batch.ts scripts/seed-career-targets.ts && git commit -m "feat(targets): write target membership + order to career_target_requirements"
```

---

### Task 7: Contract: stop writing the backup, rename the deprecated mirrors

**Files:**
- Modify: `lib/db/program-coverage-queries.ts` (remove the transitional writes), `lib/capture/run-course-reset.ts` (remove the transitional delete), `lib/db/schema.ts` (`subCompetencies`, `snapshotTargetCoverage` comment), `lib/db/competency-catalog-queries.ts` (mirror field names), `tests/db/p0a/fixtures.ts`, `tests/db/p0a-coverage-writes.test.ts`, `tests/db/p0a-guards.test.ts`, `tests/db/p0a-catalog-writes.test.ts:setCompetencyOrderInTarget assertion`, `lib/db/__tests__/program-coverage-queries.test.ts` (mocked schema), `docs/STATE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: `subCompetencies.deprecatedCareerTargetId: string | null` (column `career_target_id`) and `subCompetencies.deprecatedDisplayOrder: number` (column `display_order`). They are written only by `insertCompetencyForTarget`/`setCompetencyOrderInTarget`, and nothing reads them. No code writes or reads `snapshotTargetCoverage`.

- [ ] **Step 1: Flip the tests to the end state (failing)**

`tests/db/p0a-coverage-writes.test.ts`: in the upsert test, replace the TRANSITIONAL block with:

```ts
    // The backup table is read-only since P0a Task 7: scoring never writes it.
    const old = await db.select().from(snapshotTargetCoverage).where(eq(snapshotTargetCoverage.snapshotId, snapshotId));
    expect(old).toEqual([]);
```

`tests/db/p0a-guards.test.ts`: change the coverage expectation to `toEqual([])` (drop the two TRANSITIONAL entries).

- [ ] **Step 2: Run to verify they fail**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && DATABASE_URL="$(scripts/migrations/p0a-scratch-db.sh url)" pnpm exec vitest run tests/db/p0a-coverage-writes.test.ts tests/db/p0a-guards.test.ts
```
Expected: FAIL. The backup row exists (dual-write), and the guard lists `lib/capture/run-course-reset.ts` and `lib/db/program-coverage-queries.ts`.

- [ ] **Step 3: Remove the transitional writes**

`lib/db/program-coverage-queries.ts`: delete the `// TRANSITIONAL …` insert in `upsertCoverageCell`. In `invalidateCoverageForSubCompetency`, delete the `// TRANSITIONAL …` delete and add `void careerTargetId; // kept for callers; cells are per competency since P0a` as the first statement. Remove `snapshotTargetCoverage` from the import.

`lib/capture/run-course-reset.ts`: delete the two `// TRANSITIONAL …` lines in the loop and remove `snapshotTargetCoverage` from the import.

`lib/db/__tests__/program-coverage-queries.test.ts`: remove the `snapshotTargetCoverage: {…}` entry from the mocked schema.

- [ ] **Step 4: Rename the deprecated mirrors in `lib/db/schema.ts`**

Replace the `subCompetencies` table with:

```ts
export const subCompetencies = pgTable('sub_competencies', {
  id: text('id').primaryKey(),               // stable slug; never changes once created
  /**
   * DEPRECATED (P0a, migration 0056): the owning target from before the shared
   * catalog. Still written as a mirror for the rollback script, never read —
   * target membership is career_target_requirements (view target_sub_competencies).
   * Removed in P0b.
   */
  deprecatedCareerTargetId: text('career_target_id').references(() => careerTargets.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  knowDescriptor: text('know_descriptor').notNull(),
  understandDescriptor: text('understand_descriptor').notNull(),
  doDescriptor: text('do_descriptor').notNull(),
  /** DEPRECATED (P0a): mirror of career_target_requirements.display_order, written for the rollback script only. Removed in P0b. */
  deprecatedDisplayOrder: integer('display_order').notNull(),
  retired: boolean('retired').default(false).notNull(),  // catalog attribute; soft delete so old coverage doesn't orphan
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
```

Above `snapshotTargetCoverage`, add to its comment:

```ts
// READ-ONLY BACKUP since competency catalog P0a (migration 0056): nothing
// writes or reads it; coverage lives in snapshot_competency_coverage (view
// target_coverage). Kept until the live migration is verified; dropped in P0b.
```

- [ ] **Step 5: Let the compiler find every remaining use**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && pnpm exec tsc --noEmit
```
Expected errors, and only these: `lib/db/competency-catalog-queries.ts` (`careerTargetId`/`displayOrder` in the `subCompetencies` insert and update), `tests/db/p0a/fixtures.ts` and `tests/db/p0a-catalog-writes.test.ts` (`c!.displayOrder`). **Any other file in the error list is a missed reader: re-point it to `targetSubCompetencies` (Task 5 pattern) before continuing.**

Fix them. In `insertCompetencyForTarget`:

```ts
    deprecatedCareerTargetId: row.careerTargetId, // mirror for the rollback script (P0a; never read)
    ...
    deprecatedDisplayOrder: row.displayOrder,     // mirror for the rollback script (P0a; never read)
```

In `setCompetencyOrderInTarget`:

```ts
    await tx.update(subCompetencies).set({ deprecatedDisplayOrder: displayOrder, updatedAt: new Date() }).where(eq(subCompetencies.id, competencyId));
```

In `tests/db/p0a-catalog-writes.test.ts`, the mirror assertion: `expect(c!.deprecatedDisplayOrder).toBe(77);`.

Replace `tests/db/p0a/fixtures.ts` `addFixtureCompetency` with:

```ts
export async function addFixtureCompetency(targetId: string): Promise<void> {
  const [existing] = await db.select({ id: subCompetencies.id }).from(subCompetencies).where(eq(subCompetencies.id, FIXTURE_COMPETENCY));
  if (existing) return;
  await db.transaction((tx) => insertCompetencyForTarget(tx, {
    id: FIXTURE_COMPETENCY,
    careerTargetId: targetId,
    name: 'ZZ P0a fixture',
    knowDescriptor: 'k',
    understandDescriptor: 'u',
    doDescriptor: 'd',
    displayOrder: 999,
  }));
}
```
with imports `import { subCompetencies } from '@/lib/db/schema';` and `import { insertCompetencyForTarget } from '@/lib/db/competency-catalog-queries';` (drop `careerTargetRequirements`).

- [ ] **Step 6: Run everything**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && pnpm exec tsc --noEmit && DATABASE_URL="$(scripts/migrations/p0a-scratch-db.sh url)" pnpm exec vitest run --exclude tests/db/p0a-characterization.test.ts --exclude tests/db/p0a-migration.test.ts && pnpm exec vitest run
cd /Users/admin/projects/curriculum_developer-wt-catalog && DATABASE_URL="$(scripts/migrations/p0a-scratch-db.sh url)" P0A_GOLDEN="$HOME/.local/share/gc-curriculum-tool/p0a/golden.json" pnpm exec vitest run tests/db/p0a-characterization.test.ts
```
Expected: tsc clean, both suites green, characterization `1 passed`.

- [ ] **Step 7: STATE.md (schema changed)**

In the P0a Schema bullet added in Task 2, append: ` Drizzle names the mirrors \`subCompetencies.deprecatedCareerTargetId\` / \`deprecatedDisplayOrder\` (written for rollback only, never read); \`snapshot_target_coverage\` has no writers or readers.`

- [ ] **Step 8: Commit**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && git add lib/db/program-coverage-queries.ts lib/capture/run-course-reset.ts lib/db/schema.ts lib/db/competency-catalog-queries.ts tests/db/p0a/fixtures.ts tests/db/p0a-coverage-writes.test.ts tests/db/p0a-guards.test.ts tests/db/p0a-catalog-writes.test.ts lib/db/__tests__/program-coverage-queries.test.ts docs/STATE.md && git commit -m "refactor(db): stop writing snapshot_target_coverage; rename deprecated sub_competencies mirrors"
```

---

### Task 8: Final verification on a fresh clone, build, STATE.md

**Files:**
- Modify: `docs/STATE.md` (Active arc entry)

**Interfaces:**
- Consumes: `P0A_HARNESS_SHA` (Task 1), every artifact above.
- Produces: an authoritative golden from a fresh clone, compared against the finished code. Build evidence.

- [ ] **Step 1: Fresh scratch clone (pre-migration) plus fixture**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && scripts/migrations/p0a-scratch-db.sh create && /Applications/Postgres.app/Contents/Versions/17/bin/psql "$(scripts/migrations/p0a-scratch-db.sh url)" -X -v ON_ERROR_STOP=1 -f scripts/migrations/2026-10-11-p0a-scratch-fixture.sql
```

- [ ] **Step 2: Capture the golden with the pre-P0a code** (harness worktree at `P0A_HARNESS_SHA`)

```bash
git -C /Users/admin/projects/curriculum_developer-wt-catalog worktree add /Users/admin/projects/curriculum_developer-wt-catalog-harness <P0A_HARNESS_SHA>
cd /Users/admin/projects/curriculum_developer-wt-catalog-harness && pnpm install --frozen-lockfile
cd /Users/admin/projects/curriculum_developer-wt-catalog-harness && DATABASE_URL="$(/Users/admin/projects/curriculum_developer-wt-catalog/scripts/migrations/p0a-scratch-db.sh url)" P0A_GOLDEN="$HOME/.local/share/gc-curriculum-tool/p0a/golden-final.json" P0A_CAPTURE=1 pnpm exec vitest run tests/db/p0a-characterization.test.ts
```
Expected: `1 passed`; `golden-final.json` written.

- [ ] **Step 3: Apply the migration exactly as the owner will** (psql, ON_ERROR_STOP), then verify

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && /Applications/Postgres.app/Contents/Versions/17/bin/psql "$(scripts/migrations/p0a-scratch-db.sh url)" -X -v ON_ERROR_STOP=1 -f drizzle/0056_competency_catalog_p0a.sql && /Applications/Postgres.app/Contents/Versions/17/bin/psql "$(scripts/migrations/p0a-scratch-db.sh url)" -X -v ON_ERROR_STOP=1 -f scripts/migrations/2026-10-11-p0a-verify.sql
```
Expected: `COMMIT`; verify shows every "expect 0" = 0 and equal coverage counts. Re-run the migration once more: expected `COMMIT` with no changes (idempotent).

- [ ] **Step 4: Compare the finished code against the golden**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && DATABASE_URL="$(scripts/migrations/p0a-scratch-db.sh url)" P0A_GOLDEN="$HOME/.local/share/gc-curriculum-tool/p0a/golden-final.json" pnpm exec vitest run tests/db/p0a-characterization.test.ts
```
Expected: `1 passed`. **This is the invariant:** every view returns the same data as before the migration.

- [ ] **Step 5: Red-proof against the new storage**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && /Applications/Postgres.app/Contents/Versions/17/bin/psql "$(scripts/migrations/p0a-scratch-db.sh url)" -X -v ON_ERROR_STOP=1 -c "UPDATE snapshot_competency_coverage SET d_depth = d_depth + 1 WHERE (snapshot_id, competency_id) = (SELECT snapshot_id, competency_id FROM snapshot_competency_coverage ORDER BY 1,2 LIMIT 1)"
cd /Users/admin/projects/curriculum_developer-wt-catalog && DATABASE_URL="$(scripts/migrations/p0a-scratch-db.sh url)" P0A_GOLDEN="$HOME/.local/share/gc-curriculum-tool/p0a/golden-final.json" pnpm exec vitest run tests/db/p0a-characterization.test.ts
```
Expected: FAIL (a `dDepth` differs).

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && /Applications/Postgres.app/Contents/Versions/17/bin/psql "$(scripts/migrations/p0a-scratch-db.sh url)" -X -v ON_ERROR_STOP=1 -c "UPDATE snapshot_competency_coverage SET d_depth = d_depth - 1 WHERE (snapshot_id, competency_id) = (SELECT snapshot_id, competency_id FROM snapshot_competency_coverage ORDER BY 1,2 LIMIT 1)"
cd /Users/admin/projects/curriculum_developer-wt-catalog && DATABASE_URL="$(scripts/migrations/p0a-scratch-db.sh url)" P0A_GOLDEN="$HOME/.local/share/gc-curriculum-tool/p0a/golden-final.json" pnpm exec vitest run tests/db/p0a-characterization.test.ts
```
Expected: `1 passed`.

Also red-proof a membership read. Run `UPDATE career_target_requirements SET display_order = display_order + 100 WHERE competency_id = (SELECT id FROM sub_competencies WHERE NOT retired ORDER BY id LIMIT 1)`, re-run (expect FAIL on `listTargets` or `getMatrixData` order), then revert with `- 100` and re-run (expect pass).

- [ ] **Step 6: Migration rehearsal, alone**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && DATABASE_URL="$(scripts/migrations/p0a-scratch-db.sh url)" P0A_MIGRATION_TEST=1 pnpm exec vitest run tests/db/p0a-migration.test.ts
```
Expected: `6 passed` (scratch left migrated).

- [ ] **Step 7: Full gates**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && DATABASE_URL="$(scripts/migrations/p0a-scratch-db.sh url)" pnpm exec vitest run --exclude tests/db/p0a-characterization.test.ts --exclude tests/db/p0a-migration.test.ts && pnpm exec vitest run && pnpm exec tsc --noEmit && pnpm lint && pnpm build
```
Expected: all green; `next build` succeeds. If `pnpm build` needs a DB at build time, it reads `.env.local` (the live URL) only for static generation reads. Before the migration is live, any build-time read of the new views would fail. In that case stop and report: it means a page reads the DB at build time, and that page must be `force-dynamic`. That is a finding, not something to work around.

- [ ] **Step 8: STATE.md Active arc**

Under `## Active arc`, insert as the first bullet:

```markdown
- **Competency catalog P0a (2026-10-11) — built on `feat/competency-catalog-p0a`, verified on a scratch clone; live apply + deploy pending owner go-ahead.** No behavior change: characterization (18 read paths: matrix, scaffolding, prereq gaps, sufficiency, Explore baseline/ripple, wiki target/competency/affected pages, course views, target map, target list) is identical before/after on a fresh clone. Live apply procedure, verify and rollback: plan Task 10. Next: P0b merges (spec §8) after owner review.
```

- [ ] **Step 9: Commit and clean up the harness worktree**

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && git add docs/STATE.md && git commit -m "docs(state): competency catalog P0a verified on scratch; live apply pending owner"
git -C /Users/admin/projects/curriculum_developer-wt-catalog worktree remove /Users/admin/projects/curriculum_developer-wt-catalog-harness
```

---

### Task 9: Adversarial review (required before merge)

**Files:** none written by the reviewer except its findings report. Fixes go through new TDD steps in the feature worktree.

**Interfaces:**
- Consumes: branch `feat/competency-catalog-p0a`, the scratch DB, this plan, the spec.
- Produces: an honest **ACCEPT** from a fresh-context reviewer.

- [ ] **Step 1: Dispatch the reviewer.** Use `/adversarial-review` if available; otherwise use the Agent tool with model **opus**, because this needs real judgment about data loss. Prompt:

> Hostile review of branch `feat/competency-catalog-p0a` in `/Users/admin/projects/curriculum_developer-wt-catalog` (migration 0056 rewrites persistent data). Read `docs/superpowers/plans/2026-10-11-competency-catalog-p0a.md` (Rulings + Task 10) and spec §8 P0a. Verify by RUNNING, only against the scratch DB `gc_curriculum_p0a_scratch` (`DATABASE_URL="$(scripts/migrations/p0a-scratch-db.sh url)"`). Never touch the live DB, never print credentials, never pkill. Try to break, at minimum: (1) migration re-run before and after simulated cutover (new scc rows, changed generated_at, deleted cells); (2) rollback after re-score + invalidation, and rollback when a competency was created after cutover; (3) the 12 coverage rows on the 2 retired sub-competencies, and display_order ties between active and retired rows; (4) whether any reader still reads `sub_competencies.career_target_id`/`display_order` or `snapshot_target_coverage` (including raw SQL strings); (5) the off-target cell filter in both refresh routes; (6) the transactional create/reorder under failure (throw mid-transaction); (7) characterization coverage — any re-pointed read path NOT probed; (8) FK cascade effects (delete a target or a competency on scratch); (9) whether `pnpm build` or any page reads the new views at build time. Report each finding with a reproduction command and observed output, then a verdict ACCEPT / REJECT.

- [ ] **Step 2: Fix each confirmed finding with a red-proofed test in the feature worktree**, then re-run Task 8 Steps 4 and 7. Send the reviewer the fixes (SendMessage to the same agent) and iterate until an honest ACCEPT.

- [ ] **Step 3: Record findings deferred as low/non-blocking** in STATE.md **Deferred / debt** (one bullet, pointing to the review report) and commit.

---

### Task 10: STOP: ask owner. Live apply (owner-gated, never automatic)

**STOP.** Do not run anything in this task without the owner's explicit go-ahead in this conversation. Present the commands below and wait. Deploying the merged code is the owner's separate deploy chain and is not part of this plan.

**Ordering requirement (Ruling 12):** apply the migration with the app stopped (`com.gc.curriculum-tool`, stopped the way the owner's deploy chain does it), immediately before deploying the merged P0a commit. Otherwise the old code could write `snapshot_target_coverage` after the copy, and the rollback, which treats the new table as authoritative, would not keep those writes.

- [ ] **Step 1: (owner) Backup**

```bash
PGBIN=/Applications/Postgres.app/Contents/Versions/17/bin
mkdir -p "$HOME/.local/share/gc-curriculum-tool/p0a"
"$PGBIN/pg_dump" --no-owner "$(node ~/.claude/dashboard/read-env.mjs /Users/admin/projects/curriculum_developer DATABASE_URL)" | gzip > "$HOME/.local/share/gc-curriculum-tool/p0a/pre-0056-$(date +%Y%m%dT%H%M%S).sql.gz"
```

- [ ] **Step 2: (owner) Stop the app, apply, verify** (from a checkout of the merged P0a commit, e.g. the feature worktree)

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && /Applications/Postgres.app/Contents/Versions/17/bin/psql "$(node ~/.claude/dashboard/read-env.mjs /Users/admin/projects/curriculum_developer DATABASE_URL)" -X -v ON_ERROR_STOP=1 -f drizzle/0056_competency_catalog_p0a.sql
cd /Users/admin/projects/curriculum_developer-wt-catalog && /Applications/Postgres.app/Contents/Versions/17/bin/psql "$(node ~/.claude/dashboard/read-env.mjs /Users/admin/projects/curriculum_developer DATABASE_URL)" -X -v ON_ERROR_STOP=1 -f scripts/migrations/2026-10-11-p0a-verify.sql
```
Expected: `COMMIT`; every "expect 0" row = 0; requirements = sub_competencies total (36 at plan time); the three coverage counts are equal (764 at plan time). Any non-zero "expect 0" row → do not deploy; run Step 4.

- [ ] **Step 3: (owner) Deploy the merged commit and start the app** (separate deploy chain). Smoke test on `https://gcworkflow.clemson.edu:8443`: `/program` matrix (each target tab), a course page's prerequisite panel, `/wiki` target and competency pages, the Explore page for one course. Then update STATE.md: P0a **applied to production** (date, owner go-ahead).

- [ ] **Step 4: (owner, only if needed) Rollback** — app stopped:

```bash
cd /Users/admin/projects/curriculum_developer-wt-catalog && /Applications/Postgres.app/Contents/Versions/17/bin/psql "$(node ~/.claude/dashboard/read-env.mjs /Users/admin/projects/curriculum_developer DATABASE_URL)" -X -v ON_ERROR_STOP=1 -f scripts/migrations/2026-10-11-p0a-rollback.sql
```
then deploy the pre-P0a commit and start the app. The rollback refuses (changes nothing) if a competency has no owning target or is in more than one target. It rebuilds `snapshot_target_coverage` from the new table, so cells re-scored after cutover are kept.

---

## Self-review

**Spec coverage (§8 P0a and the brief):**
- Drop the required `career_target_id` ownership, ids kept, edges/intended/flags untouched → Task 2 (DDL), Tasks 5–7 (readers off it, rename), Ruling 1.
- `career_target_requirements` with every §3 field, one row per (target, competency, horizon, source), seeded faculty/draft/no weight → Task 2 (table, seed, test asserts every field), Ruling 4.
- Membership everywhere from requirements: listing, display order, retire/reorder/create APIs, seed, target-batch apply, synthesis, Explore, wiki, position rated items, scaffolding, sufficiency, prereq → Tasks 5 and 6. Synthesis, position capture, Explore and sufficiency follow through `listTargets`/`getTargetById`/`getMatrixData` and are covered by characterization.
- `snapshot_competency_coverage` replacing `snapshot_target_coverage`, all 764 rows with all columns, readers joining through requirements, scoring per target with only the write path changed → Tasks 2–4 and 7, Rulings 5–7.
- Backup table kept, dropped in P0b → Ruling 7, Task 7, STATE Deferred / debt.
- `career_target_demand` / `coverage_scores` decision → Ruling 8.
- Hand-written transactional idempotent migration, verify queries, rollback, owner-gated apply → Tasks 2 and 10.
- Invariant plus characterization on the repo's real-DB test pattern (`describe.skipIf`, fixture rows) → Tasks 1 and 8, scratch-guarded.
- One-off scripts → Ruling 11.
- §9 tests: row-count/spot-check (migration test plus verify), red-proof (every task), adversarial review (Task 9). Merge-disagreement tests belong to P0b.

**Placeholder scan:** the only literal to fill at execution time is `<P0A_HARNESS_SHA>` in Task 8 Step 2. It is produced and recorded by Task 1 Step 11.

**Type consistency:** `targetCoverage`/`targetSubCompetencies` field names match the old tables' Drizzle names, so swapped readers keep their property access. `insertCompetencyForTarget(tx, NewTargetCompetency)` accepts `DbSubRow` (structural superset) in `catalogBatchWriter.insertSub`. The Task 7 rename is applied in the same task to the only two writers and the fixture, with tsc as the check.

**Known risks to watch during execution:**
- First `pgView(...).existing()` in the repo. Task 2's "Drizzle reads both views" test proves the select path. If `db.select().from(view)` misbehaves with `innerJoin`/`leftJoin`, characterization in Tasks 4–5 will show it.
- `pnpm build` and build-time DB reads (Task 8 Step 7 note).
- Tie order: two active/retired `display_order` ties exist in `ai-workflow` (2 and 4). Active-only lists have no ties, so every characterized order is deterministic. The new state reader adds `id` as a final tiebreak; the target batch planner keys by id, so this does not change its output.
