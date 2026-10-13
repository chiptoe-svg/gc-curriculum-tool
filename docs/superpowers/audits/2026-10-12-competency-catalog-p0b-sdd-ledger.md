# SDD ledger — plan: docs/superpowers/plans/2026-10-12-competency-catalog-p0b.md
Spec: docs/superpowers/specs/2026-10-11-competency-catalog-and-career-demand-design.md (reachable)
Setup: worktree /Users/admin/projects/curriculum_developer-wt-p0b, branch feat/competency-catalog-p0b from dev 618fc35 (created by controller; deps installed).

## Preflight scan
| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T1 self | Step 1 creates worktree | already created by controller |
| T1→T9 | golden-pre.json (pre-0057, P0a probes) → T9 characterization with allow-list | consistent |
| T2 ↔ T3 | T2 migration test needs PRE-0057 state; T3 Step 4 applies 0057 to scratch permanently; T3 Step 5 `restore-pre` re-clones | conflict: once T3 applies, T2's test cannot run on the main scratch; restore-pre would destroy post state used by T4–T9 |
| T2 self | test 6 inserts edges; needs two existing course codes | fine (pick any two courses in the clone) |
| T2 self | flags insert uses enum target_kind | plan already tells implementer to cast if needed |
| T3 ↔ T4 | both edit competency-catalog-queries.ts (T3 drops reorder guard; T4 rewrites readCatalogState/writer) | sequential, consistent |
| T3 ↔ T5 | T3 deletes snapshotTargetCoverage/coverageScores Drizzle tables; routes T5 rewrites already read targetCoverage/snapshotCompetencyCoverage only (P0a) | consistent; guard test proves |
| T4 self | DbSubRow loses careerTargetId; memberships passed separately | consistent with Interfaces |
| T5 ↔ T7 | scoreSnapshotCompetencies signature | consistent |
| T6 ↔ T7 | writeMergedStub(oldId, survivorId, survivorName) | consistent |
| T7 self | real paid calls on scratch need provider keys from app env while DATABASE_URL = scratch | risk of live DB via env; ruled below |
| T8 self | derives from P0a scripts; adds kickstart + restore rollback | consistent |
| T9 self | characterization allow-list for 3 touched targets | consistent |
| T10, T11 | review / owner gate | consistent |

