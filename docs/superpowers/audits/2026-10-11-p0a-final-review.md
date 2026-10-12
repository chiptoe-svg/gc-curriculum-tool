# Final whole-branch review: competency catalog P0a

Branch `feat/competency-catalog-p0a`, HEAD `c77f69a`, base `42e2211`. Reviewer: final integrated review, 2026-10-11.

**Verdict: Ready with fixes.** The code, migration, rollback and runbook are correct and consistent with each other and with spec §8 P0a. There are no Critical findings. The two Important findings are both about the record: STATE.md and the merge. Each is a small text fix that must land before or in the merge commit. M-g, M-h, M-i and M-j from round 3 are already scheduled and are not repeated here.

## Safety statement

- Every DB command used `$(scripts/migrations/p0a-scratch-db.sh url)`. I never connected to `gc_curriculum` and never read `.env.local`.
- I did not run `launchctl`, the live-apply wrapper itself, or `pkill`. I made no commits and dispatched no subagents.
- The only DB write was a read-only `pg_dump -t faculty_flags` of scratch into my temp dir, deleted afterwards.
- The gated tests that mutate scratch (`p0a-migration`, `p0a-apply-db`) were **not** run.
- **Scratch fingerprint was identical before and after.** The md5 values below are of all rows; scratch is still MIGRATED with 0 other sessions.

  | Table | Rows | md5 prefix |
  |---|---|---|
  | `snapshot_target_coverage` | 764 | `15d1e249` |
  | `snapshot_competency_coverage` | 764 | `e6f3dc98` |
  | `career_target_requirements` | 36 | `4ab044fd` |
  | `sub_competencies` | 36 | `c515df7b` |

- Temp files went only in my scratchpad subdirectory `finalrev/`.

## What I ran

- **`tsc --noEmit`:** clean.
- **Full vitest suite, no `DATABASE_URL`:** 413 files passed, 11 skipped; 2918 tests passed, 40 skipped.
- **P0a and touched tests against scratch:** 11 files, 56/56 passed. The run used `P0A_GOLDEN=golden-final.json` and covered:
  - guards
  - tie-aware probe
  - catalog-writes (rolled-back transactions)
  - characterization
  - coverage-writes (fixture rows, cleaned up)
  - the wrapper test (stubbed)
  - `tests/api/targets`
  - both refresh-route tests
  - the mocked program-coverage and scaffolding tests
- **Merge check, `git merge-tree --write-tree HEAD dev`:** clean, no conflicts.
- **dev since `42e2211`** (`604f6b8`, `c09a6ca`, `8710121`) changes only `docs/STATE.md` and the spec. It is docs only.
- **Cross-repo check.** No other repo or launchd job reads `snapshot_target_coverage` or `sub_competencies`. I grepped gc_alumni, gc-course-demand-planner, ai_workshop and ai_career_impact, and the plists. The launchd jobs that open DB sessions (feedback-cron, the backups, cost-cap) only trigger the session guard's safe refusal.
- **Migration path.** No automatic migration runner exists. `db:migrate` is drizzle-kit with git-ignored, stale meta, and the deploy scripts don't migrate.

## Spec conformance (§8 P0a)

- **The structure matches §8 P0a.**
  - `sub_competencies` is the catalog: `career_target_id` is nullable, with ids kept.
  - `career_target_requirements` is seeded with one entry/faculty/draft/NULL-weight row per pair, retired pairs included.
  - `snapshot_competency_coverage` carries all rows over unchanged.
  - Scoring is still per target, with target context.
  - There is no `sub_competency_map` (Ruling C1, recorded).
  - The deviations (mirror columns, `display_order` on requirements, the drops deferred) are all Rulings and are recorded in Deferred/debt.
- **The scope is structure only.** The additions beyond structure are:
  - the live-apply runbook scripts (required by I-1);
  - test-only `export`s on five wiki/explore loaders;
  - the per-target transaction in the seed script;
  - transactional create/reorder in the target API.

  None of these changes what faculty see.
