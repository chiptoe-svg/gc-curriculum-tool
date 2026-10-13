# SDD ledger — plan: docs/superpowers/plans/2026-10-12-competency-catalog-p1.md
Spec: docs/superpowers/specs/2026-10-11-competency-catalog-and-career-demand-design.md (reachable)
Setup: worktree /Users/admin/projects/curriculum_developer-wt-p1 from dev a9b0480.

## Preflight scan
| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T1→T2..T6 | p1-scratch-db.sh url + isP1ScratchDb | consistent |
| T2→T3,T4,T5 | 0058 tables/columns + Drizzle exports (careerTargetOccupations, onet*, subCompetencies.origin) | consistent |
| T3→T4 | loader reads rated codes from career_target_occupations (needs T3 run on scratch) | consistent: T3 Step 5 populates scratch before T4 Step 5 |
| T3 self | buildOccupationMix needs rated-code set; CLI --onet-dir builds it from CSV | consistent (rated = codes with ratings in knowledge.csv, per Ruling 3 check) |
| T4 self | fixture CSVs under tests/fixtures/onet must be synthetic | consistent |
| T5 | gated on owner approval of business-acumen JSON | ruled: T5 dispatches only after approval; T6 may run before T5 if approval pending |
| T2 self | UNIQUE NULLS NOT DISTINCT on PG17 | ok |
| T2 self | CHECK (onet_status='rated') = (onet_soc_code IS NOT NULL) vs Ruling 3 'no_fit'/'unrated' NULL | consistent |
| T6/T7 | P0b characterization only on p0b scratch | consistent |

