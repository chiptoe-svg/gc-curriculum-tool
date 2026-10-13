/**
 * P1 DB tests run ONLY against one of the two clones built by
 * scripts/migrations/p1-scratch-db.sh:
 *   - gc_curriculum_p1_scratch — the main scratch. Task 2 real-applied 0058
 *     to it, and later tasks keep developing against it.
 *   - gc_curriculum_p1_pre — a second clone kept pre-0058 forever (fix
 *     round 1, controller ruling — same reasoning as P0b's
 *     gc_curriculum_p0b_pre), used only by the migration rehearsal test
 *     (tests/db/p1-migration.test.ts).
 * Nothing else is accepted — not live, not the P0a/P0b scratch clones.
 */
export const SCRATCH_DB = 'gc_curriculum_p1_scratch';
export const PRE_DB = 'gc_curriculum_p1_pre';

export function isP1ScratchDb(): boolean {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname === `/${SCRATCH_DB}`;
  } catch {
    return false;
  }
}

/**
 * Gate for anything that needs the PRE-0058 clone specifically (the
 * migration rehearsal test, tests/db/p1-migration.test.ts). Fix round 1:
 * gc_curriculum_p1_scratch does NOT satisfy this, even though it is also a
 * "P1 scratch" DB — it was real-applied past 0058 by Task 2 Step 7, so
 * running 0058's own body against it trips the migration's own
 * already-applied guard on every case instead of exercising it fresh.
 * Same reasoning as P0b's isP0bPreDb() vs isP0bScratchDb().
 */
export function isP1PreDb(): boolean {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname === `/${PRE_DB}`;
  } catch {
    return false;
  }
}

/**
 * Gate for anything that needs the MAIN (already-migrated, post-0058)
 * clone specifically — e.g. the constraint-name drift test
 * (tests/db/p1-constraint-names.test.ts), which reads real `pg_constraint`
 * rows that only exist once 0058 has actually been applied.
 * gc_curriculum_p1_pre does NOT satisfy this (same semantics today as
 * isP1ScratchDb(), named separately for parity with isP1PreDb() and so a
 * future second P1 "main-only" DB, if one is ever added, has a name to
 * grow into without touching every existing caller).
 */
export function isP1MainDb(): boolean {
  return isP1ScratchDb();
}
