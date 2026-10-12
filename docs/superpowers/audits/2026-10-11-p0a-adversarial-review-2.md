# Adversarial review, round 2: competency catalog P0a (branch `feat/competency-catalog-p0a`, HEAD b65357f)

Reviewer: fresh-context hostile review, round 2. Date: 2026-10-11. Fix diff reviewed: `44acfea..b65357f` (whole branch `42e2211..b65357f`).
Every DB command ran against the scratch DB `gc_curriculum_p0a_scratch` with the URL from `$(scripts/migrations/p0a-scratch-db.sh url)`, written below as `$U`. The live DB `gc_curriculum` was never connected to. `2026-10-11-p0a-live-apply.sh` was never executed against real services: it was run only as a **copy** whose `DEPLOY_DIR` pointed at a throwaway git repo, with `launchctl`, `lsof`, `pnpm`, `node` and `p0a-apply-db.sh` replaced by logging stubs on `PATH`. No launchctl was run, and the app, the watchdog and the -deploy checkout were not touched. The only read in -deploy: `read-env.mjs` was run once, and its output was piped into a node one-liner that printed only two booleans (see "Items checked"). `$S` is my scratchpad. `$P` is `/Applications/Postgres.app/Contents/Versions/17/bin/psql`.

**Verdict: REJECT.** The round-1 findings are fixed, and I verified each fix by running it (details below). But the new runbook has one Important defect (I-2): after any failure past step (a), its recovery instructions restart code that does not match the database's schema. In rollback mode, following them recreates the round-1 I-1 data-loss hazard. The fix is small and touches only the wrapper's messages and guards. The migration, the rollback, the DB-half script and the code changes all held up.

---

## Scratch DB state after the review

- Starting fingerprint (md5 over every row, by table): `snapshot_target_coverage` 764, `snapshot_competency_coverage` 764, `career_target_requirements` 36, `sub_competencies` 36, `career_targets` 5, `prerequisite_edges` 3, `course_intended_coverage` 162, `faculty_flags` 0, distinct snapshots 23.
- During the review, scratch went through about six rollback/apply cycles: the real `p0a-apply-db.sh` in both modes, the M-1 red/green demonstrations, the gated migration test and the gated apply-db test. Each cycle regenerates `career_target_requirements.id`/`created_at`/`updated_at`. Before starting I saved those three columns by natural key (`career_target_id, competency_id, horizon, weight_source`). At the end I restored them from the copy (36/36 rows).
- **Ending fingerprint is byte-identical to the starting one, on every table, including `career_target_requirements`.** Scratch is MIGRATED (`snapshot_competency_coverage` exists), there are 0 other sessions, and characterization against `golden-final.json` passes (1/1).
- Worktree: `git status` is empty and HEAD is b65357f. I created one temporary probe file (`lib/zz-adv2-probe.ts`) and deleted it. All dumps, harness files and SQL copies in `$S` were deleted. Housekeeping caveat: I cleaned `$S` with the globs `*.sql` and `*.out`. That scratchpad is shared with the parent session, so any parent-owned `.sql`/`.out` file there would also have been removed. I did not list those files before deleting.

---

## Round-1 findings: verified fixed by running

