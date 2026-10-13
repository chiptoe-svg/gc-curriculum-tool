/**
 * P2 DB tests run ONLY against one of the two clones built by
 * scripts/migrations/p2-scratch-db.sh:
 *   - gc_curriculum_p2_scratch: the main scratch. Task 2 real-applies 0059
 *     to it, and later tasks develop against it.
 *   - gc_curriculum_p2_pre: kept pre-0059 forever, used only by the
 *     migration rehearsal test (tests/db/p2-migration.test.ts).
 * Nothing else is accepted: not live, not any older phase's clone.
 */
export const SCRATCH_DB = 'gc_curriculum_p2_scratch';
export const PRE_DB = 'gc_curriculum_p2_pre';

function dbNameIs(name: string): boolean {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname === `/${name}`;
  } catch {
    return false;
  }
}

export function isP2ScratchDb(): boolean {
  return dbNameIs(SCRATCH_DB);
}

export function isP2PreDb(): boolean {
  return dbNameIs(PRE_DB);
}