- **There are two faculty-visible deltas. Both are deliberate and recorded.**
  1. The `loadTargetSubstrate` tie-break: the wiki target page may cite a different course of equal depth, after its next regeneration. This is STATE debt item (6).
  2. M-3: competency order is now deterministic in the scorer and wiki prompts. This is invisible until the next re-score.

  The JSX text change in `ProgramCoverageClient.tsx:388` is inside a `{/* */}` comment, so it is not visible. (The Task 4 ledger called it "user-visible".)

## Migration, rollback and runbook consistency

These checks held:

- **0056.** Lock, then preconditions, then the full-row divergence guard, then DDL, seed, copy and views, then post-checks. All in one transaction.
- **Rollback.** Existence check, then lock, then 4 refusals, then a rebuild from the authoritative new table, then `NOT NULL` restored, then a count check, then drops.
- **Verify.** 18 rows. `p0a-apply-db.sh` requires exactly 18 and enforces every `(expect 0` and `(expect =` row.
- **Wrapper.** It matches the SHA to the mode, byte-compares 0056, builds, stops, applies (guards, then backup, then verify-backup, then SQL, then verify), and restarts only on success.
- **The pieces agree with each other.** The headers of 0056, the rollback and the plan Rulings agree with the wrapper and with STATE ("supersedes plan Task 10 Steps 1–4").
- **The new code keeps the rollback viable.** Every writer of a new competency writes the mirror (`insertCompetencyForTarget`, the seed), so the rollback's "no owning target" refusal cannot be triggered by app writes.

---

## Important

### I-1. STATE.md Deferred/debt is incomplete for round 3, and its report pointers lead to git-ignored files

- **The round-3 deferrals are missing.** The ledger ruling (Task 9, round 3) puts M-k, M-l, M-m and M-n in STATE Deferred/debt, with a pointer to `adversarial-review-3.md`. `docs/STATE.md` at HEAD has no round-3 entry. The P0a deferral bullet ends at item (13), which covers round 2.
  - M-k: the `lsof` stop-wait fails open, and bootout failures are swallowed.
  - M-l: the over-stated messages, no persistent log, SIGHUP untrapped, and the operational note to run with a long timeout.
  - M-m: the previous SHA is not validated.
  - M-n: the raw-SQL guard misses schema-qualified names.

  M-6 is present, in item (12).
- **The backing detail isn't durable.** Items (12) and (13) say "Full report: `.superpowers/sdd/2026-10-11-competency-catalog-p0a/adversarial-review*.md`". `.superpowers/` is git-ignored (`.gitignore:68`, confirmed with `git check-ignore`). The backing detail for every P0a deferral, M-6 included, therefore exists only in this machine's main checkout. It is absent from the deploy checkout and from any clone. CLAUDE.md requires the backing detail to sit somewhere durable.
- **Fix, in this order:**
  1. Copy the three adversarial reports (and this one) to `docs/superpowers/audits/2026-10-11-p0a-adversarial-review-{1,2,3}.md` and `…-final-review.md`, then repoint items (12) and (13).
  2. Add item (14): "Round 3 ACCEPT; M-g to M-j fixed in <commit>; deferred: M-k …, M-l …, M-m …, M-n …", one clause each, pointing to the committed round-3 report.
  3. When M-g lands, correct the item (13) sentence that says the trap "queries the ACTUAL database state" once the DB step is attempted. That sentence is already scheduled with M-g.

### I-2. After a clean merge, STATE.md will claim P0a is still mid-execution and unmerged

- **The stale text.** dev's `604f6b8` and `c09a6ca` rewrote the Active-arc P0a text to: "P0a EXECUTING … **Task 9 adversarial review in flight** … then Task 10 … **Nothing merged to dev/main**; live DB untouched." The branch does not touch that line, so `git merge` keeps it verbatim.
- **What the merged STATE then says.** It contains:
  - that stale in-flight pointer, which is false the moment the merge lands;
  - the branch's own new Active-arc bullet ("built … verified on a scratch clone; live apply + deploy pending");
  - the Schema bullet ("branch `feat/competency-catalog-p0a`").

  That is two contradictory P0a status lines.
