/**
 * P0b DB tests run ONLY against one of the two clones built by
 * scripts/migrations/p0b-scratch-db.sh:
 *   - gc_curriculum_p0b_scratch — the main scratch, migrated to 0057 from
 *     Task 3 Step 4 onward and kept for ongoing P0b development.
 *   - gc_curriculum_p0b_pre — a second clone kept pre-0057 forever, used
 *     only by the migration rehearsal test and the pre-migration golden
 *     capture.
 * Nothing else is accepted.
 */
export const SCRATCH_DB = 'gc_curriculum_p0b_scratch';
export const SCRATCH_DB_PRE = 'gc_curriculum_p0b_pre';

export function isP0bScratchDb(): boolean {
  try {
    const path = new URL(process.env.DATABASE_URL ?? '').pathname;
    return path === `/${SCRATCH_DB}` || path === `/${SCRATCH_DB_PRE}`;
  } catch {
    return false;
  }
}

/**
 * Gate for anything that needs the PRE-0057 clone specifically (the
 * migration rehearsal test). gc_curriculum_p0b_pre stays pre-0057 forever
 * (controller ruling, Task 3 fix round 1) — gc_curriculum_p0b_scratch does
 * NOT satisfy this, even though isP0bScratchDb() accepts both: the main
 * scratch was migrated to post-0057 by Task 3 Step 4, so running the
 * migration body against it trips its own "already applied" guard.
 */
export function isP0bPreDb(): boolean {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname === `/${SCRATCH_DB_PRE}`;
  } catch {
    return false;
  }
}

/**
 * Gate for anything that needs the MAIN (post-0057) clone specifically
 * (e.g. retireCompetencyFromTarget tests, which need the merged, shared
 * career_target_requirements rows that only exist after 0057).
 * gc_curriculum_p0b_pre does NOT satisfy this.
 */
export function isP0bMainDb(): boolean {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname === `/${SCRATCH_DB}`;
  } catch {
    return false;
  }
}

/**
 * Gate for the rollback-swap real-DB test (fix round 1,
 * tests/db/p0b-rollback-swap.test.ts) ONLY. That test runs
 * scripts/migrations/p0b-apply-db.sh's rollback mode for real, which
 * CREATEs a new database and RENAMEs it and the target database it was
 * invoked against — never something to point at a shared fixture.
 * Controller ruling (fix round 1): "You may not use live or the two P0b
 * scratch databases as targets."
 *
 * Fix round 3: this predicate now matches EXACTLY the allowlist regex
 * the production scripts themselves enforce (p0b_check_allowed_db_name,
 * scripts/migrations/p0a-lib.sh) — `^gc_curriculum_p0b_rbtest[a-z0-9_]*$`
 * — rather than its own, looser "exact name or name_-prefixed" check.
 * Round 2's version required an underscore before any suffix
 * (`gc_curriculum_p0b_rbtest2` was rejected here even though the
 * SCRIPTS themselves accept it), which meant the round-2 leaked-database
 * sweep (tests/db/p0b-rollback-swap.test.ts) could in principle miss a
 * name the scripts would happily create/rename/accept. Matching exactly
 * closes that gap.
 */
export const ROLLBACK_TEST_DB = 'gc_curriculum_p0b_rbtest';
const ROLLBACK_TEST_DB_PATTERN = /^gc_curriculum_p0b_rbtest[a-z0-9_]*$/;

export function isP0bRollbackTestDb(name: string): boolean {
  return ROLLBACK_TEST_DB_PATTERN.test(name);
}