Ruling: Task 5 waits for owner approval of the business-acumen file; if pending when Task 4 completes, run Task 6 first and return to Task 5 — cost if wrong: ordering only.
Ruling: "rated" in Ruling 3 = the O*NET code has rows in knowledge.csv (the element-rating files share coverage) — cost if wrong: a code rated in other domains but not knowledge is treated unrated; the implementer reports any such code.
Task 1: dispatched (BASE a9b0480; implementer sonnet a7826b43f2834f5f4)
Task 1: implementer DONE b2a0a2c; review dispatched. Task 2: dispatched (BASE b2a0a2c; sonnet) in parallel with T1 review (review is read-only).
Task 1 review agent ad5ca445fcc8cc2a1; Task 2 implementer aa6c2df8593f83587
Task 1: review — Approved (sonnet). minor (deferred): p1-scratch-db.sh inherits P0b M-9 (live URL on child-process argv; no password on this host) — note as inherited debt in STATE at Task 6.
Task 1: complete (commits a9b0480..b2a0a2c, review clean)
Task 2: implementer DONE 0ea77ce (13/13 migration test; 0058 applied to p1 scratch; verify clean). Concern: migration test now FAILS (11/13 "already applied") when pointed at the applied scratch.
Task 2: Ruling: same fix as P0b — add a pre-0058 clone gc_curriculum_p1_pre (p1-scratch-db.sh create-pre/url-pre/drop-pre) and gate the migration test on it (isP1PreDb), main scratch stays post-0058 — a failing-not-skipping test would poison later full-suite runs — cost if wrong: one extra local DB. Carried into the Task 2 review/fix.
Task 2: review dispatched (sonnet)
Task 2: review — Needs fixes (sonnet): I-1 four Drizzle constraint names don't match Postgres auto-names; I-2 round-trip test doesn't compare sub_competencies constraints. Fix round 1 dispatched with the pre-0058 clone ruling (resume implementer).
Task 5 gate: owner APPROVED business-acumen competencies (2026-10-12); file committed to dev d4c9c6e — Task 5 reads it from the main checkout path.
Task 2: fix round 1 implementer DONE baff272 (7 constraint names fixed + drift test; constraint round-trip; gc_curriculum_p1_pre + isP1PreDb/isP1MainDb). Scoped re-review dispatched.
Task 2: fix round 1/5 (3 addressed, 0 open; commits 0ea77ce..baff272)
Task 2: minor (deferred): constraint-name drift test's committed red-proof is abstract (corrupts the compared array); the real revert-to-0ea77ce red-proof is report-claimed only.
Task 2: complete (commits b2a0a2c..baff272, review clean)
Task 3: dispatched (BASE baff272; implementer sonnet)
Task 3: implementer DONE 37cc127 (270 rows; unrated+no_fit 2.7%–21.7%; idempotent). Review dispatched; Task 4 dispatched in parallel (BASE 37cc127).
Task 3 review agent a0cd47a0fc94cff37; Task 4 implementer a6c43c386b73fdbc6
Task 3: review — Approved (sonnet). 270/270 rows independently recomputed, exact match. n discrepancy = prose error (n=23, 12 distinct SOCs), code uses export n.
Task 3: minor (deferred → fix in Task 6 STATE pass): STATE.md Task 3 bullet says "small n = 12" for ai-workflow/growth; correct to "n=23, 12 distinct SOCs".
Task 3: complete (commits baff272..37cc127, review clean)
Task 4: implementer DONE 13b8a35 (96 occs, 30,912 element ratings, 2,044 task stmts, 18,081 task ratings; whole-release replace; chunked inserts). Review dispatched; Task 5 dispatched in parallel (BASE 13b8a35).
Task 4 review agent a4a71ad2dd4a2ae84; Task 5 implementer a46aa82a0a4055452
Task 4: review — Approved (sonnet). Counts independently recomputed (96 / 30,912 / 2,044 / 18,081) exact; 5 spot-checks exact; attribution verbatim.
Task 4: Ruling: whole-release delete+reinsert (vs per-code) accepted — idempotent, drops codes that leave the mix with no orphans — cost if wrong: none at this size.
Task 4: minor (deferred): no NaN guard on numeric O*NET cells (lib/onet/load.ts:71 and Number() calls) — latent for a malformed future release.
Task 4: complete (commits 37cc127..13b8a35, review clean)
Task 5: implementer DONE 1cbc8a7 (4 inserted unlinked gc_authored + identity map rows; 2nd apply refuses; planner reports 4 UNLINKED). Script path scripts/catalog/ vs plan scripts/careers/. Review dispatched.
Owner 'Yes' (2026-10-12): sent gc_alumni the odd-SOC coding-check list (entry: Athletes, HR, Funeral Attendants, Personal Care Aides etc.; growth: coding-only confirmation). Re-ingest on new stamp.
Task 5: review — Approved (sonnet). Text byte-exact; unlinked; map 40==40; atomic; refusals before writes. Path scripts/catalog/ accepted (better home).
Task 5: minor (deferred → Task 6): STATE Task 5 bullet should cross-reference that the P1 rollback refuses until these 4 rows are removed.
Task 5: complete (commits 13b8a35..1cbc8a7, review clean)
Task 6: dispatched (BASE 1cbc8a7; sonnet) — includes STATE fixes: n=23 wording, rollback cross-ref, inherited M-9 note.
gc_alumni: coding check done — new export stamp (file 28d072e, generated 4b62398, data a502698a5d3b0c89). Systematic fix: producer/video roles miscoded as Actors/Athletes/Coaches → 27-2012 (16) + 27-4031/4032/4011 (4); 7 one-offs fixed; rest confirmed real. Logged as AI review (batch soccheck-2026-10-12), single-coder caveat stands. Ruling: Task 6 re-runs ingest + O*NET load on p1 scratch with the new stamp and records it; live uses the new stamp.
Task 6: implementer DONE 5669efb (suite 3134 green; P1 gated 72/72; build ok; P0b characterization 1/1; re-ingest new stamp 4b62398/a502698a5d3b0c89: 266 rows, 101 SOCs, 91 rated codes; STATE consolidated).
Ruling: load-onet.ts defaulting to APPLY (other CLIs default dry-run) is a live footgun — fix to require --apply, in the hostile-review fix wave — cost if wrong: none.
Task 6 review (sonnet) + Task 7 hostile review (opus) dispatched in parallel (both read-only).
Task 6: review — Approved (sonnet). Figures verified on scratch (266 / stamp / 91 / 91); runbook flags match parsers; 5/5 minors in STATE.
Task 6: complete (commits 1cbc8a7..5669efb, review clean)
Task 7: hostile review — REJECT (opus). Data paths exact (266 rows recomputed; O*NET field-for-field). I-1: new code reads sub_competencies.origin → 500s on a pre-0058 DB (stale-refresh route, add-competency route, readCatalogState); plan's "deploy then apply" order and rollback-under-new-code break live; old code unaffected by 0058 (17 probes identical). I-2: inserting 4 unlinked competencies makes 21 snapshots stale (was 4), 156 missing cells; button still says "Score 10 stale pairs"; one click = 21 heavy calls (~$0.45) + 21 course-wiki regenerations, unannounced. 7 minors.
Task 7: Ruling: live order = backup → apply 0058 + verify with the OLD app running (additive; old code proven unaffected) → deploy new build → ingest → O*NET load → insert; rollback = revert code to pre-P1 build FIRST, then rollback SQL. Supersedes plan Ruling 8's ordering — cost if wrong: none.
Task 7: Ruling: scoring the 4 unlinked competencies is intended (owner amendment 1) but must be announced: STATE + runbook add an explicit owner-gated post-deploy step "bulk scoring refresh: ~21 calls ≈ $0.45 + course-wiki regenerations"; the /program button must state the real work (snapshots/calls), not matrix pairs — cost if wrong: none.
Task 7: fix wave takes I-1, I-2 (+ button label), load-onet requires --apply, m1, m2 (UI-created competencies origin gc_authored), m4 (--release pinned/validated; report filters release), m5 (lock_timeout), m6 (verify content checks), m7 (concise error output). m3 deferred.
Task 7: fix wave dispatched (resume Task 6 implementer a598bcb19eba1ff5f)
Task 7: fix wave DONE bfa12b4 (I-1 order + dependency test; I-2 announced + button counts snapshots; load-onet requires --apply; m1,m2,m4,m5,m6,m7). Incident: psql -f 0058 run on gc_curriculum_p1_pre, rolled back via rollback script, 18/18 migration rehearsal green after. Adversarial round 2 dispatched (opus).
Task 7: adversarial round 2 — ACCEPT (opus). I-1/I-2 verified by running (button "Score 21 stale snapshots" = 21 attempted calls); p1_pre restored (data hash + schema = baseline). 10 minors; top: runbook steps 2–3 run 0058/verify by relative path from the OLD deploy checkout, which lacks the files.
Task 7: hostile review complete (commits 5669efb..bfa12b4, ACCEPT round 2)
Final whole-branch review dispatched (opus) → final-review.md
Final review: Ready with fixes (opus). I-1 runbook steps 2–3 relative paths from old deploy checkout; I-2 backup dir missing + no backup verification; I-3 no runnable rollback (file absent after revert; gc_authored precondition has no documented way out; DROP COLUMN no lock_timeout). Merge clean. Ruling: ONE final fix dispatch = I-1..I-3 + n2 (catalogBatchWriter origin) + minors: STATE 're-review pending', step 4 merge detail, /program 'pairs scored' header, onet_release.loaded_at on reload, dead ONET_* constants/dup assertExpectedDb. Dispatched (resume a598bcb19eba1ff5f).
Final fix wave DONE 3fe02b0 (runbook executable: merge→apply→deploy order, p1-backup.sh, numbered rollback, n2, minors). Scoped re-review dispatched.
Final fix scoped re-review: all items ADDRESSED (I-1..I-3, n2, minors; tests re-run). 2 residual runbook text breaks: step 1 backup path absent before merge; step 2 `git checkout main` blocked by deploy worktree lock.
Ruling: residuals adjudicated, not a second fix wave — corrected in the owner-approved merge commit's STATE.md text: order becomes merge into dev → backup (script now present) → apply 0058 → verify → push `<sha>:main` (no local checkout of main, as P0a/P0b deploys did) → deploy checkout ff → ingest/load/insert; the controller runs these steps itself under the owner's go-ahead — cost if wrong: none (both failures were fail-safe before any live write).
minor (deferred): p1-backup.sh has no committed automated test (manually verified twice).
P1 branch ready @ 3fe02b0. Task 7 STOP — asking owner.
Task 7 complete: P1 applied to production 2026-10-13 (merge 8a64161; backup pre-apply-20261013T101508.dump; 266/91/4); STATE 28243c36578bef0ca1a0045ab860a79ba4418bd8; scoring refresh not run (owner later).