- **Fix, in the merge commit:**
  1. Replace the dev "P0a EXECUTING …" sentence with one current line: "merged to dev <sha>, ACCEPTed after 3 adversarial rounds plus the final review; live apply pending the owner, via the wrapper."
  2. In the Schema bullet, change "branch `feat/competency-catalog-p0a`" to "merged <sha>; NOT applied to production".

---

## Minor (12)

1. **`lib/program/prereq-gaps.ts:258-259`: a stale docstring.** Step (c) still reads "Look up the matching `snapshotCompetencyCoverage` row for (snapshotId, careerTargetId, subCompetencyId)". The code at :350-363 keys on (snapshot, competency) only. The branch edited this line and left the old key.
2. **Other comments still name the backup table as live storage.**
   - `lib/db/program-coverage-queries.ts:229`: "Cells under a retired sub-competency stay in snapshot_target_coverage as history". They now stay in `snapshot_competency_coverage`.
   - `lib/capture/run-course-reset.ts:45`: "dependent rows (snapshot_target_coverage)".
   - `lib/db/schema.ts:848`: "NEVER merged into snapshot_target_coverage".
   - `lib/domain/seed-targets.ts:10` and `:419`: the FK holders now also include `snapshot_competency_coverage` and `career_target_requirements`.

   Fix: point each at the new table.
3. **Accuracy in the STATE P0a text.**
   - Item (10) says "migration 0056's schema rename (to `deprecatedCareerTargetId`/…)". The rename is Drizzle-only (`lib/db/schema.ts`); 0056 renames no column.
   - Item (12) says the LOCK was added "right after `BEGIN` in 0056 and the rollback". The rollback locks after its existence-check DO block, on purpose (`rollback.sql:10-23`).
   - The Active-arc bullet says characterization is "identical before/after", but item (6) records a deliberate tie-winner change. Write "identical except tie winners (item 6)".
   - Items (4) and (10) repeat the one-off script list with slightly different contents.
   - Items (9) and (11) describe implemented behavior and an operational tip, not deferrals. That is placement only, and was already noted in the ledger.
4. **`scripts/migrations/p0a-verify-backup.sh:50`, and the subject of commit `ec83fa7` ("backup needs real rows"), over-claim.** pg_dump emits a `TABLE DATA` TOC entry for an **empty** table. I verified this on scratch: `faculty_flags` (0 rows) lists `TABLE DATA public faculty_flags`. So the check proves the archive has a data section, not that it has rows. The message "(schema-only dump, or the table is empty/missing)" is wrong about "empty". The DB-name guard makes a wrong-DB dump unlikely, so this is wording only. Fix the message, or add a row check if rows matter, for example `pg_restore -a -t snapshot_target_coverage -f - | grep -c` on the data lines.
5. **Where to run a rollback from is not stated.** Rollback mode requires the `-deploy` checkout to already sit at the **pre-P0a** SHA. That tree has no `scripts/migrations/2026-10-11-p0a-live-apply.sh`. STATE says only "rollback the same wrapper with `rollback`". Add: "run it from a P0a checkout (for example, the main checkout at the merge commit) after checking out the pre-P0a SHA in -deploy".
6. **Rollback mode can lose a backup-table write made during its build window.** This extends M-l into the DB.
   - In rollback mode the wrapper builds pre-P0a code into the live `-deploy/.next` while the P0a app keeps serving (`live-apply.sh:178-185`).
   - Between the build and the bootout, a route that has not yet been loaded can be served from the pre-P0a chunks. That code writes `snapshot_target_coverage`.
   - The rollback then runs `DELETE FROM snapshot_target_coverage` and rebuilds the table from the new one. Such a write is lost.

   Why it is Minor: the window is narrow, the route is admin-only and slow, and the data is re-scorable. Fix: in rollback mode, boot out the app before building (rollback is a contingency, so the downtime is acceptable).
