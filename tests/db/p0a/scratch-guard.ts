/** P0a DB tests run ONLY against the scratch clone (scripts/migrations/p0a-scratch-db.sh). */
import { isP0bScratchDb } from '../p0b/scratch-guard';

export const SCRATCH_DB = 'gc_curriculum_p0a_scratch';

// P0b (Task 1) reuses this test's probes to capture a pre-0057 golden
// against its own scratch clones. Rather than weakening this match (e.g.
// a looser pattern), a second exact accepted name is added via
// isP0bScratchDb() — still a strict allowlist, just two names instead of
// one.
export function isScratchDb(): boolean {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname === `/${SCRATCH_DB}` || isP0bScratchDb();
  } catch {
    return false;
  }
}
