# Adversarial review: competency catalog P0a (branch `feat/competency-catalog-p0a`, HEAD 44acfea)

Reviewer: fresh-context hostile review (Task 9). Date: 2026-10-11.
Everything below was run against the scratch DB `gc_curriculum_p0a_scratch` only. The live DB `gc_curriculum` was never connected to. Credentials are never printed: every command gets its URL from `$(scripts/migrations/p0a-scratch-db.sh url)`, written below as `$U`. `PSQL=/Applications/Postgres.app/Contents/Versions/17/bin/psql`. `$S` is the reviewer's scratchpad. `mig.sql` and `rb.sql` are copies of 0056 and the rollback with only their `BEGIN;`/`COMMIT;` lines removed, so each experiment could run inside an outer transaction that I rolled back.

**Verdict: REJECT.** One Important finding stands (I-1: the Task 10 live-apply procedure). The migration, the rollback and the code held up under every attack I tried. The fix is to the runbook, not to the code.

---

## Scratch DB state after the review

- I took a fingerprint (md5 over every row) of `snapshot_target_coverage`, `snapshot_competency_coverage`, `career_target_requirements`, `sub_competencies`, `career_targets`, `prerequisite_edges`, `course_intended_coverage`, `faculty_flags` and the snapshot ids before starting. At the end, every table matches **except `career_target_requirements`**. Its 36 rows have the same content but new `id`/`created_at` values, because one experiment (the concurrency test, below) committed a rollback and a re-apply. This is the same rollback-then-re-apply that `tests/db/p0a-migration.test.ts` does every time it runs.
- The full verify script returns 0 on every "expect 0" row, with 764/764/764 coverage rows and 36 requirements. `tests/db/` against `golden-final.json` at HEAD: 6 files passed, 1 skipped (the gated migration test), 19 tests passed. So **characterization still passes** and the scratch DB is still migrated.
- I created two temporary test files (`tests/db/zz-adv-tmp*.test.ts`) and deleted them afterwards. `git status` is clean. `next build` rewrote the git-ignored `.next/` in the worktree.

---

## Findings

### I-1 (Important): the Task 10 live-apply procedure is incomplete. Old code can keep running against the migrated DB, and the backup can silently be empty

Ruling 12's safety model depends on the app being stopped from the apply until the new code starts. Nothing in Task 10 enforces that, and on this machine the services restart the old code on their own:

1. **There is no stop command.** Step 2 is titled "Stop the app, apply, verify" but contains only the two psql commands. The plan says to stop the app "the way the owner's deploy chain does it". The deploy chain never stops the app. Per memory `feedback_deploy_chain_fail_fast`, it does merge, then `pnpm build`, then `launchctl kickstart -k`, which is a restart.
2. **launchd restarts the old app.** `~/Library/LaunchAgents/com.gc.curriculum-tool.plist` has `KeepAlive=true`, so `launchctl stop` or a kill is undone immediately. `com.gc.dev-watchdog` runs every 5 minutes and runs `launchctl kickstart -k gui/$UID/com.gc.curriculum-tool` whenever `:3000` returns `000` (see `scripts/watchdog/dev-server-watchdog.sh`, `kickstart()`).
3. **The order of steps creates an old-code window.** The plan applies the migration first (Step 2) and deploys afterwards (Step 3). Step 3's deploy runs `pnpm build`, which takes minutes. Throughout that build, the old build is either still serving or gets restarted by the watchdog. All of it runs against the migrated DB.
4. **Writes the old code makes during that window are lost, and the documented rollback would lose them too.** Reproduction, in a rolled-back transaction on the migrated scratch DB:
   ```
   $PSQL "$U" -X -q -v ON_ERROR_STOP=1 <<'EOF'
   BEGIN;
   INSERT INTO sub_competencies (id, career_target_id, name, know_descriptor, understand_descriptor, do_descriptor, display_order, retired)
     VALUES ('zz-old-code-create','ai-workflow','x','k','u','d',11,false);           -- pre-P0a create route
   UPDATE sub_competencies SET display_order = 0 WHERE id='quality-frameworks';       -- pre-P0a reorder route
   SELECT 'visible to new code (target_sub_competencies)' k, count(*) FROM target_sub_competencies WHERE id='zz-old-code-create'
   UNION ALL SELECT 'reorder visible to new code', count(*) FROM target_sub_competencies WHERE id='quality-frameworks' AND display_order=0;
   UPDATE sub_competencies s SET display_order = m.display_order FROM target_sub_competencies m WHERE m.id = s.id AND s.display_order <> m.display_order;  -- rollback's step
   SELECT 'reorder after rollback step', display_order FROM sub_competencies WHERE id='quality-frameworks';
   ROLLBACK;
   EOF
   ```
   Observed:
   ```
   visible to new code (target_sub_competencies) |     0
   reorder visible to new code                   |     0
   reorder after rollback step                   |     6
   ```
   Old-code coverage re-scores and invalidations go to `snapshot_target_coverage`. Nothing reads that table after the cutover, and the rollback deletes and rebuilds it from `snapshot_competency_coverage`. So those writes are lost whichever way the deploy goes. A competency the old code creates in the window has no requirement row, so it never appears in the new code's lists.
