// Unit test for the P1 scratch-guard predicates. No DB access — this only
// exercises the pure string/URL matching, so it always runs (no skipIf).
// Modeled on tests/db/p0b/scratch-guard.test.ts's isP0bScratchDb suite.
import { describe, it, expect, afterEach } from 'vitest';
import { isP1ScratchDb, isP1PreDb, isP1MainDb } from './scratch-guard';

const ORIGINAL = process.env.DATABASE_URL;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL;
});

function withUrl<T>(url: string | undefined, fn: () => T): T {
  if (url === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = url;
  return fn();
}

describe('isP1ScratchDb', () => {
  it('accepts exactly the P1 scratch clone', () => {
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum_p1_scratch', isP1ScratchDb)).toBe(true);
  });

  it('rejects live', () => {
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum', isP1ScratchDb)).toBe(false);
  });

  it('rejects the P0a scratch clone', () => {
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum_p0a_scratch', isP1ScratchDb)).toBe(false);
  });

  it('rejects both P0b clones', () => {
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum_p0b_scratch', isP1ScratchDb)).toBe(false);
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum_p0b_pre', isP1ScratchDb)).toBe(false);
  });

  it('rejects a query-string shape (?db=gc_curriculum_p1_scratch)', () => {
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum?db=gc_curriculum_p1_scratch', isP1ScratchDb)).toBe(false);
  });

  it('rejects the name smuggled into the user field', () => {
    expect(withUrl('postgres://gc_curriculum_p1_scratch:p@h:5432/gc_curriculum', isP1ScratchDb)).toBe(false);
  });

  it('rejects prefix/suffix near-matches', () => {
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum_p1_scratch2', isP1ScratchDb)).toBe(false);
    expect(withUrl('postgres://u:p@h:5432/xgc_curriculum_p1_scratch', isP1ScratchDb)).toBe(false);
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum_p1_scratchx', isP1ScratchDb)).toBe(false);
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum_p1', isP1ScratchDb)).toBe(false);
  });

  it('rejects undefined/garbage DATABASE_URL', () => {
    expect(withUrl(undefined, isP1ScratchDb)).toBe(false);
    expect(withUrl('not a url', isP1ScratchDb)).toBe(false);
  });
});

// Fix round 1 (controller ruling, 2026-10-12): isP1ScratchDb() alone can't
// distinguish "pre-0058" from "post-0058" — Task 2 Step 7 real-applied 0058
// to gc_curriculum_p1_scratch, so the migration-rehearsal test needs its
// own permanently-pre-0058 clone (gc_curriculum_p1_pre), gated separately.
// Same reasoning/shape as P0b's isP0bPreDb()/isP0bMainDb().
describe('isP1PreDb (migration-rehearsal gate — gc_curriculum_p1_pre only)', () => {
  it('accepts only gc_curriculum_p1_pre', () => {
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum_p1_pre', isP1PreDb)).toBe(true);
  });

  it('rejects the main scratch and everything else', () => {
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum_p1_scratch', isP1PreDb)).toBe(false);
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum_p0b_pre', isP1PreDb)).toBe(false);
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum_p0a_scratch', isP1PreDb)).toBe(false);
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum', isP1PreDb)).toBe(false);
  });

  it('rejects a query-string shape and the name smuggled into the user field', () => {
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum?db=gc_curriculum_p1_pre', isP1PreDb)).toBe(false);
    expect(withUrl('postgres://gc_curriculum_p1_pre:p@h:5432/gc_curriculum', isP1PreDb)).toBe(false);
  });

  it('rejects prefix/suffix near-matches', () => {
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum_p1_pre2', isP1PreDb)).toBe(false);
    expect(withUrl('postgres://u:p@h:5432/xgc_curriculum_p1_pre', isP1PreDb)).toBe(false);
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum_p1_prex', isP1PreDb)).toBe(false);
  });

  it('rejects undefined/garbage DATABASE_URL', () => {
    expect(withUrl(undefined, isP1PreDb)).toBe(false);
    expect(withUrl('not a url', isP1PreDb)).toBe(false);
  });
});

describe('isP1MainDb (constraint-drift gate — gc_curriculum_p1_scratch only)', () => {
  it('accepts exactly the main P1 scratch clone, same as isP1ScratchDb', () => {
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum_p1_scratch', isP1MainDb)).toBe(true);
  });

  it('rejects the pre clone', () => {
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum_p1_pre', isP1MainDb)).toBe(false);
  });

  it('rejects live and garbage', () => {
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum', isP1MainDb)).toBe(false);
    expect(withUrl(undefined, isP1MainDb)).toBe(false);
  });
});

// Red-proof (fix round 1): isP1PreDb and isP1MainDb must be mutually
// exclusive — if a future edit widened either to accept both names (the
// exact mistake P0b's isP0bScratchDb deliberately allows for a DIFFERENT
// gate), the migration-rehearsal test would stop skipping against the main
// scratch, silently reproducing the bug this fix round exists to close.
describe('isP1PreDb and isP1MainDb are mutually exclusive (red-proof)', () => {
  it('no URL satisfies both', () => {
    for (const url of [
      'postgres://u:p@h:5432/gc_curriculum_p1_scratch',
      'postgres://u:p@h:5432/gc_curriculum_p1_pre',
      'postgres://u:p@h:5432/gc_curriculum',
    ]) {
      const pre = withUrl(url, isP1PreDb);
      const main = withUrl(url, isP1MainDb);
      expect(pre && main).toBe(false);
    }
  });
});