7. **The refusal paths have no regression tests.** Nothing in `tests/` matches the messages of the 4 rollback refusals (`rollback.sql:27-48`), the 2 preconditions in 0056 (`:42-56`), or its post-check RAISEs (`:215-250`). The round-1 reviewer exercised them by hand, but nothing guards them now. Fix: add scratch tests inside rolled-back transactions. For example:
   - insert a second-target requirement, and expect the rollback to refuse with "more than one target";
   - `UPDATE sub_competencies SET career_target_id = NULL`, and expect "no owning target".
8. **`tests/db/p0a-migration.test.ts` changes scratch every time it runs.** Each rollback and re-apply regenerates `career_target_requirements.id`, `created_at` and `updated_at`, so the scratch fingerprint changes (round 3 restored the 36 rows by hand). That breaks the global rule "Tests that mutate scratch rows must restore them". Fix: save those columns by natural key in `beforeAll` and restore them in `afterAll`.
9. **Some test assertions are weak.**
   - `p0a-coverage-writes.test.ts:79`: `expect(n).toBe(before.length)` passes vacuously if both upserts wrote nothing. Add `expect(before).toHaveLength(2)`.
   - `p0a-catalog-writes.test.ts:60`: the title says "other targets are untouched", but the test asserts only that a non-member call returns 0.
   - There is still no positive test of `catalogBatchWriter.updateSub` reordering a single-target competency. This was a Task 6 minor and is not recorded anywhere.
   - The PATCH, reorder and retire target routes (re-pointed in Task 6) have no route tests.
10. **Duplicated helpers.**
    - The URL-to-PG\* `node -e` block is copied verbatim in `p0a-apply-db.sh:57-75` and `p0a-db-migrated.sh:19-37`. The M-j fix has to change both; factor it into one helper as part of that fix.
    - The two refresh-route test files duplicate their mock scaffolding (a known ledger minor).
11. **There is no read-only preflight on live.** Ruling 10 says the old scorer can write an off-target cell. If live gained such a row, or a duplicate (snapshot, sub) pair, after the scratch clone was taken, 0056 refuses only **after** the app is stopped. The recovery then says only "investigate by hand". Fix: add a read-only preflight that runs 0056's two precondition queries against live while the app is still serving. Use the owner-run path, before scheduling the downtime.
12. **The wrapper's success text omits the STATE update.** It lists the smoke test, but not plan Task 10 Step 3's "update STATE.md: P0a applied to production (date, owner go-ahead)". Add one line.

---

## Checked, no finding

- **Re-pointed readers.** Every reader listed in the plan reads the views or the new table. No tracked code reads `snapshotTargetCoverage`, `subCompetencies.careerTargetId` or `displayOrder`; the guards and `tsc` prove it. The tracked one-offs `explore-*-harness.ts` don't touch these tables. The untracked one-offs that do are all in the debt list.
- **Ruling 10 filter.** Present in both refresh routes, filtering the writes only. The tests are red-proofed according to the ledger.
- **`invalidateCoverageForSubCompetency`, `listStalePairs`, the course reset and the `getMatrixData` ordering.** Same semantics as before for P0a data.
- **Response shapes.** The create and PATCH responses have the same shape as before: the view has the old row's fields.
- **Characterization.** It covers every re-pointed read path except the refresh-route subs read and `getTargetCompetency`. The route tests and catalog-writes cover those.
- **`tests/scripts/p0a-live-apply-wrapper.test.ts` is safe in the default suite.** `launchctl`, `lsof` and `pnpm` are stubbed on PATH, `HOME` is a temp dir, and the deploy repo is a throwaway.
- **No dead code left by later tasks.** The old `readState` and `drizzleWriter` in `apply-target-batch.ts` were removed in favor of `readCatalogState` and `catalogBatchWriter`. There is no duplicate `Tx` type in the P0a files.