5. **The backup in Step 1 can be empty without any error.** It runs `pg_dump … | gzip > file` without `pipefail` and never checks the file. Reproduction, using a nonexistent database:
   ```
   "$PGBIN/pg_dump" --no-owner "<scratch URL with db name gc_adv_nonexistent_db>" 2>/dev/null | gzip > $S/pre-0056-test.sql.gz; echo "pipeline exit=$? size=$(wc -c < $S/pre-0056-test.sql.gz)"
   ```
   Observed: `pipeline exit=0 size= 20 bytes`. That is a valid, empty gzip, and the next step would apply the migration as though a backup existed.
6. **The procedure never checks which database it is pointed at, or who else is connected.** No step asserts `current_database() = 'gc_curriculum'` before applying, and no step checks `pg_stat_activity` for other sessions on that database (a dev server, a one-off script, or a second checkout).

**Does anything touch live before the owner's go-ahead?** No. Task 10 opens with STOP. No other task writes to live. `p0a-scratch-db.sh create` only reads live, through `pg_dump`. The B3 build-time risk is not real (see item 9).

**Recommended fix.** Replace Task 10 Steps 1–3 with a single fail-fast runbook, e.g. `scripts/migrations/2026-10-11-p0a-live-apply.sh`. Plan files are append-only, so do this in a new file and point to it from STATE.md. It should start with `set -euo pipefail` and do the following, in order:
- (a) Build the merged commit in the deploy checkout while the old app keeps serving, as the deploy chain normally does.
- (b) Stop both services so neither can restart the app: `launchctl bootout gui/$UID/com.gc.dev-watchdog`, then `launchctl bootout gui/$UID/com.gc.curriculum-tool`. Confirm `:3000` is closed.
- (c) Check that no other sessions are on `gc_curriculum` (`pg_stat_activity`).
- (d) Take the backup with `pg_dump -Fc -f <file>` and verify it with `pg_restore --list <file> >/dev/null` and a minimum size.
- (e) Apply with a guard that `current_database()` is `gc_curriculum`.
- (f) Run the verify script and fail on any non-zero "expect 0" row.
- (g) Start the app with `launchctl bootstrap` and the new build, then bootstrap the watchdog again.
- (h) Do the smoke test.

Also give the rollback path the same stop-the-app steps.

### Minor findings

**M-1. Migration 0056 has no `LOCK TABLE` (deferred item a). A write committed between the post-checks and `COMMIT` is lost.** Reproduction: on scratch, commit the rollback, then apply a copy of 0056 with `SELECT pg_sleep(8);` added just before `COMMIT;`. While it sleeps, a second session runs
`UPDATE snapshot_target_coverage SET rationale = rationale || ' [concurrent]', generated_at = generated_at + interval '1 second' WHERE snapshot_id='0ce92966-…' AND sub_competency_id='client-needs-diagnosis'`.
Observed: the UPDATE was not blocked. The migration committed. The backup now holds `… [concurrent]` at `17:26:24.537`, while `snapshot_competency_coverage` still holds the old text at `17:26:23.537`, so the write is lost from the authoritative table. With the sleep placed before the post-checks instead, the same write makes the migration abort (`ERROR: 0056: 1 coverage rows did not carry over unchanged`), which is safe.
INSERTs of new cells would be blocked for the whole apply, because the FK check needs a lock on `sub_competencies`, which the ALTER holds exclusively. UPDATE and DELETE on an existing cell are not blocked. I restored the scratch DB afterwards (row reverted, fingerprints equal).
Without the sleep, the unsafe window is microseconds. I-1's app stop removes it entirely.
**Fix before the live apply (one line):** right after `BEGIN;` add `LOCK TABLE snapshot_target_coverage, sub_competencies IN SHARE ROW EXCLUSIVE MODE;`, and add "apply with the app stopped (see runbook)" to the header.