| Finding | Status | Evidence (run by me) |
|---|---|---|
| **I-1** runbook | **Core fixed; new defect I-2 below** | The order is now: build → bootout watchdog → bootout app → wait for :3000 to close → DB-name guard → session guard → verified `-Fc` backup → apply → verify → bootstrap. In the stub harness, the success path logged exactly `pnpm build` (in the deploy dir), `bootout dev-watchdog`, `bootout curriculum-tool`, `read-env`, `apply-db gc_curriculum … apply`, `bootstrap curriculum-tool.plist`, `bootstrap dev-watchdog.plist`. There is no window where old code runs on a migrated DB in the success path. Round-1 item 5 (the empty backup) is closed: `p0a-verify-backup.sh` refuses an empty file, a gzip of garbage, and a missing file. A **real** `-Fc` archive containing only `career_targets` is refused with `does not list table 'sub_competencies'`. A real 2-table archive is refused in rollback mode with `does not list table 'snapshot_competency_coverage'`. Round-1 item 6 (wrong DB / other sessions) is closed: the gated test passes, and the guards come before any write. |
| **M-1** lock | **Fixed, demonstrated with two sessions** | Scratch was rolled back with the real `p0a-apply-db.sh … rollback`. Session A applied a copy of 0056 with `SELECT pg_sleep(8);` inserted before `COMMIT;`. Session B waited 3 s, then ran with `lock_timeout='2s'`: a reader `SELECT count(*)`, then `BEGIN; UPDATE snapshot_target_coverage … ; ROLLBACK`, then `BEGIN; DELETE FROM snapshot_target_coverage … ; ROLLBACK`. **Red, base `44acfea` 0056 (no lock):** `UPDATE stc went through (not blocked)` and `DELETE stc went through (not blocked)`. **Green, HEAD 0056:** reader `764` (not blocked). UPDATE gave `ERROR: canceling statement due to lock timeout`, and so did DELETE. During the sleep, `pg_locks` showed A holding `snapshot_target_coverage=ShareRowExclusiveLock` and `sub_competencies=ShareRowExclusiveLock`, `AccessExclusiveLock`. B's writes were inside rolled-back transactions, so nothing changed. The rollback's lock (`snapshot_competency_coverage, career_target_requirements, sub_competencies`) comes after the existence check and before every data-reading check, and the gated tests pass with it. `snapshot_target_coverage` is not locked by the rollback. That is acceptable: the rollback's `DELETE` row-locks every existing row, and a concurrent new row is caught by the row-count post-check or survives harmlessly into what is then the authoritative table. |
| **M-2** full-row guard | **Fixed** | The guard compares all 9 non-key columns of `snapshot_competency_coverage` (`k_depth, u_depth, d_depth, matched_competency, evidence_excerpt, confidence, rationale, model, generated_at`) with `IS DISTINCT FROM`. That is every column of the table (checked with `information_schema.columns`), and it keeps both existence directions. `career_target_id` exists only on the backup table and is covered by precondition 1. The message is neutral. The gated migration test passes (9/9), including the depth-only case 1c. |
| **M-3** ordering | **Fixed** | Both refresh routes and `loadTargetSubstrate` now have `.orderBy(asc(displayOrder), asc(id))`. I listed every `from(targetSubCompetencies)` read. The remaining unordered ones are single-row lookups (`getTargetCompetency`, the read-back in `insertCompetencyForTarget`) and `getMatrixData`, which round 1 already cleared because it sorts downstream. The affected test files pass (25 files, 191 tests), `tsc --noEmit` is clean, and characterization passes, so there is no golden regression. |
| **M-4** guard | **Partially fixed, see M-c** | The two one-off scripts are in the STATE list. The new raw-SQL guard is shallow (M-c). |
| **M-5** seed | **Fixed** | `WHERE EXISTS` plus one transaction per target. Within a fresh seed the requirement still fires, because the sub-competency insert earlier in the same transaction is visible to it. A side effect is recorded in M-c. |
| **M-6** | Deferred to STATE as instructed | Present in STATE Deferred/debt item (12). |

---

## Findings

### I-2 (Important): after a failure, the runbook's recovery instructions restart code that does not match the database. In rollback mode they recreate I-1.

Step (a) runs `pnpm build` in `/Users/admin/projects/curriculum_developer-deploy` **before** anything is stopped. From then on, the deploy checkout's `.next` holds the build for `<deploy_sha>`. `com.gc.curriculum-tool` runs `pnpm start:local` with `WorkingDirectory` set to that checkout, so it serves that build. Any failure after step (a) leaves the DB in the *old* state, while the only build on disk expects the *new* state. The wrapper's failure message then says:

```
DB apply FAILED (exit 1). The app and the watchdog are STOPPED. The
database was left AS-IS — 0056 and its rollback each run as one
transaction, so a failure here changed nothing in the database. Nothing
was restarted automatically. Restart only once you understand why this
failed:
  launchctl bootstrap gui/501 /Users/admin/Library/LaunchAgents/com.gc.curriculum-tool.plist
  launchctl bootstrap gui/501 /Users/admin/Library/LaunchAgents/com.gc.dev-watchdog.plist
```

