/**
 * Catalog-additions (CA) DB tests run ONLY against one of the two clones
 * built by scripts/migrations/ca-scratch-db.sh:
 *   - gc_curriculum_ca_scratch: the main scratch the insert and later tasks
 *     develop against.
 *   - gc_curriculum_ca_pre: kept pre-change, used only for rehearsal tests.
 * Nothing else is accepted: not live, not any older phase's clone.
 */
export const CA_SCRATCH_DB = 'gc_curriculum_ca_scratch';
export const CA_PRE_DB = 'gc_curriculum_ca_pre';

function dbNameIs(name: string): boolean {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname === `/${name}`;
  } catch {
    return false;
  }
}

export function isCaScratchDb(): boolean {
  return dbNameIs(CA_SCRATCH_DB);
}

export function isCaPreDb(): boolean {
  return dbNameIs(CA_PRE_DB);
}