Ruling: replace T3 Step 5 `restore-pre` with a second scratch DB `gc_curriculum_p0b_pre` (p0b-scratch-db.sh `create-pre`/`url-pre`/`drop-pre`), pre-0057, used only by the migration test; main scratch stays post-0057 from T3 Step 4 on; guard accepts exactly these two names — a re-clone would destroy post-0057 state later tasks depend on — cost if wrong: one extra DB on the local server.
Ruling: T1 Step 1 skipped (controller created the worktree) — cost if wrong: none.
Ruling: T7's real scratch run sets DATABASE_URL explicitly in the process env and relies on --expect-db gc_curriculum_p0b_scratch refusing before any read — @next/env never overrides an existing process env var — cost if wrong: guard refuses, no write.
Task 1: dispatched (BASE 618fc35; implementer sonnet, agent ae9543171b8134392)
Task 1: implementer DONE 61b290d (golden captured from gc_curriculum_p0b_pre — accepted: pre stays pre-0057). Review dispatched.
Task 1: review — spec ✅, Approved (sonnet), 2 Important.
Task 1: Ruling: golden captured from gc_curriculum_p0b_pre is correct (pre stays pre-0057 for the whole branch); the Task 2 dispatch first compares golden-pre against gc_curriculum_p0b_scratch (still pre-0057) to prove the two clones agree — cost if wrong: a characterization mismatch in T9 traced to clone drift.
Task 1: Important #2 enters fix loop: broadening isScratchDb() un-gates P0a WRITE tests (p0a-migration rolls back/re-applies 0056; apply-db, coverage-writes, catalog-writes) on both P0b DBs — any later full-suite run with DATABASE_URL=p0b scratch would run them and corrupt post-0057 scratch.
Task 1: minor (deferred): no committed unit test for isP0bScratchDb(); drop paths untested.
Task 1: fix round 1 dispatched (resume implementer)
Task 1: fix round 1 implementer DONE 0814055; scoped re-review dispatched
Task 1: fix round 1/5 (1 addressed, 0 open; commits 61b290d..0814055)
Task 1: complete (commits 618fc35..0814055, review clean)
Task 2: dispatched (BASE 0814055; implementer sonnet)
Task 2: implementer DONE_WITH_CONCERNS 18d94be. Incident: psql -f committed 0057 to gc_curriculum_p0b_pre; recovered by drop-pre/create-pre (fresh clone) and 0-mismatch compare vs golden. Plan text error: "4 merge rows / 32 identity" — actual 3 merges + 33 identity (implemented per verbatim SQL).
Task 2: Ruling: plan's "4 merges/32 identity" was a controller miscount; 3+33=36 is correct — cost if wrong: none.
Task 2: review dispatched (opus — destructive migration SQL)
Task 2: review (opus) — spec ❌ 1 Important: flagged_context NULL vs Ruling 4 (brief's SQL defect, controller's). 5 minors.
Task 2: Ruling: a flag exists when ANY non-retired snapshot of the course has a group gap ≥2 (unchanged); the note and flagged_context come from ONE representative snapshot = the course's latest non-retired snapshot with group cells (created_at desc, id desc): note lists that snapshot's member values plus "largest gap across N captures: G"; flagged_context = jsonb {k,u,d,matchedCompetency,rationale} of that snapshot's carried survivor cell — the matrix and drift display read the latest snapshot — cost if wrong: drift baseline from a different capture than faculty expect.
Task 2: fix round 1 also takes minors 1 (test retired-snapshot exclusion), 2 (note mixing snapshots — resolved by the ruling), 4 (\set ON_ERROR_STOP on in verify). Deferred: minor 3 (tautological "changes nothing"), minor 5 (collation tie).
Task 2: minor (deferred): test 10 "changes nothing" tautological under savepoint rollback; localeCompare vs DB collation on full tie.
Task 2: fix round 1 implementer DONE bb7e02b (carry moved before flags; gap re-sourced from premerge table + merged-away rows; flags 12). Scoped re-review dispatched (opus — structural reorder).
Task 2: fix round 1/5 (3 addressed, 0 open; commits 18d94be..bb7e02b). Flag set = original SQL's 12 (draft's 10 was an artifact of reading overwritten survivor rows).
Task 2: minor (deferred): flag note wording "disagreed by 2+ levels" can precede representative values that differ by <2 (e.g. GC 1010) — reword to "a capture of this course disagreed…; latest capture: …" in a later fix wave.
Task 2: minor (deferred): no fixture with a flagged course having both non-retired and newer retired snapshots (correct by inspection).
Task 2: complete (commits 0814055..bb7e02b, review clean)
Task 3: dispatched (BASE bb7e02b; implementer sonnet). Step 5 (restore-pre) superseded by preflight ruling (gc_curriculum_p0b_pre).
Task 3: implementer agent a9342254eb161fbb1
Task 3: implementer DONE 947e82e (0057 applied to gc_curriculum_p0b_scratch; retire route response shape changed). Review dispatched.
Task 3: review — Needs fixes (sonnet): 3 Important (migration test gate fails on main scratch; tests/api/targets.test.ts not extended; retireCompetencyFromTarget branches on pre-delete count without membership check). Fix round 1 dispatched (resume implementer).
Task 3: fix round 1 implementer DONE a419d10; scoped re-review dispatched
Task 3: fix round 1/5 (3 addressed; new Important from concurrency check: two concurrent retires on different targets of a shared competency can orphan it under READ COMMITTED — no row lock); round 2 dispatched (resume implementer): lock sub_competencies row FOR UPDATE first.
Task 3: fix round 2 implementer DONE aea140d (FOR UPDATE lock + two-connection test, red-proofed); scoped re-review dispatched
Task 3: fix round 2/5 (1 addressed, 0 open; commits a419d10..aea140d)
Task 3: minor (deferred): p0b-retire-competency.test.ts:153-156 client.connect() outside try/finally — a connect failure leaks client1 and leaves the race fixture row.
Task 3: complete (commits bb7e02b..aea140d, review clean)
Task 4: dispatched (BASE aea140d; implementer sonnet)
Task 4: implementer agent a9b3ab4d003d12d7e
Task 4: implementer DONE ebe6dda (dry-run 0 changes/0 errors; union type leaked into 6 DB-resolved readers with defensive filters; 2 p0a-catalog-writes cases removed; seed empty-DB path not DB-exercised). Review dispatched.
Task 4: review — spec ✅, Approved (sonnet). Union-type filters verified no-op (DB-resolved targets never carry {ref}).
Task 4: minor (deferred): CareerTarget type reused for definitions and DB-resolved targets — split into CareerTargetDefinition vs CareerTarget later to drop 6–7 vacuous isSubCompetencyDefinition filters.
Task 4: minor (deferred): planner membershipInserts can assign a display_order still held by a reported-only (unremoved) member — no unique constraint, ambiguous tie only.
Task 4: minor (deferred): seed script empty-DB path doesn't populate sub_competency_map; silently keeps first duplicate definition (planner Rule 1 errors instead).
Task 4: complete (commits aea140d..ebe6dda, review clean)
Task 5: dispatched (BASE ebe6dda; implementer sonnet)
Task 5: implementer agent a671c34e1b6b6e263
Task 5: implementer DONE b4f0d00 (scoreSnapshotCompetencies v2; listStaleSnapshots; routes; reliability scripts migrated; p0a listStalePairs probe dropped → STATE debt). Review dispatched.
Task 5: review — spec ✅, Approved (sonnet). Prompt keeps all scoring rules; stale detection = non-retired catalog (invariant non-retired ⟺ ≥1 membership verified across write paths).
Task 5: minor (deferred): stale docstring referencing listStalePairs in invalidateCoverageForSubCompetency (program-coverage-queries.ts:222).
Task 5: minor (deferred): bulk route reads stale list and catalog non-transactionally — a retire in between logs 'no competencies to score' as failed (self-heals).
Task 5: complete (commits ebe6dda..b4f0d00, review clean)
Task 6: dispatched (BASE b4f0d00; implementer sonnet)
Task 6: implementer agent a84a2efcd10df3e61 (ruling in dispatch: never write/push the real wiki repo; stub = pure content builder + thin writer, writer invoked only in Task 7)
Task 6: implementer DONE e56a334. Ruling: stub title must be the retired competency's real name (faculty-facing; slug title-casing gives "Gc Production Literacy") — add a 4th param oldName to writeMergedStub/buildMergedStubPage; Task 7 passes sub_competencies.name — cost if wrong: one extra arg. Carried into Task 6 review/fix.
Task 6: review dispatched
Task 6: review — spec ✅, Approved (sonnet).
Task 6: Ruling: the oldName fix (stub title = retired row's real name) is folded into Task 7, which is the writer's only caller and already touches this call — saves a fix round; Task 7's reviewer checks it — cost if wrong: Task 7 forgets it (named in its dispatch).
Task 6: minor (deferred): activeCompetencyIds (update.ts:471) duplicates inverse of loadRetiredCompetencyIds (course-views.ts:171).
Task 6: minor (deferred): computeAffectedPages derives target ids from unfiltered cells, refresh-all from filtered — paths disagree on regenerating a target whose only cell is on a retired competency (content already excludes it).
Task 6: complete (commits b4f0d00..e56a334, review clean)
Task 7: dispatched (BASE e56a334; implementer sonnet)
Task 7: implementer agent a9f5bacfeea67b740. Ruling (in dispatch): --skip-wiki flag mandatory for the scratch run (wiki writes push to the real repo); scratch paid run capped — stop if dry-run plans >40 calls — cost if wrong: one extra flag.
Task 7: implementer DONE_WITH_CONCERNS c0fc35e..8c69298. Real scratch run: 11 snapshots, 22 cells, $0.2978, --skip-wiki, wiki repo untouched. Incidents: (1) unscoped apply tests wrote mock values into scratch course rows (overwritten by the real run; fixed 8c69298); (2) copied main .env.local into the worktree for the run, deleted after — DATABASE_URL in process env wins under @next/env and --expect-db passed, so scratch only.
Task 7: Ruling: no .env.local copies into worktrees going forward; the live run (Task 11) is from the deploy checkout's own env with --expect-db gc_curriculum — cost if wrong: none.
Task 7: review dispatched (scope count 11 vs estimate to be verified independently)
Task 7: review — spec ✅, Approved (sonnet). Scope 11 independently reproduced (23 hit snapshots; 12 superseded or builds_to_career=false — intended listStaleSnapshots semantics).
Task 7: minor (deferred, fix before live): --skip-wiki not tied to --expect-db — a scratch run without it would push real wiki commits; make wiki writes refuse unless --expect-db gc_curriculum (or auto-skip off-live).
Task 7: minor (deferred): non-skip re-runs produce 3 timestamp-only wiki commits (not byte-idempotent).
Task 7: complete (commits e56a334..8c69298, review clean)
Task 8: dispatched (BASE 8c69298; implementer sonnet)
Task 8: implementer agent a0362ac59d65c0dc6. Ruling (in dispatch): rollback = restore of a verified pre-apply dump, preceded by a fresh -Fc backup of the current state so the restore is reversible — cost if wrong: one extra dump.
Task 8: implementer DONE 0e08cb1 (wrapper+apply-db+db-migrated; kickstart after bootstrap; rollback=restore with pre-restore safety dump). Review dispatched.
Task 8: review — Needs fixes (sonnet). CRITICAL (empirically reproduced): pg_restore --clean of a pre-0057 dump onto a post-0057 DB cannot drop sub_competencies (sub_competency_map FK depends on it) → silent no-op on the central table, half-restored DB; wrapper fails closed but leaves no recovery path. Real-DB test only restored onto the never-migrated pre clone.
Task 8: Ruling: rollback restores into a NEW database (gc_curriculum_rollback_<ts>), verifies it (probe = pre-0057, dump verifier tables present with rows), then swaps names with the app stopped and no other sessions (ALTER DATABASE gc_curriculum RENAME TO gc_curriculum_pre_rollback_<ts>; new → gc_curriculum); the migrated DB is kept intact as a fallback, so the rollback is itself fully reversible by renaming back — cost if wrong: requires rename privilege and zero connections (both already guarded) and doubles disk briefly.
Task 8: fix round 1 dispatched (resume implementer)
Task 8: fix round 1 implementer DONE 9e61bb3 (restore into new DB + rename swap; exit 5/6 partial-swap; real rbtest e2e + --clean regression guard). Scoped re-review dispatched.
Task 8: fix round 1/5 (Critical addressed; open: I-1 wrapper exit-5 text prints the forbidden bootstrap commands; I-2 name allowlist only in TS, not in p0b-apply-db.sh/wrapper env, plus unescaped name in SQL; minors: wrong 'restore intact' message, test sweep leaks rbtest DBs, silent exit on verify-query error). Round 2 dispatched with minors included.
Task 8: fix round 2 implementer DONE bf03de4 (exit-5 recovery via report_db_state_and_recovery; allowlist p0b_check_allowed_db_name in scripts+wrapper; psql -c→-f - for :'var' quoting; sweep; messages). Two real-DB tests on gc_curriculum_p0b_pre removed (now forbidden name). Scoped re-review dispatched.
Task 8: fix round 2/5 (5 addressed; new Important: tests/db/p0a-guards.test.ts:133 fails — raw-SQL backup-table guard matches p0b-apply-db.sh rollback verify query, introduced 9e61bb3).
Task 8: Ruling: add a narrow, commented exclusion for exactly scripts/migrations/p0b-apply-db.sh in the backup-table guard — the rollback must verify a pre-0057 restore, which legitimately reads snapshot_target_coverage; rephrasing to dodge a grep would hide intent — cost if wrong: one file unguarded for that table name.
Task 8: fix round 3 dispatched (+ minors: port the two removed real-DB tests to an rbtest clone; align isP0bRollbackTestDb with script allowlist; add single-quote refusal case; run full suite incl. guards)
Amendment 1 (owner 'yes', 2026-10-12): Task 8b added — docs/superpowers/plans/2026-10-12-competency-catalog-p0b-amendment-1.md (dev 5e69e56); runs after Task 8, before Task 9. Worktree must merge/cherry-pick the amendment file before dispatch.
Task 8: fix round 3 implementer DONE 878c258 (guard exclusion; restored real-DB tests on rbtest clones; exact regex; found+fixed ROLLBACK_TS uppercase T and clone teardown race). Full suite 3026/0 failed. Scoped re-review dispatched.
Task 8: fix round 3/5 (4 addressed, 0 open; commits bf03de4..878c258)
Task 8: minor (deferred): no wrapper-level stub test asserts kickstart ordering in rollback mode after a real swap (swap covered by real-DB tests only); exit-5/6 messages point operator at p0b-apply-db.sh output for generated names.
Task 8: complete (commits 8c69298..878c258, review clean after 3 fix rounds)
Task 8b: dispatched (BASE 878c258; implementer sonnet; amendment file read from main checkout, not cherry-picked — avoids STATE.md conflict on the branch)
Task 8b: implementer agent a7fcf601cf93819a2
Task 8b: implementer DONE fd0daf0 (audit; filters added incl. pre-existing gaps getMatrixData getAllCells + loadTargetSubstrate had no course filter; unlinked state; planner reports unlinked). Review dispatched (opus).
Task 8b: review (opus) — Needs fixes. I-1 missing real-DB stale-snapshot test (external/sandbox exclusion). I-2 visible changes misreported: off-path courses are ALREADY fully scored (264 cells) and were ALREADY counted in matrix stale count, coverage_for_target, scaffolding strips, target wiki pages, Explore career-fit; the new filters remove them TODAY (e.g. Brand positioning best evidence GC 3740 D4 → GC 1020 D2; 12 target/competency best-course changes); getMatrixData filter also drops 117 cells on older on-path snapshots; fixes existing "-50 stale pairs" bug.
Task 8b: controller error: I told the owner career views "stay as they are" — false; they included off-path courses. Owner decision needed on career-view scope (asked 2026-10-12). Fix round 1 proceeds on scope-independent items (I-1 test, minors 1-2); STATE/report wording waits on the decision.
Task 8b: OWNER DECISION (2026-10-12): career views keep counting ALL program-visible (gc+offered) courses as today — revises amendment ruling A2. "at some point we will need to make it selectable (based on minor, electives taken, etc.)" → P3 pathway selector (course set as a parameter of every career rollup); STATE/ROADMAP.
Task 8b: Ruling (implementing the decision): (1) revert the builds_to_career filters added in fd0daf0 for career rollups → use PROGRAM_VISIBLE scope instead (excludes external/sandbox/non-offered); (2) matrix ROWS keep builds_to_career as today; (3) keep getMatrixData's latest-snapshot-per-(course,instructor) restriction but make the stale-pair count compare only against the matrix's own row snapshots, so the existing "-50 stale pairs" bug is fixed without dropping evidence; (4) loadTargetSubstrate/scaffolding scope = program-visible; record window inconsistency (latest vs all snapshots) as debt — cost if wrong: target pages keep using older snapshots as today.
Task 8b: fix round 1 implementer DONE 80291e1 (review items 1-4 + owner scope decision; stale-pair helper lib/program/stale-pairs.ts). Scoped re-review dispatched (opus).
Task 8b: fix round 1/5 (net behavior verified: 0 diff vs base for best-course rows, coverage_for_target, matrix cells; stale count -50→10; items 1,3,4,5 addressed; item 2 STATE/report text still wrong in 3 ways). Ruling: also fix coverage_for_target printing course '?' for 88/188 entries (off-path + superseded snapshots) — with off-path now intended in career views, '?' is a visible defect in /ask — cost if wrong: small extra diff.
Task 8b: fix round 2 dispatched
Task 8b: fix round 2 implementer DONE 6e66ea0 (STATE/report corrected; comments; coverage_for_target resolves course via MatrixData.snapshotCourses). Scoped re-review dispatched.
Task 8b: fix round 2/5 (all addressed; 0 '?' entries on scratch; snapshotCourses payload ~3.7KB)
Task 8b: complete (commits 878c258..6e66ea0, review clean after 2 fix rounds)
Pre-live batch (controller): two deferred minors flagged "fix before live" go in one small dispatch before Task 9 — (1) 0057 flag note wording (Task 2 minor); (2) rescore wiki writes refuse unless --expect-db gc_curriculum (Task 7 minor). Dispatched (sonnet), BASE 6e66ea0.
Pre-live batch: DONE 0487c69 (flag note wording; rescore wiki writes only when --expect-db gc_curriculum). Review dispatched.
Pre-live batch: review Approved (sonnet). minor (deferred): no integration test of writeWiki===true branch via runRescore with mocked deps.
Pre-live batch: complete (6e66ea0..0487c69)
Task 9: dispatched (BASE 0487c69; implementer sonnet)
Task 9: implementer DONE_WITH_CONCERNS e2ad907..dba8781 (characterization vs golden passes with explicit allow-list; off-path + brand-strategy/creative-generalist byte-identical; suite 3039; build ok). pg_stat_activity poll on the live server was denied by the auto-mode classifier ("Production Reads"); implementer did not route around it.
Task 9: Ruling: accept indirect evidence for zero live connections during build, and have the adversarial reviewer re-run the P0a-style proof instead (next build with DATABASE_URL pointing at a NONEXISTENT database must exit 0) — that proves no build-time DB read without touching the live server — cost if wrong: none (live is never contacted by either check).
Task 9: review dispatched (sonnet) in parallel with Task 10 adversarial review (opus) — both read-only; Task 9 diff is test+docs only.
Task 9 review agent abf85e2977b74a472; Task 10 adversarial agent a055165783628fdf7 (report → adversarial-review.md)
Task 9: review — Needs fixes (sonnet). CRITICAL: STATE.md still describes P0b rollback as in-place dump restore (Ruling 11) — the mechanism Task 8 proved broken; restore-into-new-DB + rename swap undocumented. Important: contributingCourses for 3 affected targets dropped from comparison wholesale; red-proof output not pasted. Fix round 1 dispatched (resume implementer).
Task 9: fix round 1 implementer DONE 65e0d80 (STATE rollback design documented, Ruling 11 superseded; narrow contributingCourses rule; red-proof output pasted). Scoped re-review dispatched.
Task 10: adversarial review — REJECT (opus). 0057, verify, runbook, restore+swap rollback passed every attack; build against nonexistent DB exit 0 with 0 connection attempts. I-1 rescore scope still builds_to_career → 8 off-path latest snapshots' survivor cells stay pre-merge; flags falsely say "Re-scored". I-2 rescore fires wiki regenerations un-awaited then process.exit → 0/11 completed.
Task 10: Ruling: rescore scope = EVERY non-retired snapshot with a merge-group cell (not only latest per course/instructor), program-visible — makes every flag's "re-scored" note true incl. GC 1010's representative capture (M-8) — cost if wrong: ~23 calls ≈ $0.6 on live instead of 11.
Task 10: Ruling: fix wave also takes M-1 (requirement count relative, not hard-coded 35), M-2 (failed-verify dump renamed *.rejected), M-3 (rollback success text), M-4 (STATE: run rollback from a P0b checkout), M-5 (re-pointed flags get flagged_context of the survivor's carried cell), M-6 (0057 precondition: career_target_demand has 0 rows on merge ids, else refuse). Deferred: M-7 (rescore re-run rough edges), M-9 (dev scratch script URL on argv; no password on this host).
Task 10: fix wave 1 dispatched (resume Task 7 implementer a9f5bacfeea67b740)
Task 9: fix round 1/5 (2 addressed: STATE rollback doc verified line-by-line against scripts; red-proof pasted). Finding 2 residual: narrow contributingCourses rule excises merge-explained courses from BOTH sides, so a regression dropping exactly gc-4900ap from account-management passes (verified by injection).
Task 9: parked — contributingCourses blind spot for merge-explained courses (one course/target today) — Ruling: accept as documented residual; it is test-only, the old rule had no comparison at all for these targets, and the hostile-review fix wave re-scores those snapshots anyway (changing that delta); final review sees it — cost if wrong: one unlikely regression class in one target's contributing-course list goes undetected by this test.
Task 9: complete (commits 0487c69..65e0d80, 1 parked)
Task 10: fix wave 1 implementer DONE — I-1 (scope: PROGRAM_VISIBLE_SQL, every non-retired snapshot not just latest), I-2 (await every wiki write sequentially via new regenerateWikiForSnapshot, per-item report, non-zero exit on failure, DB writes never undone), M-1/M-2/M-3/M-4/M-5/M-6 fixed with red-proofed tests; M-7/M-9 deferred per ruling. Dry-run on scratch confirms I-1's real scope: 23 snapshots (matches the ~23 estimate exactly) — well under the raised 60-call stop threshold. See task-7-report.md "Hostile-review fix wave" for full detail. Full suite (DATABASE_URL unset) green; gated P0b files green with --no-file-parallelism; characterization test green on main scratch.
Task 10: fix wave 1 DONE dd9dd36 (I-1 scope 23 snapshots via dry-run, I-2 awaited wiki writes, M-1..M-6). Adversarial re-review round 2 dispatched (opus) → adversarial-review-2.md
Task 10: adversarial round 2 — REJECT (opus). All round-1 items verified fixed by running. New I-3 (from I-1 fix): rescore regenerates the wiki per in-scope snapshot incl. 4 superseded captures, each treated as newest → GC 1010 page rewritten from the July capture (deterministic); GC 3800/4800 order-dependent (no ORDER BY). 7 minors.
Task 10: Ruling: wiki regeneration after rescoring = once per course from its LATEST non-retired snapshot (whether or not in scope) + one program-wide pass, not per scored snapshot — cost if wrong: none (fewer calls).
Task 10: Ruling: M-5 reversed — re-pointed faculty flags KEEP their original flagged_context (the disputed reading is a record); 0057 prefixes the note with "[moved from <old-id> by the P0b merge] " instead — cost if wrong: drift display compares against a different competency's baseline, labelled.
Task 10: fix wave 2 takes I-3, m1 (4-column insert count + read-only 0057 precondition/count preflight run by the wrapper BEFORE bootout, incl. M-6), m2 (dry-run prints wiki call estimate; wiki pass checks daily cap), m5 (per-item try/record for scoring), m6 (--wiki-only retry flag + cost warning), m7, hard --max-calls in code (default 40); m4 → one line in STATE Task 11 procedure ("run when no captures are in flight").
Task 10: fix wave 2 dispatched (resume a9f5bacfeea67b740)
Task 10: fix wave 2 DONE edb1600 (I-3 per-course latest regen + program pass; preflight before bootout; 4-col count; M-5 reversed; wiki estimate 25; --max-calls 40; --wiki-only). Adversarial round 3 dispatched (opus) → adversarial-review-3.md
Task 10: adversarial round 3 — ACCEPT (opus). I-3 verified via real main(): 23 scored, 18 courses each regenerated once from latest snapshot (GC 1010 from ad0539fa), 1 program pass; preflight read-only and ordered before build/bootout (real wrapper e2e on clones). 7 minors n1–n7.
Task 10: complete (commits dba8781..edb1600, honest ACCEPT round 3)
Final whole-branch review dispatched (opus) → final-review.md; n1 (cap trip at wiki check exits 0 with stubs written), n2 (wiki-only retry not free; needs --apply), n3 (preflight/0057 SQL unpinned), n6 (rbtest sweep drops other sessions' clones) queued for the single final fix wave.
Final review: Ready with fixes (opus). I-1 STATE stale (review pending, pg_stat concern open, retire semantics, counts). I-2 Task 11 live procedure not written in order (expect-db, deploy env, cost ~23 scoring ≈$0.6 + ~25 wiki unmetered; PRODUCTION DAILY CAP IS WARN-ONLY so --max-calls is the only hard stop; flags say "Re-scored" before rescore runs; wrapper success text omits rescore). I-3 merge conflict: one STATE hunk; dev's amendment bullet says career rollups path-only — reversed by owner decision 3; fix in merge commit. 11 minors.
Ruling: the base plan file's dated "Amendment (Task 2 review)" note under Ruling 4 stays — it is an appended, dated addition, not a rewrite — cost if wrong: purist append-only violation.
Ruling: ONE final fix dispatch = I-1, I-2 (ordered procedure in STATE + wrapper success text + its test), n1 (cap stop during scoring OR wiki exits non-zero with accurate message), n2 wording, n3 (test pinning preflight SQL to 0057), n6 (rbtest sweep only drops this test run's clones), Task 5 stale docstring. I-3 resolved by controller in the owner-approved merge commit. Rollback-leaves-wiki-post-P0b → STATE debt line.
Final fix dispatched (resume a9f5bacfeea67b740)
Final fix wave DONE 6769c28 (I-1, I-2 procedure + wrapper text, n1, n2, n3 pin test, n6 scoped sweep, docstring, wiki-rollback debt). Scoped re-review dispatched.
Final fix wave: scoped re-review all addressed. Branch ready: feat/competency-catalog-p0b @ 6769c28. Task 11 STOP — asking owner.
Task 11 step 1: merged to dev 92a7f99, pushed (owner 'Do 1-4'). Wiki rebuild deferred (owner): rescore runs --skip-wiki.
Task 11 step 2: deploy checkout ff'd a516ad3 → 92a7f99; live-apply wrapper running (bg ba3m2d40l), log scratchpad/p0b-live-apply.log
Task 11 step 2: P0b APPLIED to live (verify all pass; backup pre-apply-20261012T204818.dump; app+watchdog restarted cleanly with kickstart); smoke 200s, no log errors. Step 3: live dry-run 23 snapshots/23 calls. Step 4: rescore --apply --skip-wiki --max-calls 30 running (bg bvb1rq279).
Task 11 complete: rescore 23/23, 46 cells, $0.6130; STATE e17592a; dev+main pushed. P0b applied to production 2026-10-12.
