# SDD ledger — plan: docs/superpowers/plans/2026-10-11-competency-catalog-p0a.md

Spec: docs/superpowers/specs/2026-10-11-competency-catalog-and-career-demand-design.md (binding)
Worktree: /Users/admin/projects/curriculum_developer-wt-catalog (branch feat/competency-catalog-p0a, created by Task 1)

## Pre-flight scan
Full table: preflight-scan.md (A/B/C/D). Non-OK rows and rulings:
- C1 sub_competency_map not created in P0a. Ruling: not created in P0a — with no merges every mapping is identity, so the table would carry no information; it is created and populated in P0b with the merges (spec §8 P0b already places it there) — cost if wrong: trivial, add an empty table later.
- D2 coverage_scores has a reader (scripts/_one-off/check-pf-coverage.ts:46). Ruling: keep leaving the table in place; Task 2's STATE Deferred/debt text must name check-pf-coverage.ts as a coverage_scores reader and add it to Ruling 11's one-off list — cost if wrong: misleading debt note only.
- B3 Task 8 `pnpm build` could read the live DB via the .env.local symlink. Ruling: Task 8 runs the build with DATABASE_URL set explicitly to the scratch URL (process env overrides .env.local in Next.js) and reports if any build step connects to Postgres — cost if wrong: one read-only build-time query against live, no writes.
- B4 Task 2 red-proof may show an extra afterAll failure. Noted; reviewer to accept the extra hook failure as expected noise.
- B5 Task 3 mocked invalidate test's single .returning() call unverified. Noted; Task 3 reviewer checks it.
Task 1: dispatched (BASE 42e2211 on dev; implementer sonnet)
Task 1: implementer DONE aaee707; review dispatched (diff in worktree .superpowers/.../review-42e2211..aaee707.diff)
Task 1: review — spec ✅, quality Needs fixes (2 Important). Ruling: the compare loop is plan text (brief) but fail-fast hides simultaneous regressions — collect all mismatched keys and assert once; pass/fail semantics unchanged — cost if wrong: none (diagnostic only). Finding 2 (getMatrixData probe filtered, narrower than getAllCells) → add a comment documenting each probe's scope; no new probe needed since getAllCells covers every row.
Task 1: fix round 1/5 (2 addressed, 0 open; commits aaee707..229f1ca)
Task 1: complete (commits 42e2211..229f1ca, review clean)
Task 2: dispatched (BASE 229f1ca; implementer sonnet)
Task 2: implementer DONE 50faed0; review dispatched (opus)
Task 2: review — spec ✅, quality Approved (opus), 0 Critical/Important.
Task 2: minor (deferred): 0056 header lacks "apply with app stopped" and no LOCK TABLE (plan-mandated text) — strong candidate to fix before Task 10 (final review to triage; add LOCK TABLE snapshot_target_coverage, sub_competencies IN SHARE ROW EXCLUSIVE MODE after BEGIN).
Task 2: minor (deferred): divergence guard compares only generated_at+existence — Task 3 upsert must set generated_at (carried into Task 3 dispatch).
Task 2: minor (deferred): migration header/STATE wording "never read" describes end-of-plan state, not this commit.
Task 2: minor (deferred): no STATE Deferred/debt pointer for C1 (sub_competency_map → P0b).
Task 2: minor (deferred): STATE lists five one-off scripts without noting they're untracked in git.
Task 2: complete (commits 229f1ca..50faed0, review clean)
Task 3: dispatched (BASE 50faed0; implementer sonnet)
Task 3: implementer DONE_WITH_CONCERNS 49d48e0 — characterization FAILED (computePrereqGaps GC 1010: golden 3 gaps, now 0) because the controller's dispatch told it to re-create the scratch clone from live; live data moved ~30 min after the golden. All work stayed on scratch (verified in report).
Task 3: Ruling: re-baseline — fresh clone → capture golden with the HARNESS code (aaee707, old readers, pre-0056) → apply 0056 → run characterization at branch HEAD; from then on the scratch clone is long-lived (never re-create once a golden exists, except by repeating this full re-baseline procedure) — why: the golden must describe the same data the new code reads; the plan's Task 8 already uses this procedure — cost if wrong: one extra capture run.
Task 3: re-baseline done — root cause was the wiped scratch fixture (not live drift); golden re-captured byte-identical; characterization 18/18 pass at 49d48e0; constraints updated to include fixture step. Review dispatched.
Task 3: review — spec ✅ (all 3 controller requirements verified); 1 Important (plan-mandated): dual-write upsert/invalidate not in one transaction.
Task 3: Ruling: not fixed — the dual-write is transient scaffolding that Task 7 removes (stops writing the backup) before any deploy; no deployed build ever runs it, so the divergence window exists only on this unmerged branch between tasks — cost if wrong: if the branch were deployed mid-plan (it won't be; deploy is owner-gated after Task 10), a partial failure could leave the backup table one cell behind; the backup is never read after Task 4. Flag to Task 9 adversarial reviewer: confirm no non-transactional multi-table write survives Task 7.
Task 3: minor (deferred): course-reset test asserts only the new table cleared, not the backup (transient; moot after Task 7).
Task 3: complete (commits 50faed0..49d48e0, review clean after ruling)
Task 4: dispatched (BASE 49d48e0; implementer sonnet)
Task 4: implementer BLOCKED (uncommitted) — loadTargetSubstrate picks a "best" cell per sub-competency via an unordered SELECT; via the target_coverage view Postgres returns tied cells in a different order, so ~10/40 coverageRollup winners differ (same depth).
Task 4: Ruling: add a deterministic tie-break to loadTargetSubstrate's selection (best depth as today, then a stable order: generated_at desc, then course_code asc, then snapshot_id asc) and change the characterization probe for loadTargetSubstrate so that where several candidates tie on the selection depth, it compares the depth and the SET of tied candidates rather than the arbitrary winner; all other probes and fields stay exact — why: the legacy pick depends on heap order and is not a real behavior (VACUUM/updates change it), so "identical output" for ties was never guaranteed — cost if wrong: a wiki target page may cite a different, equally deep course than before.
Task 4: fold-in: Task 3's fixture course 'ZZ 9997' collides with reconciliation-log.test.ts — change the p0a fixture to a code no other test uses.
Task 4: implementer DONE 4b124a5 (incl. ruling: tie-break + tie-aware probe + fixture code); review dispatched. Deferred note for STATE: ZZ 9999 fixture collision flag-queries vs ingest-queue-queries (pre-existing flaky).
Task 4: review — spec ✅, Approved-with-2-Important (opus). Entering fix round 1: (1) tie-aware probe must assert each side's own winner ∈ live tie set and entry.dDepth === tie.dDepth; replace red-proof (e) with a membership red-proof; (2) STATE.md Deferred/debt lines for the tie-break (deliberate wiki tie-winner change) and the ZZ 9999 fixture collision.
Task 4: minor (deferred → Task 7/8): stale prose naming snapshot_target_coverage in app/api/program/coverage/route.ts:9, refresh/route.ts:137, refresh/[snapshotId]/[targetId]/route.ts:89, app/program/ProgramCoverageClient.tsx:388 (user-visible), lib/ai/wiki/graph-tools.ts:8, lib/ai/wiki/update.ts:1360, lib/program/sufficiency.ts:6,32, run-impact.ts:33.
Task 4: minor (deferred): collectCoverageTieSets reads whole view without retired filter (harmless).
Task 4: fix round 1/5 (2 addressed, 0 open; commits 4b124a5..c12fc52)
Task 4: complete (commits 49d48e0..c12fc52, review clean)
Task 5: dispatched (BASE c12fc52; implementer sonnet)
Task 5: implementer DONE a212612 (+2 Ruling-10 route tests, red-proofed); STATE.md left for Task 8 (note for Task 8: record Ruling 10 route behavior). Review dispatched.
Task 5: review — spec ✅, Approved (sonnet). The one "Important" is a sign-off request: Ruling: STATE.md untouched in Task 5 is per plan (STATE edits in Tasks 2/7/8); Task 8 must record the refresh-route behavior (Ruling 10 off-target filter) — cost if wrong: none.
Task 5: minor (deferred): the two Ruling-10 route test files duplicate mock scaffolding.
Task 5: complete (commits c12fc52..a212612, review clean)
Task 6: dispatched (BASE a212612; implementer sonnet)
Task 6: implementer DONE 2ac9ff6; review dispatched. Note for Task 10: pnpm exec tsx doesn't resolve in the worktree (tsx hoisted only in main checkout).
Task 6: confirmed dry-run used DATABASE_URL=scratch explicitly; lib/db/client.ts has no .env fallback; live never read.
Task 6: review — spec ✅, Approved (sonnet). 1 Important (plan-mandated): seed-career-targets.ts writes sub_competencies + career_target_requirements as two unwrapped statements.
Task 6: Ruling: not fixed — the seed script is an empty-DB bootstrap that is already non-atomic (career_targets + sub_competencies inserts) and idempotent (ON CONFLICT DO NOTHING), so a re-run self-heals a crash between statements; production never runs it on a populated DB — cost if wrong: a crashed bootstrap leaves a competency without its requirement row until re-run. Final review may revisit.
Task 6: minor (deferred): scripts/_one-off/reliability-study.ts:921-923 reads subCompetencies.careerTargetId/displayOrder (excluded from guard) — confirm it's in the Ruling 11 one-off debt list in Task 8.
Task 6: minor (deferred): no positive test of catalogBatchWriter.updateSub single-target reorder.
Task 6: complete (commits a212612..2ac9ff6, review clean)
Task 7: dispatched (BASE 2ac9ff6; implementer sonnet)
Task 7: implementer DONE 60206fa (also re-pointed scripts/_one-off/reliability-study.ts — already tracked, modified only, verified no new files added; corrected STATE note). Review dispatched.
Task 7: review — spec ✅, Approved (sonnet); confirmed no non-transactional multi-table coverage write survives (Task 3 ruling closed).
Task 7: minor (deferred): fixtures.ts addFixtureCompetency select-then-insert could throw on concurrent same-id calls (theoretical).
Task 7: complete (commits 2ac9ff6..60206fa, review clean)
Task 8: dispatched (BASE 60206fa; implementer sonnet)
Task 8: implementer DONE 44acfea — fresh-clone re-baseline 18/18, verify 18/18, rehearsal 6/6, suite 2920 green, tsc clean, next build with scratch URL: zero live connections (pg_stat_activity polled). pnpm lint red pre-existing (recorded). Review dispatched.
Task 8: review — spec ✅, Approved (sonnet). Ruling: `pnpm lint` red (74 errors) is accepted for this branch — every offending file is byte-identical to aaee707 (pre-existing on dev), and it is recorded in STATE Deferred/debt — cost if wrong: none for P0a; lint debt remains for a separate cleanup.
Task 8: minor (deferred): STATE item (9) documents implemented behavior under Deferred/debt (placement only).
Task 8: complete (commits 60206fa..44acfea, review clean)
Task 9: adversarial reviewer dispatched (opus) — report → adversarial-review.md; fixes via implementer per Task 9 Step 2
Task 9: adversarial review — REJECT (opus). I-1 Important (Task 10 live-apply procedure: no app stop, KeepAlive+watchdog restart old code, unverified backup can be empty, no DB-name/session guard). Code/migration/rollback held under 9 attacks. Minors M-1..M-6.
Task 9: Ruling: fix I-1 with a new fail-fast runbook script (plan stays append-only; STATE points to it) — the plan's Task 10 Steps 1–4 are superseded by the runbook — cost if wrong: owner runs a script instead of 4 pasted commands.
Task 9: Ruling: fix M-1 (LOCK TABLE + header), M-2 (full-row divergence guard, neutral message), M-3 (orderBy displayOrder,id on both unordered reads), M-4 (guard extended to raw SQL; both scripts on debt list), M-5 (seed WHERE EXISTS + per-target tx) in the same fix wave — all cheap and each closes an observed or latent hazard — cost if wrong: small extra diff to review.
Task 9: Ruling: M-6 not fixed in P0a (behavior identical to pre-P0a; no code path deletes targets/requirements) — STATE Deferred/debt: P0b must make the mirror FK SET NULL or drop it before sharing — cost if wrong: none until P0b.
Task 9: fix wave 1 dispatched (implementer sonnet) — brief task-9-fix-brief.md, report task-9-fix-report.md
Task 9: fix wave 1 implementer agent a441b4722b7187e2a (sonnet), BASE 44acfea
Task 9: fix wave 1 DONE 44acfea..b65357f (1ed682e M-1/M-2, 38ea68e M-3, efde187 M-5, d768be8 M-4, 3944b37 I-1 runbook, b65357f STATE). Suite 2925 green, char 1/1, build ok. Concern: one scratch row briefly mutated during red-proofing, repaired to golden + verified.
Task 9: adversarial re-review round 2 dispatched (opus) → adversarial-review-2.md
Task 9: re-review round 2 — REJECT (opus). Round-1 findings verified fixed (M-4 partial). New: I-2 wrapper failure-path recovery messages restart wrong code / silent on some paths; M-a verify fails open (4/18 rows unenforced); M-b no SHA↔mode / 0056-at-SHA check; M-c raw-SQL guard misses planted shapes, seed exclusion mislabeled; M-d no test of backup table check, schema-only dump passes; M-e URL on argv (ps), dump world-readable pre-chmod.
Task 9: Ruling: fix I-2 + M-a..M-e in fix round 2 (resume same implementer) — all cheap and in the live-apply path — cost if wrong: small diff.
Task 9: fix round 2 dispatched (resumed implementer a441b4722b7187e2a) — brief task-9-fix2-brief.md
Task 9: fix round 2 DONE b65357f..c77f69a (ec83fa7 M-a/M-d/M-e, f24adc3 M-c, cf020e3 I-2/M-b, c77f69a STATE). Suite 2942 green; wrapper test 17/17 (stubbed); scratch fingerprint unchanged.
Task 9: adversarial re-review round 3 dispatched (opus) → adversarial-review-3.md
Task 9: re-review round 3 — ACCEPT (opus), no Important. 8 minors (M-g..M-n).
Task 9: Ruling: fix M-g (trap claims UNTOUCHED without checking — recreates I-1 in a ~30ms window), M-h (db-migrated helper doesn't guard db name), M-i (contradictory SAFE message after post-COMMIT verify failure), M-j (URL on node -e argv) before live, folded into the final-review fix dispatch (one wave) — cost if wrong: small diff. M-k..M-n → STATE Deferred/debt with pointer to adversarial-review-3.md.
Task 9: complete (honest ACCEPT round 3; commits 44acfea..c77f69a)
Final whole-branch review dispatched (opus) → final-review.md
Final review: Ready with fixes (opus). I-1 STATE lacks M-k..M-n + reports live in git-ignored dir; I-2 merge leaves dev's "P0a EXECUTING" line stale (fix in merge commit — owner-gated merge). 12 minors.
Ruling: ONE final fix dispatch = round-3 M-g/M-h/M-i/M-j + final I-1 + minors: stale comments, STATE wording (10)(12) + "identical" claim, verify-backup empty-table claim, rollback-checkout doc, wrapper success reminder to update STATE, dedupe URL parsing (shared sourced helper) since M-j touches both. Deferred to STATE: rollback-mode build-window backup-table write (extends M-l), refusal-check tests for rollback/0056, migration test fingerprint churn, no read-only live precondition check. I-2 handled in the owner-approved merge commit — cost if wrong: STATE briefly stale until merge.
Final fix dispatched (resumed implementer a441b4722b7187e2a) → task-9-fix-report.md "## Final"
Final fix DONE c77f69a..7926c27 (589d366, 1a74ba5, 16c9247, 7926c27); scoped re-review dispatched (sonnet)
Final fix scoped re-review: all 6 fixed, 0 new (sonnet). Branch ready; Task 10 STOP — asking owner (merge + live apply).
Task 10: complete — owner go-ahead 'All 3' + 'Run it'. Merge a516ad3 → dev; live apply via runbook: DB apply OK (verify all 0; 36/764), wrapper exit 1 at restarting-app (launchd bootstrap didn't spawn; recovered with kickstart); watchdog bootstrapped; smoke 200s; STATE 9a3fb0d; dev+main pushed 9a3fb0d.
