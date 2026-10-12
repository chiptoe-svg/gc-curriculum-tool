/** P0a DB tests run ONLY against the scratch clone (scripts/migrations/p0a-scratch-db.sh). */
import { isP0bScratchDb } from '../p0b/scratch-guard';

export const SCRATCH_DB = 'gc_curriculum_p0a_scratch';

// Gate for the P0a WRITE tests (p0a-migration, p0a-apply-db,
// p0a-coverage-writes, p0a-catalog-writes). Accepts ONLY the P0a scratch
// clone. Do NOT broaden this to the P0b clones (fix round 1, 2026-10-12):
// those write tests roll back/re-apply migration 0056 and mutate rows, and
// later P0b tasks run the full suite with DATABASE_URL set to a P0b
// clone — a broadened isScratchDb() would un-gate these writers against
// gc_curriculum_p0b_scratch (corrupting the post-0057 dev clone) or
// gc_curriculum_p0b_pre (mutating the clone that must stay pre-0057
// forever). Use isCharacterizationDb() below for anything that only reads.
export function isScratchDb(): boolean {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname === `/${SCRATCH_DB}`;
  } catch {
    return false;
  }
}

// Gate for the P0a characterization test ONLY (capture + compare; read-only
// probes, no writes). P0b (Task 1) reuses that test's probes to capture a
// pre-0057 golden against its own scratch clones, so this — and only this —
// predicate also accepts the two P0b clones via isP0bScratchDb(). Never
// import this into a write test.
export function isCharacterizationDb(): boolean {
  return isScratchDb() || isP0bScratchDb();
}
