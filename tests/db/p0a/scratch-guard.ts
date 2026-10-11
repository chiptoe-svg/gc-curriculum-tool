/** P0a DB tests run ONLY against the scratch clone (scripts/migrations/p0a-scratch-db.sh). */
export const SCRATCH_DB = 'gc_curriculum_p0a_scratch';

export function isScratchDb(): boolean {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname === `/${SCRATCH_DB}`;
  } catch {
    return false;
  }
}