(This is the observed output of the stub harness, scenario "apply-db exits 1". The calls log shows the build ran first: `pnpm build (cwd=<deploy>)`.)

- **Rollback mode.** `<deploy_sha>` is the pre-P0a commit. If `p0a-apply-db.sh … rollback` refuses, the DB is still **migrated**. The printed `bootstrap` then starts the **old** build against the migrated DB. That is round-1 I-1, which I reproduced again here: old-code creates and reorders are invisible to the new schema, and coverage writes go to the frozen backup table. Those writes are lost on the next re-deploy of the new code, and lost again by the rollback when it finally runs. Likely triggers include the other-sessions guard (for example `com.gc.pg-backup` or `com.gc.cost-cap-check` firing, an open psql, or Drizzle Studio) and any of the rollback's own refusals ("a competency has no owning target", "a coverage row has no target membership"). These are exactly the moments an owner is likely to just restart.
- **Apply mode.** The printed restart starts the **new** build against an **unmigrated** DB. Every read of `target_sub_competencies` and `target_coverage` fails, so production is down. No data is lost, but "restart" does not restore the previous state, as the message implies. The previous build no longer exists on disk.
- **The message is also false for one failure path.** `p0a-apply-db.sh` fails *after* COMMIT when verify finds a non-zero row, and it prints "the migration already committed". The wrapper then prints "a failure here changed nothing in the database" directly below it.
- **Some failure paths print nothing about state.** Examples are `read-env.mjs` failing after the stop, Ctrl-C during apply, and the `:3000` wait timing out. For the read-env case the harness output is just `DATABASE_URL not set` and exit 1, with the app and watchdog already booted out. The lsof timeout says "the database was NOT touched" but gives no restart guidance, and restarting would again run the step-(a) build.

**Fix (small, wrapper only):**
1. Take a `<previous_sha>` argument, or record `git -C deploy rev-parse HEAD@{1}`. Better still, have the owner pass both SHAs.
2. Install a `trap … EXIT` right after step (b). On any non-success exit, query the real DB state (`to_regclass('public.snapshot_competency_coverage') IS NOT NULL`) instead of asserting it.
3. Print the matching recovery. If the DB state matches `<deploy_sha>`, bootstrap. If it does not: `git -C <deploy> checkout <previous_sha> && (cd <deploy> && pnpm build)` first, then bootstrap.
4. Drop the "changed nothing" sentence, or make it conditional on the observed state.

### Minor findings

**M-a. The verify step in `p0a-apply-db.sh` fails open, and 4 of its 18 rows are not enforced.**
- The verify output is read through process substitution: `done < <("${PSQL[@]}" -At -F'|' -f "$VERIFY_SQL")`. `set -e` and `pipefail` do not see the exit status of a process substitution. Reproduction: I made a copy of the script tree in `$S/fake`, with `0056` replaced by `SELECT 1;` (so scratch is untouched) and a verify SQL whose second statement is `1/0`. I ran `$S/fake/scripts/migrations/p0a-apply-db.sh gc_curriculum_p0a_scratch "$U" $S/bk apply`. Observed: `first row (expect 0): 0`, then `ERROR: division by zero`, then `p0a-apply-db.sh: apply on 'gc_curriculum_p0a_scratch' complete` and **`EXIT=0`**. The wrapper would print "DB applied" and restart. A dropped connection after COMMIT behaves the same way: zero rows parsed means a pass.
- Only labels containing the exact substring `(expect 0)` are checked. These rows are never enforced: `view rows with no identical old row (expect 0 right after apply)` (the closing parenthesis is not right after the 0), `requirements (expect = sub_competencies total)`, `snapshot_competency_coverage rows (expect = old)` and `target_coverage rows (expect = old)`. The gated test's assertion loop has the same blind spot and would also pass with zero lines.
- Mitigation: the migration's own in-transaction post-checks cover the first unenforced row and most of the rest, which is why this is Minor.
- Fix: capture the output into a variable with `VERIFY_OUT="$(… )"`, so `set -e` sees psql fail. Assert that 18 rows were parsed. Match `(expect 0` and check the three `(expect =` equalities.

