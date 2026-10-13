/**
 * P1 DB tests run ONLY against the clone built by
 * scripts/migrations/p1-scratch-db.sh: gc_curriculum_p1_scratch.
 * Nothing else is accepted — not live, not the P0a/P0b scratch clones.
 */
export const SCRATCH_DB = 'gc_curriculum_p1_scratch';

export function isP1ScratchDb(): boolean {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname === `/${SCRATCH_DB}`;
  } catch {
    return false;
  }
}
