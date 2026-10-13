# Competency Catalog P1 (occupations, O*NET store, business-acumen competencies) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every career target a sourced occupation mix for both horizons. Entry comes from first jobs and growth from positions held 5–10 years out, both derived from the gc_alumni export. Add a versioned O*NET 31.0 reference store for those occupations. Add a small set of business-acumen catalog competencies, AI-drafted and owner/faculty-approved.

**Architecture:**
- Migration 0058 is purely additive. It adds new tables plus one defaulted column, and drops and rewrites nothing.
- Three owner-runnable, idempotent scripts fill the tables:
  - an alumni-mix ingest (`career_demand.json` → `career_target_occupations`);
  - an O*NET loader (31.0 CSVs → reference tables, for the occupations in the mixes only);
  - a catalog insert for the approved business-acumen competencies (unlinked, `origin = 'gc_authored'`).
- A read-only report script prints each target's mix and its highest-Importance O*NET elements, so the owner can inspect the data.
- No faculty-visible page changes in P1. The readiness view is P3.

**Tech Stack:** Next.js 15, TypeScript strict, Drizzle ORM 0.45.2, Postgres 17 (127.0.0.1:5433), Vitest 3, pnpm.

**Spec:** [`docs/superpowers/specs/2026-10-11-competency-catalog-and-career-demand-design.md`](../specs/2026-10-11-competency-catalog-and-career-demand-design.md). This plan covers §8 P1, §3 (the `career_target_occupations` and O*NET tables), §5 steps 1, 2 and 7, and §9.

**Owner decision (2026-10-12), which changes the spec's P1 scope:** links come before weights. Requirement weights and required depths are NOT drafted in P1. They are drafted once, after P2's O*NET/ESCO links are confirmed: O*NET-seeded where a confirmed link exists (spec §5.4), AI-drafted otherwise (§5.5). P1 builds only what those steps consume.

## Global Constraints

- **US spelling.**
- **Never touch the live `gc_curriculum` database** before Task 7, whether by tests, scripts, migrations or builds. The dev `.env.local` points at LIVE. All work uses the scratch clone `gc_curriculum_p1_scratch` (Task 1). Every DB test refuses to run unless `DATABASE_URL` names that clone. Every build runs with `DATABASE_URL` set explicitly to it.
- **Never print credentials.** Never copy `.env.local`. Get scratch URLs only via `scripts/migrations/p1-scratch-db.sh url`.
- **Live apply and live ingest are owner-gated:** Task 7 starts with STOP: ask owner.
- **Worktree only:** `/Users/admin/projects/curriculum_developer-wt-p1`, on branch `feat/competency-catalog-p1`. Never commit in the main, deploy, or older worktrees.
- **No launchctl, no pkill/killall.** Do not dispatch subagents from implementers.
- **Red-proof every regression test,** and record the red output in the task report.
- **STATE.md is updated in the same commit** as each schema change. Deferrals go in Deferred/debt.
- **O*NET content is CC BY 4.0.** Every surface or doc that shows O*NET data carries the attribution: "This product includes information from O*NET 31.0 Database by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA). Used under the CC BY 4.0 license." The O*NET CSVs stay out of git (`scratch/` is ignored). The loader takes a directory path.
- **gc_alumni is a separate repo.** Read its export file. Never edit it.
- **Tooling:** `pnpm exec tsx` does not resolve in worktrees. Use `node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs`. Postgres binaries are `/Applications/Postgres.app/Contents/Versions/17/bin/{psql,pg_dump,pg_restore}`.
- **Commit messages** end with the session's attribution lines.

## Rulings