**M-b. The wrapper does not check that `<deploy_sha>` matches the mode, and it applies SQL from its own tree, not from `<deploy_sha>`.**
- Passing the P0a SHA with `rollback`, or a pre-P0a SHA with `apply`, passes every guard. The second combination ends with old code running against a migrated DB, which is I-1 again, *on the success path*.
- The SQL applied is whatever `drizzle/0056…` sits next to the copy of the script being run (the worktree, main or -deploy). It is not necessarily the file at `<deploy_sha>`.
- Fix: for apply, require `git -C <deploy> cat-file -e <sha>:drizzle/0056_competency_catalog_p0a.sql`, and require the absence of that file for rollback. Either `cmp` the script tree's 0056 against `git show <sha>:…`, or require that the script runs from inside `<deploy>`.

**M-c. The M-4 raw-SQL guard is shallow, and its seed-script exclusion is mislabeled.**
- I planted a temporary `lib/zz-adv2-probe.ts` (since deleted) containing six shapes: `JOIN snapshot_target_coverage`, `INSERT INTO snapshot_target_coverage`, `UPDATE snapshot_target_coverage`, `JOIN sub_competencies s ON s.career_target_id`, a two-line `FROM sub_competencies` / `WHERE career_target_id … ORDER BY display_order`, and a quoted `"sub_competencies"`. The guards still passed, 4/4. **None of the six was caught.** Writes into the backup table are the worst of these, because they are exactly the lost-write shape. No tracked code does any of these today; I checked with `git grep`.
- The exclusion comment on `scripts/seed-career-targets.ts` says "intentional raw-SQL write to the deprecated mirror". Line 98 is actually a **read** of the mirror: `SELECT 1 FROM sub_competencies WHERE id = … AND career_target_id = …`. It is the only tracked reader of the deprecated column, which contradicts STATE's "(written, never read)". It is correct in P0a, while the mirror is in sync. P0b must re-point it to `career_target_requirements` before the mirror goes away. The whole-file exclusion also hides any future read added to that file.
- Fix: widen the pattern to `(FROM|JOIN|INTO|UPDATE)[[:space:]]+"?snapshot_target_coverage`, add the seed read to the P0b debt note, and correct the comment.

**M-d. The verifier's table check has no committed test, and it checks schema entries only.**
- The test named "rejects a real archive missing a required table" points `pg_dump` at a nonexistent DB. No file is written, so it exercises the `-s` (missing or empty) branch, not the table grep. The fix report's red-proof also did not disable the table check. I exercised the grep by hand (see M-1's row in the table above), and it works.
- The grep matches `TABLE public <t>`, not `TABLE DATA public <t>`, so a schema-only archive passes. I reproduced this: `pg_dump -Fc -s` of scratch gave `backup verified … (85060 bytes …)` and exit 0. This is not reachable from `p0a-apply-db.sh`, which always dumps data, so it is Minor.
- Fix: match `TABLE DATA public <t>`, and make the test build a real partial archive with `-t career_targets`.

**M-e. Credential hygiene, not a leak.** No path prints the URL. I checked every `echo`, every error message and psql/pg_dump connection-failure text (host, port and user only). However, the live URL, password included, is passed as **argv** to `p0a-apply-db.sh`, `psql` and `pg_dump`, so it is visible in `ps -ww` to any local user while the scripts run. The dump is written under the default umask and only then chmodded to 600, and `mkdir -p` creates the backup dir as 755. Fix: pass the URL in the environment (for example `PGDATABASE`/`PGPASSWORD`, or `DATABASE_URL` read from env inside the script), and set `umask 077` at the top.

**M-f (observation, no action needed before live).** M-3 and M-5 were verified by hand rather than by committed tests, as the fix report itself says. I confirmed both by reading the code and running the affected tests. That is acceptable at their severity.

---

## Items checked with no finding

