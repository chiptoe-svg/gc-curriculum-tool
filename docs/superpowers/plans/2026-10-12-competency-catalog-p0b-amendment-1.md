# Competency Catalog P0b, Amendment 1: unlinked competencies and scoring courses off the career path

> **For agentic workers:** this file is an addition to [`2026-10-12-competency-catalog-p0b.md`](./2026-10-12-competency-catalog-p0b.md). It does not replace it. That plan's Global Constraints apply unchanged. Task 8b runs after Task 8 and before Task 9.

**Owner decision (2026-10-12):** "With our changes, we should be able to generate competencies (that could be linked later — i.e. if we determined that something is needed for a particular career path)." The owner approved adding this to P0b.

**Why:** spec §2 and §3 make the catalog independent of career targets. Two P0b choices currently contradict that:

1. **Retiring on last removal.** The P0b plan's Task 3 retires a competency when its last target membership is removed. That enforces "active ⟺ used by ≥1 target", so an unattached competency cannot exist.
2. **Scoring only career-path courses.** Coverage scoring is limited to courses with `builds_to_career = true`. That restriction was needed only while scoring used a target's context. Since Task 5, scoring uses each competency's own descriptors.

## Rulings

- **A1. Unlinked is a valid active state.**
  - Removing a competency from its last target leaves `retired = false`. `retireCompetencyFromTarget` returns `'unlinked'` in that case (instead of `'retired'`) and keeps its `FOR UPDATE` lock.
  - Retiring is a separate, explicit catalog action. There is no new UI for it in P0b. The target-batch definitions (`RETIRED_SUB_COMPETENCIES`) remain the way to retire.
- **A2. Two scopes for coverage.**
  - **Scoring scope:** every program-visible course (`scope = 'gc' AND status = 'offered'`, i.e. `PROGRAM_VISIBLE_SQL`), regardless of `builds_to_career`. Each latest snapshot is scored against the whole active catalog, linked and unlinked.
  - **Career rollup scope:** anything that rolls up to a career target counts only courses with `builds_to_career = true`, exactly as today. That covers the program matrix, scaffolding, stale-pair UI, sufficiency, Explore career-fit/ripple/scenario, the target wiki pages, readiness and position capture.
  - **Per-competency and per-course views:** these include all program-visible courses. That covers competency wiki pages, course pages with their competency links, and the prerequisite gap engine where it is per competency.
- **A3. The planner tolerates unlinked catalog rows.**
  - An active database competency that is in no target and not in the definitions is reported as `unlinked` in the plan output. It is never retired automatically, and it is never an error.
  - A `{ ref: '<id>' }` that points at an unlinked database competency, without a definition in the constants, is an error. This is the existing Rule 1 ("ref has no definition"). To link an existing unlinked competency through the batch, its definition must be added to `seed-targets.ts`.
- **A4. Cost.** Nothing is scored by the migration or by this task's code changes. The newly in-scope snapshots, about 8–10 for courses off the career path, are scored by the next owner-triggered bulk refresh, at about one AI call each. Task 11 lists this as an optional post-deploy step that needs owner approval.

---

### Task 8b: Unlinked competencies, plus scoring off the career path

**Files:**
- `lib/db/competency-catalog-queries.ts` (`retireCompetencyFromTarget`)
- `app/api/targets/[id]/sub-competencies/[scId]/retire/route.ts` and `tests/api/targets.test.ts`
- `lib/domain/target-batch.ts` (unlinked reporting) and its tests
- `lib/db/program-coverage-queries.ts` (`listStaleSnapshots` scope)
- Every career-rollup reader of `target_coverage` / `targetCoverage` (audit list below)
- `tests/db/p0b-retire-competency.test.ts`, `tests/db/p0b-scoring.test.ts`, a new `tests/db/p0b-rollup-scope.test.ts`
- `docs/STATE.md`

- [ ] **Step 1: Write the failing tests.**
  1. **Retire on the last target.** `retireCompetencyFromTarget` on a competency's only target returns `'unlinked'`, leaves `retired = false`, and leaves 0 requirement rows. The two-connection race test still ends in a consistent state: both targets removed, `retired = false`, 0 rows. Update its expected result from "retired" to "unlinked".
  2. **Retire route.** It returns `{ ok, result: 'unlinked', competencyId }` for the last-target case.
  3. **Planner reporting.** An active database competency that is in no target and absent from the definitions shows in the plan as `unlinked` and produces no writes.
  4. **Stale snapshots.** Run against the main scratch (gated on `isP0bMainDb()`) in a rolled-back transaction. A latest snapshot of a program-visible course with `builds_to_career = false`, missing a cell, is reported as stale. An `external` or `sandbox` course is not.
  5. **Rollup isolation** (`p0b-rollup-scope.test.ts`, main scratch, rolled-back transaction):
     - Insert a cell with D = 5 for an off-path course's latest snapshot on a competency used by a target.
     - For every career-rollup reader (the audit list below), the output for that target is byte-identical to the output before the insert.
     - The competency wiki substrate does include the off-path course.
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3: Audit, then implement.**
  - **Audit.** `grep -rn "targetCoverage\|target_coverage" app lib --include=*.ts`. For each reader, classify it as a career rollup or a per-competency/per-course view. Record the list in the task report and in a comment above `listStaleSnapshots`.
  - **Implement.**
    - Every career rollup must filter `courses.builds_to_career = true`. Add the filter where it is missing; most already have it, e.g. `getMatrixData`.
    - Change `listStaleSnapshots` to the program-visible scope.
    - Change `retireCompetencyFromTarget` and the route as ruled in A1.
    - Add the planner's `unlinked` report (A3).
- [ ] **Step 4: Verify.**
  - Run the touched tests, then the full suite with `DATABASE_URL` unset, then the gated P0b files on the main scratch.
  - Run `tsc` and eslint on the changed files.
  - Re-run the Task 4 dry-run. It must still show zero changes and zero errors.
- [ ] **Step 5: Commit** with message `feat(catalog): unlinked competencies; score all program-visible courses, career rollups stay path-only`. Update STATE.md in the same commit:
  - the scoring scope change;
  - the unlinked state;
  - Deferred/debt: there is no UI to link an existing unlinked competency to a target (P1/P2b).