1. **Occupation-mix source and horizons.**
   - Entry uses `entry.by_target`.
   - Growth uses `growth_registrar_era.by_target`: registrar era 2016 onward, the same frame as entry (the owner's 2026-10-11 decision).
   - `growth_all_validated` is not stored.
   - Each row records `source = 'alumni_rule'` and `source_version = '<_stamp.commit>/<_stamp.data>'`. `as_of` is `_stamp.generated`.
2. **Target-label mapping** is fixed, and the ingest refuses any unknown label:
   - "1 Production & Operations" → `production-operations`
   - "2 Sales Solutions & Account Management" → `account-management`
   - "3 Brand Strategy & Experience" → `brand-strategy`
   - "4 Purposeful Design & Creative Generalist" → `creative-generalist`
   - "5 Creative Technology & Systems" → `ai-workflow`
3. **SOC → O*NET rule.** This is the 2026-10-11 design, verified against 31.0: 95 of the 106 SOCs in the export have a rated `.00`, and 11 are "All Other" or unrated. One row per (target, horizon, SOC, O*NET code):
   - **Rated `.00`:** a SOC whose `XX-XXXX.00` code has ratings in 31.0 maps to it with `onet_status = 'rated'`.
   - **`onet_detail` breakdown:** entries with this breakdown (13-1161, 11-9199, 13-1199) split their count across the listed O*NET codes. `'none'` → `onet_soc_code = NULL`, `onet_status = 'no_fit'`.
   - **No rated `.00`:** a SOC without one (11-9199, 13-1199, 15-1299, 17-2199, 17-3019, 25-3099, 27-1029, 27-3099, 41-9099, 43-9199, 51-9199) gets `onet_soc_code = NULL`, `onet_status = 'unrated'`. It is **never averaged over child codes.**
   - **Shares:** `share` = count / the target's `n`. Shares within a (target, horizon) sum to 1 ± rounding. Unrated and no-fit rows keep their share, so later readiness math can report the unrated fraction openly rather than renormalizing it away.
4. **Ingest replace semantics.** Re-running the ingest replaces all `source = 'alumni_rule'` rows in one transaction. `source = 'faculty'` rows are never touched. Re-running with the same `source_version` changes nothing (idempotent).
5. **O*NET store scope.**
   - The store loads one release (31.0), and only the O*NET codes that appear as `rated` in `career_target_occupations`. That is about 97 codes and roughly 50k rating rows, which keeps the weekly DB backup small.
   - The loader is idempotent per (release, code) and can be re-run after a mix change.
   - **Domains:** knowledge, abilities, work_activities, essential_skills and transferable_skills. Each element has scale IM (Importance 1–5) and scale LV (Level 0–7).
   - **Tasks:** task statements, plus task ratings with scales IM, RT and FT. FT is stored per category.
   - Rows flagged `Recommend Suppress = Y` are stored, with the flag kept. Rows flagged `Not Relevant = Y` are stored too. Neither is filtered at load; consumers decide.
6. **Business-acumen competencies.**
   - The controller drafts them from four sources: the career targets' descriptions; the O*NET business elements with high Importance in the destination occupations (for example Administration and Management, Economics and Accounting, Sales and Marketing, Customer and Personal Service); the existing catalog, to avoid duplicates; and course captures.
   - The owner approves the wording. The approved set lives in `docs/superpowers/specs/2026-10-12-business-acumen-competencies.json`, committed with the approval.
   - They enter the catalog **unlinked** (Amendment 1) with `origin = 'gc_authored'`. Linking them to targets is a requirement decision that comes with the weights, after P2.
   - **Task 5 does not start until the owner has approved that file.**
7. **`origin` column** on `sub_competencies`: `'migrated' | 'gc_authored' | 'onet_seeded'`. It defaults to `'migrated'`, and 0058 sets every existing row to `'migrated'`. `onet_seeded` is unused until P2.
8. **Live apply needs no app stop.** 0058 is additive, and the running code never reads the new tables or the new column. Task 7 still takes a verified `-Fc` backup first and runs a fail-closed verify. Rollback is `2026-10-12-p1-rollback.sql`, which drops only the new objects. That is safe because nothing outside P1 references them.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `scripts/migrations/p1-scratch-db.sh` | `create` / `url` / `drop` for `gc_curriculum_p1_scratch` (a read-only clone of live). Modeled on `p0b-scratch-db.sh`. |
| `drizzle/0058_competency_catalog_p1.sql` | The additive migration. |
| `scripts/migrations/2026-10-12-p1-verify.sql` | Fail-closed verify, ending in a `DO` block that raises on failure. |
| `scripts/migrations/2026-10-12-p1-rollback.sql` | Drops the P1 objects only. |
| `lib/careers/alumni-mix.ts` | Pure: parse and validate `career_demand.json`, then apply Rulings 1–3. Returns rows. |
| `scripts/careers/ingest-alumni-mix.ts` | CLI. Run with `--file <path> --expect-db <name> [--dry-run]`. Uses `alumni-mix.ts` and writes per Ruling 4. |
| `lib/onet/load.ts` | Pure: parse the O*NET CSVs (header-checked) and filter to a code set. Returns typed rows. |
| `scripts/onet/load-onet.ts` | CLI. Run with `--dir <path> --release 31.0 --expect-db <name> [--dry-run]`. Writes per Ruling 5. |
| `scripts/careers/insert-business-acumen.ts` | CLI. Run with `--file <json> --expect-db <name> [--dry-run]`. Inserts the approved, unlinked competencies. |
| `scripts/careers/occupation-report.ts` | Read-only. For each target and horizon: the mix (SOC, title, share, status), then the top 15 O*NET elements by share-weighted Importance. Prints the CC BY attribution. |
| `tests/db/p1/scratch-guard.ts` | `isP1ScratchDb()`. |
| Tests | `tests/lib/careers/alumni-mix.test.ts`, `tests/lib/onet/load.test.ts`, `tests/db/p1-migration.test.ts`, `tests/db/p1-ingest.test.ts`, `tests/db/p1-onet-load.test.ts`, `tests/db/p1-business-acumen.test.ts` |

**Modified:** `lib/db/schema.ts` and `docs/STATE.md`.

---

### Task 1: Worktree, scratch clone, guard

- [ ] **Step 1:** Write `p1-scratch-db.sh` by copying `scripts/migrations/p0b-scratch-db.sh` with the database name `gc_curriculum_p1_scratch`. Keep its guards: it refuses if the database exists; it reads live only via `pg_dump` with the URL taken from `read-env.mjs` inside `$(...)`; the URL never appears on argv.
- [ ] **Step 2:** Write `tests/db/p1/scratch-guard.ts`. `isP1ScratchDb()` returns true only when the URL pathname is exactly `/gc_curriculum_p1_scratch`. Unit-test it: accept the exact name; reject live, the P0a/P0b scratch names, query-string and user-field tricks, and prefix/suffix variants. Red-proof it.
- [ ] **Step 3:** Run `create`. Confirm the clone is post-P0b: `sub_competency_map` has 36 rows, `career_target_requirements` has 35, and `snapshot_target_coverage` is absent.
- [ ] **Step 4:** Commit `chore(p1): scratch clone + guard`.

### Task 2: Migration 0058, verify, rollback, schema

**Files:** `drizzle/0058_competency_catalog_p1.sql`, the verify and rollback SQL, `lib/db/schema.ts`, `tests/db/p1-migration.test.ts`.

- [ ] **Step 1: Write the failing test.** The test is scratch-gated. Each case runs 0058's body (stripped of `BEGIN;`/`COMMIT;`) in `BEGIN … ROLLBACK`. Assert:
  - the tables and columns below exist, with their checks and FKs;
  - every existing `sub_competencies.origin` is `'migrated'`;
  - a second run inside the same transaction raises `0058: already applied`;
  - running the rollback body after the migration body returns the schema to the pre-0058 state. Compare `information_schema` before and after.
- [ ] **Step 2:** Run the test. It is expected to FAIL.
- [ ] **Step 3: Write the migration.**

```sql
-- 0058_competency_catalog_p1.sql — P1: occupation mixes + O*NET reference store + catalog origin.
-- Additive only. Plan: docs/superpowers/plans/2026-10-12-competency-catalog-p1.md
BEGIN;

DO $$ BEGIN
  IF to_regclass('public.career_target_occupations') IS NOT NULL THEN
    RAISE EXCEPTION '0058: already applied';
  END IF;
  IF to_regclass('public.sub_competency_map') IS NULL THEN
    RAISE EXCEPTION '0058: precondition — P0b (0057) is not applied';
  END IF;
END $$;

ALTER TABLE sub_competencies ADD COLUMN origin text NOT NULL DEFAULT 'migrated'
  CHECK (origin IN ('migrated', 'gc_authored', 'onet_seeded'));

CREATE TABLE career_target_occupations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  career_target_id text NOT NULL REFERENCES career_targets(id) ON DELETE CASCADE,
  horizon text NOT NULL CHECK (horizon IN ('entry', 'growth')),
  soc_code text NOT NULL CHECK (soc_code ~ '^[0-9]{2}-[0-9]{4}$'),
  onet_soc_code text CHECK (onet_soc_code IS NULL OR onet_soc_code ~ '^[0-9]{2}-[0-9]{4}\.[0-9]{2}$'),
  onet_status text NOT NULL CHECK (onet_status IN ('rated', 'unrated', 'no_fit')),
  count integer NOT NULL CHECK (count > 0),
  share real NOT NULL CHECK (share > 0 AND share <= 1),
  source text NOT NULL CHECK (source IN ('alumni_rule', 'faculty')),
  source_version text NOT NULL,
  as_of date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((onet_status = 'rated') = (onet_soc_code IS NOT NULL)),
  UNIQUE NULLS NOT DISTINCT (career_target_id, horizon, soc_code, onet_soc_code, source)
);
CREATE INDEX idx_career_target_occupations_target ON career_target_occupations (career_target_id, horizon);

CREATE TABLE onet_release (
  release text PRIMARY KEY,
  published text NOT NULL,
  license text NOT NULL,
  attribution text NOT NULL,
  source_url text NOT NULL,
  loaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE onet_occupations (
  release text NOT NULL REFERENCES onet_release(release) ON DELETE CASCADE,
  onet_soc_code text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  PRIMARY KEY (release, onet_soc_code)
);

CREATE TABLE onet_element_ratings (
  release text NOT NULL,
  onet_soc_code text NOT NULL,
  domain text NOT NULL CHECK (domain IN ('knowledge', 'abilities', 'work_activities', 'essential_skills', 'transferable_skills')),
  element_id text NOT NULL,
  element_name text NOT NULL,
  scale_id text NOT NULL CHECK (scale_id IN ('IM', 'LV')),
  data_value real NOT NULL,
  n integer,
  standard_error real,
  recommend_suppress boolean NOT NULL,
  not_relevant boolean NOT NULL,
  date_text text NOT NULL,
  domain_source text NOT NULL,
  PRIMARY KEY (release, onet_soc_code, domain, element_id, scale_id),
  FOREIGN KEY (release, onet_soc_code) REFERENCES onet_occupations(release, onet_soc_code) ON DELETE CASCADE
);

CREATE TABLE onet_task_statements (
  release text NOT NULL,
  onet_soc_code text NOT NULL,
  task_id text NOT NULL,
  task text NOT NULL,
  task_type text,
  PRIMARY KEY (release, onet_soc_code, task_id),
  FOREIGN KEY (release, onet_soc_code) REFERENCES onet_occupations(release, onet_soc_code) ON DELETE CASCADE
);

CREATE TABLE onet_task_ratings (
  release text NOT NULL,
  onet_soc_code text NOT NULL,
  task_id text NOT NULL,
  scale_id text NOT NULL CHECK (scale_id IN ('IM', 'RT', 'FT')),
  category text NOT NULL DEFAULT '',
  data_value real NOT NULL,
  n integer,
  standard_error real,
  recommend_suppress boolean NOT NULL,
  date_text text NOT NULL,
  domain_source text NOT NULL,
  PRIMARY KEY (release, onet_soc_code, task_id, scale_id, category),
  FOREIGN KEY (release, onet_soc_code, task_id) REFERENCES onet_task_statements(release, onet_soc_code, task_id) ON DELETE CASCADE
);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM sub_competencies WHERE origin <> 'migrated') THEN
    RAISE EXCEPTION '0058: post-check — existing competencies must be origin=migrated';
  END IF;
END $$;

COMMIT;
```

  The implementer checks the empty-string cells in the O*NET CSVs (`Recommend Suppress` blank, `Not Relevant` blank, FT `Category` present only for FT) and makes the loader, not the SQL, map them: blank → `false`/`''`. Postgres 17 supports `UNIQUE NULLS NOT DISTINCT`.

- [ ] **Step 4: Write the verify script.** It runs `\set ON_ERROR_STOP on` and `BEGIN READ ONLY`, and its final `DO` block raises if any expected object is missing or any existing row has an origin other than `'migrated'`.
- [ ] **Step 5: Write the rollback script.** It drops the six tables in dependency order, then `ALTER TABLE sub_competencies DROP COLUMN origin`, all in one transaction. It refuses with `rollback: precondition` if any `gc_authored` or `onet_seeded` competency exists, because those rows would lose their provenance. Remove them first, on purpose.
- [ ] **Step 6: Update the Drizzle schema** in `lib/db/schema.ts` to mirror the new tables and the column. Export names: `careerTargetOccupations`, `onetRelease`, `onetOccupations`, `onetElementRatings`, `onetTaskStatements`, `onetTaskRatings`, and `subCompetencies.origin`.
- [ ] **Step 7:** Run the test (expect PASS), `tsc`, and the full suite with DATABASE_URL unset. Then apply 0058 for real to `gc_curriculum_p1_scratch` with `psql -f`, which is allowed on scratch only, and run verify. Commit `feat(db): migration 0058 — occupation mixes, O*NET store, catalog origin`, with a STATE.md Schema entry marked "not applied".

### Task 3: Alumni-mix ingest

**Files:** `lib/careers/alumni-mix.ts`, `scripts/careers/ingest-alumni-mix.ts`, and their tests.

**Interfaces:**
```ts
export interface OccupationMixRow { careerTargetId: string; horizon: 'entry' | 'growth'; socCode: string; onetSocCode: string | null; onetStatus: 'rated' | 'unrated' | 'no_fit'; count: number; share: number; sourceVersion: string; asOf: string }
export function buildOccupationMix(exportJson: unknown, ratedOnetCodes: ReadonlySet<string>): { rows: OccupationMixRow[]; warnings: string[] };
```

- [ ] **Step 1: Write failing unit tests** in `tests/lib/careers/alumni-mix.test.ts`, using small synthetic exports:
  - Ruling 2: label mapping, and refusal on an unknown label.
  - Ruling 3:
    - a rated `.00` maps to `rated`;
    - a SOC without a rated `.00` maps to `unrated`, with a NULL code and no child averaging;
    - an `onet_detail` split across `.00` and `.01` produces two rows whose counts sum to the SOC count;
    - an `onet_detail` entry of `'none'` maps to `no_fit`.
  - Share is count/n, and shares within each (target, horizon) sum to 1 ± 0.001.
  - `source_version` is built from `_stamp`.
  - Refusal when `_stamp`, `entry` or `growth_registrar_era` is missing.
  - The `growth_all_validated` section is ignored.
- [ ] **Step 2:** Implement the pure function. The rated-code set is passed in (built from `knowledge.csv` codes in tests, and from the loaded or CSV-derived set at runtime: the CLI takes `--onet-dir` to build it). Run the tests and confirm PASS.
- [ ] **Step 3: Write a failing DB test** (`tests/db/p1-ingest.test.ts`, scratch-gated, rolled-back transaction). The CLI's write function must:
  - replace `alumni_rule` rows;
  - leave a pre-inserted `faculty` row untouched;
  - change nothing on a second run with the same version;
  - refuse unless `current_database()` equals `--expect-db`.
- [ ] **Step 4:** Implement the CLI. `--dry-run` prints the per-target mix and writes nothing. Run the tests and confirm PASS.
- [ ] **Step 5:** Run it against the real export: `--file /Users/admin/projects/gc_alumni/exports/career_demand.json --onet-dir scratch/onet/31.0 --expect-db gc_curriculum_p1_scratch`. Record in the report:
  - the row counts per target and horizon;
  - the unrated share per target.
- [ ] **Step 6:** Commit `feat(careers): alumni occupation-mix ingest`.

### Task 4: O*NET loader and occupation report

**Files:** `lib/onet/load.ts`, `scripts/onet/load-onet.ts`, `scripts/careers/occupation-report.ts`, and their tests.

- [ ] **Step 1: Write failing unit tests** for the CSV parsing:
  - Header checking: a missing or renamed column fails loudly, naming the file and column.
  - Blank `Recommend Suppress` and `Not Relevant` become `false`.
  - `FT` category is kept; other scales use category `''`.
  - Filtering to a code set.
  - Mapping files to domains: `knowledge.csv` → knowledge, `abilities.csv` → abilities, `work_activities.csv` → work_activities, `essential_skills.csv` → essential_skills, `transferable_skills.csv` → transferable_skills.
  - Only scales IM and LV are kept for elements; IM, RT and FT for tasks. Other scales are skipped, with their count reported.
  - Use small fixture CSVs, committed under `tests/fixtures/onet/`. They must contain fewer than 20 rows each, all synthetic: no real O*NET text beyond element names.
- [ ] **Step 2:** Implement the parser and loader. The loader:
  - upserts `onet_release` (published "August 2026", license "CC BY 4.0", the attribution text from Global Constraints, source_url `https://www.onetcenter.org/database.html`);
  - reads the rated codes from `career_target_occupations`;
  - loads occupations, element ratings, task statements and task ratings for those codes;
  - deletes and reinserts per (release, code) in one transaction, so a re-run is idempotent;
  - requires `--expect-db`;
  - prints row counts in `--dry-run` mode.
- [ ] **Step 3: Write a DB test**, scratch-gated, with fixture CSVs. Check that:
  - a re-run leaves the row counts unchanged;
  - an occupation not in the mix is not loaded;
  - an unrated mix row loads nothing.
- [ ] **Step 4: Write `occupation-report.ts`** (read-only). For each target and horizon, it prints the mix rows (SOC, O*NET code, title, status, share) and the unrated plus no-fit share. It also prints the top 15 elements by Σ(share × rescaled IM), where rescaled IM = (IM − 1)/4 per spec §5.4. Only rated rows count, and `recommend_suppress` rows are skipped and counted. It ends with the attribution. Unit-test the scoring helper; make it a pure function.
- [ ] **Step 5:** Run the real load on the scratch database (`--dir scratch/onet/31.0 --release 31.0 --expect-db gc_curriculum_p1_scratch`), then run the report. Paste the report output into the task report; the owner reviews it.
- [ ] **Step 6:** Commit `feat(onet): 31.0 reference store loader + occupation report`.

### Task 5: Business-acumen competencies

**STOP until the owner has approved `docs/superpowers/specs/2026-10-12-business-acumen-competencies.json`.** The controller drafts it and gets approval in conversation. The file holds an array of `{ id, name, knowDescriptor, understandDescriptor, doDescriptor, rationale }`.

- [ ] **Step 1: Write a failing test**, scratch-gated, rolled back. It checks that `insert-business-acumen.ts`'s write function:
  - inserts each competency with `origin = 'gc_authored'`, `retired = false` and no requirement rows (unlinked);
  - refuses an id that already exists (no silent overwrite);
  - refuses a malformed entry;
  - requires `--expect-db`.
- [ ] **Step 2:** Implement it, using the existing catalog insert path if one fits; otherwise write a minimal insert with the same column set. Run it on scratch, run the Task 4 target-batch dry run (`scripts/targets/apply-target-batch.ts --dry-run`), and confirm it reports the new ids as **unlinked** and makes no changes.
- [ ] **Step 3:** Commit `feat(catalog): business-acumen competencies (unlinked, gc_authored)`.

### Task 6: Verification and STATE.md

- [ ] **Step 1:** Run the full suite, `tsc`, eslint on the changed files, and `next build` with DATABASE_URL set to the scratch URL. Confirm that the P0b characterization test still passes. It runs only against `gc_curriculum_p0b_scratch`; if that database still exists, run it there. Otherwise, record that it was skipped.
- [ ] **Step 2:** Update STATE.md:
  - 0058 is built, not applied;
  - the three CLIs and the report, with their exact commands;
  - the owner decision "links before weights";
  - the O*NET attribution requirement;
  - Deferred/debt: when the gc_alumni "All Other" recoding batch lands, re-run the ingest (it is idempotent per `source_version`). Weights and depths wait on P2.

### Task 7: Hostile review, then STOP: ask owner

- [ ] **Hostile review.** A fresh-context reviewer, using scratch only, iterates until an honest ACCEPT. It attacks:
  - the SOC → O*NET rule against the real export;
  - share sums;
  - idempotence;
  - faculty-row preservation;
  - loader header drift;
  - the rollback precondition;
  - the additive-migration claim (the running code is unaffected).

  Then run the final whole-branch review.
- [ ] **STOP: ask owner.** Get a separate go-ahead for each step:
  1. merge and deploy;
  2. apply 0058 live (backup → apply → verify; no app stop needed);
  3. run the ingest live;
  4. run the O*NET load live;
  5. insert the business-acumen competencies live.

  Then run the occupation report against live and update STATE.md.
