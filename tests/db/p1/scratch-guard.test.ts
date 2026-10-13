// Unit test for the P1 scratch-guard predicate. No DB access — this only
// exercises the pure string/URL matching, so it always runs (no skipIf).
// Modeled on tests/db/p0b/scratch-guard.test.ts's isP0bScratchDb suite.
import { describe, it, expect, afterEach } from 'vitest';
import { isP1ScratchDb } from './scratch-guard';

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