- **Syntax.** `bash -n` passes on all three scripts, with both `/usr/bin/env bash` and `/bin/bash`. On this machine both are bash 3.2: no `mapfile`, and the array use is safe under `set -u`. shellcheck is **not installed**, so it was not run.
- **`if …; then …; else STATUS=$?`** gives the condition's status in bash 3.2. A probe printed `else-status=7`, so the wrapper reports the correct exit code.
- **Wait loops** time out correctly. Stub `lsof` always listening: `refusing: something is still listening on :3000 after 30s; the database was NOT touched`, exit 1 after 31 s, and `apply-db` was never called. Stub app never listening after bootstrap: `WARNING … the watchdog has NOT been started`, exit 1 after 31 s, and the watchdog was not bootstrapped.
- **Pre-stop guards.** A short SHA was refused (exit 2, nothing called). A bad mode was refused (exit 2). A dirty deploy checkout gave `not clean; nothing stopped, nothing touched` (exit 1). A failing build exits before any stop under `set -e`.
- **Can the migration run without a verified backup, against the wrong DB, or with other sessions connected?** Not through `p0a-apply-db.sh`. The guard order is name → sessions → `pg_dump -Fc` (a failure exits under `set -e`) → `p0a-verify-backup.sh` → apply. The gated test passes 7/7. I also ran the real script by hand: rollback (4 times) and apply (once) on scratch, each with exit 0 and a printed `backup verified …`, and the apply printed all 18 verify rows. Is the app running at the moment of the apply? No: the bootouts plus the `:3000` check run before it, and the session guard would also catch a running app that holds a pool connection.
- **The session guard's time-of-check gap.** Scheduled jobs (`com.gc.pg-backup`, `com.gc.full-backup`, `com.gc.cost-cap-check`) can connect after the guard. A `pg_dump` would only contend for locks. None of these jobs writes the migrated tables, and only the watchdog and `scripts/backup/restore.sh` reference `com.gc.curriculum-tool`. Autovacuum workers on the DB would trip the guard. That is fail-safe and transient.
- **Does `read-env.mjs` against -deploy yield the live URL?** The code calls `loadEnvConfig(dir, dev=false)`, the same loader and mode as `next start`. The deploy dir has only `.env.local` (plus `.env.example` and `.bak` files, which are not loaded), with exactly one `DATABASE_URL=` key. The plist's `EnvironmentVariables` are only `PATH, HOME`, so the running app gets `DATABASE_URL` from that `.env.local`. One read-only run, with the output piped into a node one-liner that printed only booleans, gave `dbname_is_gc_curriculum= true host_is_local= true`. One caveat: `@next/env` lets an exported shell `DATABASE_URL` override `.env.local`. If the owner's shell exports a scratch URL, the DB-name guard refuses, which is fail-safe, but that refusal lands in I-2's failure path.
- **Rollback mode discipline.** It uses the same stop and start, the same guards, and the same backup (with stricter table requirements). It has no post-verify, but the rollback SQL carries its own post-check. Its failure path is covered by I-2.
- **Migration mechanics.** There is no `drizzle/meta/_journal.json` and no `drizzle-kit migrate` in any start path, so nothing can re-apply 0056 automatically.
- **Regressions from the fixes.** Characterization against `golden-final.json` passes 1/1 (before and after my cycles). The gated migration test passes 9/9, the gated apply-db test 7/7 (with `P0A_GOLDEN`, so it also runs characterization), and guards 4/4. The affected route, target and wiki tests pass (25 files, 191 tests), and `tsc --noEmit` is clean. The seed transaction keeps fresh-seed behavior, as described for M-5 above.

---

## Required before the live apply

1. **I-2:** make the wrapper's failure path state-aware: a trap after step (b), the observed DB state, and recovery that rebuilds `<previous_sha>` when the build on disk does not match the DB.
2. **M-a** (cheap, and it is the runbook's own safety check): capture the verify output in a variable and assert the row count.
3. **M-b** (cheap): check that the SHA matches the mode, and that the 0056 being applied is the file at `<deploy_sha>`.

M-c to M-e can go to STATE Deferred/debt with a pointer to this report.

**Verdict: REJECT** (I-2 stands). Re-review once the wrapper's failure path is fixed. The DB-half script, the migration and the code need no further change for ACCEPT beyond M-a.
