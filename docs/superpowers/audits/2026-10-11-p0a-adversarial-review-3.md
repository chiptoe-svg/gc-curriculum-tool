# Adversarial review, round 3: competency catalog P0a (branch `feat/competency-catalog-p0a`, HEAD c77f69a)

Reviewer: fresh-context hostile review, round 3. Date: 2026-10-11. Fix diff reviewed: `b65357f..c77f69a`. Whole branch: `42e2211..c77f69a`.

**Safety statement.** Every DB command used the URL from `$(scripts/migrations/p0a-scratch-db.sh url)`. The live DB `gc_curriculum` was never connected to. `.env.local` was never read. No `launchctl` was run. The app, the watchdog and the -deploy checkout were not touched.

**How the wrapper was tested.** `2026-10-11-p0a-live-apply.sh` was run only as a **copy** in my own scratch subdirectory. In that copy, the hardcoded -deploy default was rewritten (sed) to point at a throwaway git repo. Every other path was overridden, `HOME` was a temp dir, and `launchctl`, `lsof` and `pnpm` were PATH stubs. The real `p0a-apply-db.sh` and `p0a-db-migrated.sh` were used in one scenario, against scratch only.

**Notation.** `$S` is my scratch subdirectory, which I deleted at the end. `$P` is `/Applications/Postgres.app/Contents/Versions/17/bin/psql`.

**Verdict: ACCEPT.** Every round-2 finding (I-2, M-a to M-e) is fixed, and I verified each one by running it. The exception is M-e, which is only partly fixed (see M-j). The I-2 scenarios that were plausible all now print the true state and the right recovery. These include the session-guard refusal in rollback mode, which recreated I-1 in round 2.

I found 8 Minor findings and no Important ones. Two of the Minors, M-g and M-h, are residual "asserted, not verified" state reports in the trap. Each can still print a false state and the I-1-recreating recovery. But each needs a precondition that is implausible during the supervised apply: a Ctrl-C in a ~30 ms window, or a `DATABASE_URL` pointing at the wrong database. Each fix is about one line. I recommend doing both before the live apply, but they are not grounds to REJECT.

---

## Scratch DB state after the review

- **Starting fingerprint** (md5 over every row, per table):

  | Table | Rows | md5 |
  |---|---|---|
  | `snapshot_target_coverage` | 764 | `15d1e249…` |
  | `snapshot_competency_coverage` | 764 | `e6f3dc98…` |
  | `career_target_requirements` | 36 | `4ab044fd…` |
  | `sub_competencies` | 36 | `c515df7b…` |
  | `career_targets` | 5 | `456c7f7f…` |
  | `prerequisite_edges` | 3 | `b1c186bf…` |
  | `course_intended_coverage` | 162 | `b540a171…` |
  | `faculty_flags` | 0 | (empty) |

  Distinct snapshots: 23. Other sessions: 0.
- **Restoring after the cycles.** Scratch went through about five rollback/apply cycles: two real `p0a-apply-db.sh` rollbacks from a copied tree, the real-psql Ctrl-C reproduction, and the gated migration and apply-db tests. Before starting, I saved `career_target_requirements.id/created_at/updated_at` by natural key (`career_target_id, competency_id, horizon, weight_source`). At the end I restored all 36 rows.
- **Ending state.** The ending fingerprint is **byte-identical to the starting one on every table**. Scratch is MIGRATED, has 0 other sessions, and characterization against `golden-final.json` passes 1/1 after the restore.
- **Worktree.** HEAD is c77f69a and `git status` is empty. I created one temporary probe (`lib/zz-adv3-probe.ts`) and deleted it. All my files were under `$S`, and I deleted only that directory.
- **Housekeeping slip, disclosed.** One command needlessly ran `sed … > /tmp/x` and `rm -f /tmp/x`. `/tmp/x` is a pre-existing directory, so both commands failed with "is a directory". Nothing was created or removed there.