**M-2. The divergence guard checks only `generated_at` and row existence.**
- Changed depths with an unchanged `generated_at` (item 1c) pass the guard. The re-run still refuses, but only at the post-check, with `0056: 1 coverage rows did not carry over unchanged`. Nothing is copied over, so there is no data risk.
- When the *old* code writes the backup after the apply (1g), the error says "the new code has written coverage", which is misleading.
- Fix: compare all columns in the guard (`IS DISTINCT FROM` on the full row), and make the message neutral: "the two coverage tables differ".

Observed for item 1:

| Case | Result |
|---|---|
| 1a: new cell | `diverged` |
| 1b: changed `generated_at` | `diverged` |
| 1c: depths changed only | post-check refusal (above) |
| 1d: deleted cell | `diverged` |
| 1e: no change | runs to the end |
| 1f: competency created and reordered after cutover | re-run changes 0 requirement rows |
| 1g: old code writes the backup after the apply | `diverged` (misleading message) |

**M-3. Two unordered membership reads now feed LLM prompts in a different order.** Two reads have no ORDER BY, so their row order comes from the view's GROUP BY instead of the table's storage order:
- `targetSubCompetencies` in both coverage-refresh routes. This is the `sub_competencies` list in the scorer's prompt.
- The subs read in `loadTargetSubstrate` (`lib/ai/wiki/update.ts:411`). This becomes `coverageRollup`, which feeds the wiki target-page LLM.

Reproduction: `SELECT career_target_id, string_agg(id, ',') FROM (SELECT career_target_id, id FROM sub_competencies) x GROUP BY 1`, and the same query over `target_sub_competencies`. The order differs for all 5 targets. For example, account-management is `client-needs-diagnosis,results-interpretation,…` from the table and `project-oversight,client-needs-diagnosis,…` from the view.

Characterization does not catch this, because the probes `sortJson` these arrays. Neither order was defined before, so this is not a correctness bug. But the prompt input changes, and the scorer output may shift with it. Fix: `.orderBy(asc(displayOrder), asc(id))` on both reads.

**M-4. The one-off-script debt list is incomplete, and the static guard does not cover raw SQL.** Two scripts in the main checkout's `scripts/_one-off/` are missing from the list:
- `pilot-node-enrichment.ts` uses raw SQL. It reads `snapshot_target_coverage` (line 52) and `sub_competencies WHERE career_target_id=… ORDER BY display_order` (line 74), so it keeps running but silently reads the frozen backup and the mirror columns.
- `validate-coverage-fix.ts` uses `subCompetencies.careerTargetId` (line 36), which breaks after the rename.

`tests/db/p0a-guards.test.ts` greps only the Drizzle identifiers, so raw SQL strings are not covered. No tracked app code reads the old table or the mirror columns. I checked app/, lib/ and scripts/ outside `_one-off`, the other repos under ~/projects, and ~/.claude/tools and ~/.claude/dashboard. Fix: add both scripts to STATE Deferred/debt item (4), and extend the guard to `snapshot_target_coverage` and `sub_competencies … career_target_id|display_order` in SQL strings.

**M-5. The seed script (deferred item b).** It is non-atomic, which is acceptable: it is idempotent, and a crash self-heals on re-run. But it has a new, latent hazard. If `CAREER_TARGETS` ever lists an existing id under a different target, the old seed did nothing, while the new seed adds a requirement under the second target. That puts the competency in two targets: the view shows it in both, and the rollback then refuses. The constants agree with the DB today: errors `[]`, no cross-target ids, no missing ids, checked read-only with `planTargetBatch` against the scratch DB. Fix (not required before live): insert the requirement only `WHERE EXISTS (SELECT 1 FROM sub_competencies WHERE id=$sc AND career_target_id=$t)`, and wrap each target in a transaction.

**M-6. Cascade notes for P0b (item 8).** These were run in a rolled-back transaction:
- Deleting target `ai-workflow` deleted 11 subs, 11 requirements and 194 cells in each of the coverage tables and the view, plus 25 intended-coverage rows and 1 prerequisite edge. No coverage cell was left without a membership. Deleting competency `color-management` cascaded to its 18 cells everywhere. P0a behavior is identical to before, because the deprecated `sub_competencies.career_target_id` FK still has `ON DELETE CASCADE`.
- Deleting a requirement row alone leaves its cells invisible (18 cells with no membership) and makes the rollback refuse. No code path deletes requirements, targets or competencies today.
- P0b must change the mirror FK to `SET NULL` (or drop the column) before any competency is shared. Otherwise deleting one target deletes a shared catalog entry, and its cells, from every other target.

