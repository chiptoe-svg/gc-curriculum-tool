/**
 * What-if DB tests run ONLY against the clone built by
 * scripts/migrations/whatif-scratch-db.sh (gc_curriculum_whatif_scratch).
 * Nothing else is accepted: not live, not any other phase's clone.
 */
export const SCRATCH_DB = 'gc_curriculum_whatif_scratch';

export function isWhatIfScratchDb(): boolean {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname === `/${SCRATCH_DB}`;
  } catch {
    return false;
  }
}