---

## Round-2 findings: verified by running

| Finding | Status | Evidence (run by me) |
|---|---|---|
| **I-2** wrapper failure paths | **Fixed for every plausible path; residual gaps in M-g and M-h** | **Rollback mode, DB step refuses** (round 2's I-1 recreation). I used a stub `apply-db` that printed the real "other sessions are connected … nothing touched" refusal, and the DB state was "migrated". The output was `Queried database state: migrated=t … (for <pre-sha>, expects migrated=f) does NOT match the database. Do not bootstrap that build … checkout <P0a sha> && pnpm build`. That is the correct recovery: the P0a build against the migrated DB. **Apply mode, DB step fails before COMMIT:** "does NOT match … restore previous". **State query fails:** the conservative branch. **Read-env failure:** "STOPPED … UNTOUCHED", with the previous SHA printed. **Happy path:** build, bootout ×2, apply-db, bootstrap app, bootstrap watchdog, and the smoke-test text. **App bootstrap command fails:** handled in the `restarting-app` branch. **SIGTERM during the build:** exit 143, `pre-stop` branch. **Previous SHA:** `HEAD@{1}` gave the right previous commit. A redundant re-checkout of the same commit does **not** add a reflog entry (checked), so a careful owner who re-checks out the deploy SHA before a retry still gets the right previous SHA. The committed wrapper test passes 17/17. |
| **M-a** verify fails closed | **Fixed** | I copied the tree with 0056 replaced by `SELECT 1;` and ran it against scratch. (1) A verify SQL with a `1/0` second statement gave rc=3 (round 2 got rc=0). (2) The real verify SQL with `view rows with no identical old row (expect 0 right after apply)` forced to 1 gave `VERIFY FAILED: … = 1` and rc=1. That row was unenforced in round 2. (3) The real verify SQL with one row removed gave `expected 18 verify rows, got 17` and rc=1. (4) The unmodified verify SQL gave rc=0. All 18 rows of the real verify output are either enforced or informational (I listed them). |
| **M-b** SHA ↔ mode | **Fixed** | The committed test refuses a pre-P0a SHA with `apply`, a post-P0a SHA with `rollback`, and a post-P0a SHA whose 0056 was tampered. In each case `launchctl` and `pnpm` are never called. The guard sits before any side effect. In rollback mode the wrapper states where the rollback SQL is read from: the script tree, since the pre-P0a SHA has none. |
| **M-c** raw-SQL guard | **Fixed (residual gap in M-n)** | I planted round 2's six shapes in `lib/zz-adv3-probe.ts`. Both guard tests failed, each flagging the probe, and every shape matched on its own. The seed script no longer reads the mirror: it now checks `NOT EXISTS` against `career_target_requirements` for another target, and its exclusion is gone. |
| **M-d** backup verifier | **Fixed** | A real `pg_dump -Fc -s` of scratch was refused ("no TABLE DATA for 'sub_competencies'"). So were a real `-t career_targets` dump, a real `--exclude-table-data=snapshot_target_coverage` dump, and an empty file. A real full dump passes in rollback mode. The committed tests use real dumps. |
| **M-e** URL off argv, umask | **Partly fixed, see M-j** | `p0a-apply-db.sh` now takes the URL from the environment and runs psql/pg_dump with no connection argument. `umask 077` is set, and every dump file was created `-rw-------`. However, the URL is still on **node's** argv for the parse step (M-j). |

**Syntax.** `bash -n` passes on all four scripts. The machine has bash 3.2.57. shellcheck is **not installed** (`npx --no-install` has no package either), so it was not run.

**Regressions.**
- The gated migration test passes 9/9.
- The gated apply-db test passes 9/9, with `P0A_GOLDEN`, so it also runs characterization.
- Characterization against `golden-final.json` passes 1/1, both after the cycles and again after the restore.
- The guards pass 4/4 and the wrapper test 17/17.
- The **full vitest suite** (scratch URL) passes: 423 files and 2942 tests, with 1 file and 16 tests skipped (the gated files).
- `tsc --noEmit` is clean. `eslint` is clean on the changed TS files.
- I did not re-run `next build`, because round 2 changed no app or lib code. The only TS changes are in `scripts/seed-career-targets.ts` and the tests.

**Live defaults when no override is set.** I diffed against b65357f: `DEPLOY_DIR`, `APPLY_DB_SH`, `BACKUP_DIR`, both plists, the read-env path and the 1 s poll interval are identical. The 30-iteration caps are hardcoded, and so are the expected DB name `gc_curriculum` and the launchctl labels. An override changes where the wrapper looks, never what it checks. **Overrides do not weaken the live defaults.**

**Trap mechanics.**
- One `EXIT` trap is used. `INT` and `TERM` are routed through `exit 130` and `exit 143`, and a `set -e` failure also reaches the `EXIT` trap.
- Subshells and command substitutions reset caught traps, so `on_exit` never runs twice.
- `$?` is the first statement in `on_exit`.
- Rollback mode's `[ "$MODE" = apply ] && …` is safe under `set -e`, because it is not the last command in an AND list. I exercised this.
- SIGHUP is not trapped: see M-l.

---

## Findings

No Important findings.

### Minor findings

**M-g. The `db-attempt` phase still *asserts* "database UNTOUCHED" instead of querying. A signal that lands after COMMIT prints a false state and the I-1-recreating recovery.**

The trap queries the database only in `db-done`. `PHASE=db-attempt` covers the whole `p0a-apply-db.sh` run, including the moments after 0056's COMMIT, while the verify runs.

*Reproduction with real psql, on scratch.* I copied the tree with `SELECT pg_sleep(8);` prepended to the verify SQL, so the window is wide enough to hit. I ran `p0a-apply-db.sh … rollback`, then `apply`, and sent SIGINT to the **process group** (as a terminal Ctrl-C does) while the verify was sleeping. Observed: `Cancel request sent`, `ERROR: canceling statement due to user request`, apply-db died on the signal, and `p0a-db-migrated.sh` then printed **`t`**. So the migration had committed.

*Reproduction through the wrapper copy.* A stub apply-db "commits" and then waits in verify. Ctrl-C to the group gave:

```
… at phase: db-attempt ===
The app and watchdog are STOPPED. The database step was never reached (or never returned), so the database is UNTOUCHED …
  (b) restore the previous build first … checkout <pre-P0a sha> && pnpm build … launchctl bootstrap …
```

The actual state was MIGRATED. Recovery (b) is round-1 I-1: old code against the migrated DB. SIGHUP behaves the same way (the `EXIT` trap fired with phase `db-attempt`).

*Why this is Minor.* Without the artificial sleep, the real verify takes **0.029 s**. The window between COMMIT and apply-db exiting is about 30 ms, and only the less likely option, (b), leads to harm. STATE.md item (13) says the trap "past the point the DB step is attempted, queries the ACTUAL database state". That is not true for this phase.

*Fix (one line).* Treat `db-attempt` like `db-done` once `DATABASE_URL` has been read: run `p0a-db-migrated.sh` from the trap. If the query fails, use the conservative branch. Correct the STATE.md sentence.

**M-h. `p0a-db-migrated.sh` does not check which database it is connected to. When read-env returns a non-live URL, the recovery advice comes from the wrong database and can say "SAFE".**

Reproduction: the wrapper copy, with a read-env stub returning the **scratch** URL, plus the **real** `p0a-apply-db.sh` and the **real** `p0a-db-migrated.sh`, in apply mode. Observed:

```
refusing: connected to database 'gc_curriculum_p0a_scratch', expected 'gc_curriculum'; nothing touched
… at phase: db-done ===
The database step returned failure. Queried database state: migrated=t.
That matches what apply's build … expects — … it should be SAFE to bootstrap the current build
```

In apply mode, that advice starts the P0a build against an *unmigrated* live DB. That is an outage, not data loss. In rollback mode, with the other database rolled back, it would say SAFE to start pre-P0a code on a migrated live DB, which is I-1.

*Why this is Minor.* The precondition is the one the name guard exists for: `@next/env` lets an exported shell `DATABASE_URL` override `.env.local`. I checked, and no login shell here exports `DATABASE_URL` (count 0), and round 2 confirmed that read-env on -deploy yields `gc_curriculum`.

*Fix.* Have `p0a-db-migrated.sh` take the expected DB name, and print `t`/`f` only when `current_database()` matches it, otherwise exit non-zero. The wrapper passes `gc_curriculum`.

**M-i. After a post-COMMIT verify failure, the wrapper says "SAFE to bootstrap", directly below apply-db's "do not deploy".**

Reproduction: a stub apply-db printed the real `refusing: verify found a problem above; the migration already committed — do not deploy` and exited 1, with the state migrated. The wrapper then printed `… it should be SAFE to bootstrap the current build`. The committed test `DB step fails but the DB already matches the new build — safe-to-bootstrap message (the M-a "already committed" case)` asserts exactly this contradiction.

*Why this is Minor.* The in-transaction post-checks make a committed-but-inconsistent state very unlikely. Starting the new code does not destroy the backup table, and the rollback rebuilds from `snapshot_competency_coverage`, which the new code writes to.

*Fix.* apply-db exits with a distinct code (for example 4) for "committed but verify failed". The wrapper then says "the schema matches the build, but verify failed: investigate first, or roll back" instead of SAFE.

**M-j. M-e is only partly fixed: the URL, password included, is still on `node`'s argv.**

Both `p0a-apply-db.sh` and `p0a-db-migrated.sh` parse the URL with `node -e '…' "$DATABASE_URL"`.

Reproduction: I polled `ps -ww -axo args` (with the URL redacted before printing) during five guard-refused runs against scratch. It caught **7 samples** of `node -e … new URL(process.argv[1]) … postgres://…` coming from `p0a-apply-db.sh`. The window is the node lifetime, tens of ms per call. On this single-owner Mac this is hygiene, not a leak.

Observation, out of scope: `p0a-scratch-db.sh`'s `with_db` passes the **live** URL on node's argv the same way.

Error paths and output: psql and pg_dump connection errors show host, port and user only, and no output file of mine contained `postgres`. No script uses `set -x`. An owner running `bash -x` on the wrapper would print the `DATABASE_URL=` assignment, which is owner-induced.

*Fix.* Read the URL from the environment inside node: `new URL(process.env.DATABASE_URL)`.

**M-k. The stop-wait fails open if `lsof` is missing, and bootout failures are swallowed.**

`lsof` lives at `/usr/sbin/lsof`. With a PATH that lacks `/usr/sbin`, `lsof … >/dev/null 2>&1` returns 127 (I checked). `while lsof …` then ends at once and prints "confirmed: nothing listens on :3000". Both bootouts are `2>/dev/null || true`.

Getting from here to I-1 needs a silent bootout failure *and* a missing `lsof` *and* the app holding no pooled connection at the moment the session guard runs. The watchdog cannot restart a booted-out app: it only `kickstart`s, and I checked `scripts/watchdog/dev-server-watchdog.sh`.

*Fix.* Call `/usr/sbin/lsof` by absolute path, or treat any exit code other than 0 or 1 as a failure. For the app, print the bootout result instead of discarding it.

**M-l. Some messages overstate what happened, and there is no persistent log.**

- **Build failure or interruption** (`pre-stop`). The message says "Nothing was stopped and nothing was touched … still running whatever they were running". But `pnpm build` rewrites the deploy `.next` under the running server. Next 15 also cleans the build directory at the start of a build, which I did not verify here. This is the existing deploy-chain behavior and does not involve the DB.
- **Re-run after a `stopped` failure.** The `pre-stop` message claims the app "is still running", but an earlier invocation stopped it.
- **`:3000` still listening.** The `stopped` branch says "The app and watchdog are STOPPED", yet something is still on `:3000`.
- **App `bootstrap` command fails.** This is reported as "did not come up within the timeout". I reproduced it: exit 5, `restarting-app`. The recovery is still right.
- **No log, SIGHUP not trapped.** Output goes only to the terminal, and SIGHUP is not trapped. On a dropped SSH session, or a harness timeout that kills the run, nothing records where it stopped. An orphaned apply-db also keeps running after a SIGKILL of the wrapper. In that case the app stays stopped, which is safe.

*Fix.* Tee all output to `$BACKUP_DIR/live-apply-<ts>.log`, trap HUP, and adjust the wording above. **Operational note for whoever runs it:** run it with a timeout long enough for `pnpm build` (several minutes), or in the background, not under a 2-minute tool default.

**M-m. The previous SHA is not validated.**

The 3rd-argument override is used verbatim in the printed `git checkout` command: there is no 40-character check and no `cat-file -e`. The `HEAD@{1}` value is not checked to differ from `DEPLOY_SHA`, or to have the opposite 0056-presence from the mode. A wrong previous SHA turns the "restore previous build" recovery into another build/DB mismatch. The SHA is printed at the start, so the owner can catch it.

*Fix.* Apply M-b's check to `PREVIOUS_SHA`: it must exist, must differ from `DEPLOY_SHA`, and must contain 0056 in rollback mode and lack it in apply mode. If any check fails, print "unknown".

**M-n. The raw-SQL guard has residual heuristic gaps.**

Schema-qualified names (`FROM public.snapshot_target_coverage`) do not match `\s+"?snapshot_target_coverage`. The 200-character bound is the gap the fix report already discloses. This is a static heuristic, and no tracked code does any of this today.

---

## Items checked with no finding

- **Backup before apply, the right DB, no other sessions.** The guard order in `p0a-apply-db.sh` is unchanged: DB name, then sessions, then `pg_dump -Fc` (under `set -e`), then the M-d verifier, then apply. No path reaches the SQL without a verified, data-bearing archive.
- **The app is stopped at apply time.** The bootouts and the `:3000` check run before the DB step, with the M-k caveat. The watchdog only kickstarts, so it cannot revive a booted-out service.
- **The wrong SHA.** The checkout must be clean and HEAD must equal `DEPLOY_SHA`. M-b covers SHA ↔ mode and the byte-equality of 0056.
- **Seed-script guard change (M-c).** In P0a every competency has exactly one requirement (verify: "competencies with no membership" = 0, and the new code inserts the catalog row and the requirement in one transaction). So `NOT EXISTS` on another target's requirement is equivalent to the old mirror check, and the script no longer reads the deprecated column.
- **Wrapper test safety.** The stubs come first on `PATH`, and `HOME` is a temp dir, so the default read-env path does not exist and the real apply-db can never get a URL. The temp dir is removed in `afterAll`.
- **Backup-dir permissions.** The default `~/.local/share/gc-curriculum-tool/p0a` already exists as 755, so `umask 077` does not change it. Dump files are 600, so only file names are visible. Trivial.

---

## Recommended before the live apply (not blocking)

1. **M-g:** query the DB state in the `db-attempt` branch too, and fix the STATE.md (13) sentence.
2. **M-h:** pass the expected DB name to `p0a-db-migrated.sh` and refuse on a mismatch.
3. **M-l (operational):** tee to a log file, and run the wrapper with a timeout long enough for the build.

The rest (M-i, M-j, M-k, M-m, M-n) can go to STATE Deferred/debt with a pointer to this report.

**Verdict: ACCEPT.**