---

## Items checked with no finding

- **Item 2: rollback.** One rolled-back transaction did the following after cutover: created competency `zz-adv-new` (the new-code way: catalog row with mirror, plus a requirement row with display_order 99), scored it, re-scored one cell, invalidated another, and reordered one competency to 42. It then ran the rollback. Observed: `snapshot_target_coverage` has 764 rows, 0 rows differ from the pre-rollback `snapshot_competency_coverage`, and the new competency's cell is filed under its own target (`creative-generalist`) with d_depth 3. 0 rows are misattributed. The mirror display_order is 99 for the new competency and 42 for the reordered one, and `career_target_id` is NOT NULL again. Re-applying 0056 afterwards: 764 rows. The rollback neither loses nor misattributes a competency created after the cutover. The only exception is a competency the *old* code created, which belongs to I-1.
- **Item 3: retired rows.** `prompt-design` and `change-management` (both `ai-workflow`, retired) have 6 cells each in `snapshot_competency_coverage`, and all 12 appear in `target_coverage`. The only display_order ties are active–retired pairs in `ai-workflow` (2 and 4). Every reader that orders by display_order removes retired rows before the order is used (`listTargets`, `getMatrixData`, scaffolding, `groupTargets`, `reliability/check.ts`, `model-eval.ts`), and `readCatalogState` adds `id` as a tie-break. So no visible order depends on a tie.
- **Item 4: old readers.** No tracked app, lib or script code (outside `_one-off`) reads `snapshot_target_coverage` or the deprecated columns, in Drizzle or in raw SQL. Only comments still mention them. I also checked `pg_stat_activity`: no other client is connected to `gc_curriculum` at the moment. The other repos that use the database read only `course_materials` (rag-core) or wiki files.
- **Item 5: off-target filter.** Both routes build `memberIds` from `target_sub_competencies` for the scored target and skip any other cell. The mocked tests pass (`app/api/program/coverage` and `tests/api/targets.test.ts`: 3 files, 13 tests). Retired members are still written if the scorer returns them, as before (the scorer is only given active members). One small difference: if the scorer returns *only* off-target cells, the pair now stays "stale" and gets re-scored. Before, the junk rows marked it as scored. This is acceptable.
- **Item 6: transactions under an injected failure.** A temporary vitest file wrapped the transaction object so that a chosen write throws:
  - Making the requirement insert throw inside `insertCompetencyForTarget`: the catalog row was rolled back and the fingerprint was unchanged.
  - Making the third mirror update throw in a reorder loop: no requirement or mirror value changed.
  - A successful reorder left 0 rows where the mirror and the requirement order differ.

  3 of 3 passed. The `/injected/` assertion confirms the failure really fired each time.
- **Item 7: characterization coverage.** Every re-pointed read is probed except the two unordered reads in M-3 (refresh-route subs and the `loadTargetSubstrate` subs order), which `sortJson` masks. The membership lookup used by the PATCH and retire routes is covered by unit tests and returns the same row shape.
- **Item 9: build-time reads.** `next build --turbopack` with `DATABASE_URL` pointing at a **nonexistent** database finished with exit 0 and no DB errors. Every page that calls a DB loader is `force-dynamic`, and there are no `generateStaticParams` or `revalidate` exports. So nothing reads the new views at build time.
- **Deferred item c: the deterministic tie-break.** Acceptable as a recorded visible change. It only changes which equally deep course the wiki target page cites, and only when that page is regenerated. No fix is needed before live.

---

## Required before the live apply

1. **I-1:** a fail-fast live-apply runbook (build first; bootout the app and the watchdog; check other sessions; verified `-Fc` backup; DB-name guard; apply; verify; bootstrap). This is a new file; the plan stays append-only.
2. **M-1:** the one-line `LOCK TABLE` and the header text. It is cheap, it closes the window shown above, and it is worth doing in the same change.

M-2 to M-6 can go to STATE Deferred/debt, with a pointer to this report.

**Verdict: REJECT** (I-1 stands). Re-review once the runbook exists.
