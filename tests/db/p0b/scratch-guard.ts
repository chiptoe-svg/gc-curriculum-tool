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
