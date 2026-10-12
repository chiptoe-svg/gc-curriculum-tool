// Unit test for the P0a/P0b scratch-guard predicates. No DB access — this
// only exercises the pure string/URL matching, so it always runs (no
// skipIf). Guards against a repeat of fix round 1 (2026-10-12): broadening
// isScratchDb() to accept the P0b clones would silently un-gate the P0a
// WRITE tests (migration, apply-db, coverage-writes, catalog-writes)
// against them.
import { describe, it, expect, afterEach } from 'vitest';
import { isScratchDb, isCharacterizationDb } from '../p0a/scratch-guard';
import { isP0bScratchDb } from './scratch-guard';

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

describe('isScratchDb (P0a write-test gate)', () => {
  it('accepts only the P0a scratch clone', () => {
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum_p0a_scratch', isScratchDb)).toBe(true);
  });

  it('rejects both P0b clones', () => {
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum_p0b_scratch', isScratchDb)).toBe(false);
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum_p0b_pre', isScratchDb)).toBe(false);
  });

  it('rejects live and garbage', () => {
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum', isScratchDb)).toBe(false);
    expect(withUrl(undefined, isScratchDb)).toBe(false);
    expect(withUrl('not a url', isScratchDb)).toBe(false);
  });
});

describe('isCharacterizationDb (P0a characterization test gate only)', () => {
  it('accepts the P0a scratch clone and both P0b clones', () => {
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum_p0a_scratch', isCharacterizationDb)).toBe(true);
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum_p0b_scratch', isCharacterizationDb)).toBe(true);
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum_p0b_pre', isCharacterizationDb)).toBe(true);
  });

  it('rejects live', () => {
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum', isCharacterizationDb)).toBe(false);
  });
});

describe('isP0bScratchDb', () => {
  it('accepts exactly the two P0b clones', () => {
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum_p0b_scratch', isP0bScratchDb)).toBe(true);
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum_p0b_pre', isP0bScratchDb)).toBe(true);
  });

  it('rejects live', () => {
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum', isP0bScratchDb)).toBe(false);
  });

  it('rejects the P0a clone', () => {
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum_p0a_scratch', isP0bScratchDb)).toBe(false);
  });

  it('rejects a query-string shape (?db=gc_curriculum_p0b_scratch)', () => {
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum?db=gc_curriculum_p0b_scratch', isP0bScratchDb)).toBe(false);
  });

  it('rejects the name smuggled into the user field', () => {
    expect(withUrl('postgres://gc_curriculum_p0b_scratch:p@h:5432/gc_curriculum', isP0bScratchDb)).toBe(false);
  });

  it('rejects prefix/suffix near-matches', () => {
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum_p0b_scratch2', isP0bScratchDb)).toBe(false);
    expect(withUrl('postgres://u:p@h:5432/xgc_curriculum_p0b_scratch', isP0bScratchDb)).toBe(false);
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum_p0b_prefix', isP0bScratchDb)).toBe(false);
    expect(withUrl('postgres://u:p@h:5432/gc_curriculum_p0b_pre_extra', isP0bScratchDb)).toBe(false);
  });

  it('rejects undefined/garbage DATABASE_URL', () => {
    expect(withUrl(undefined, isP0bScratchDb)).toBe(false);
    expect(withUrl('not a url', isP0bScratchDb)).toBe(false);
  });
});
