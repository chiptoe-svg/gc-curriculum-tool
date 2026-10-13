// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { isP2ScratchDb, isP2PreDb } from './scratch-guard';

const ORIGINAL = process.env.DATABASE_URL;
afterEach(() => { process.env.DATABASE_URL = ORIGINAL; });

function withUrl(url: string | undefined) {
  if (url === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = url;
}

describe('isP2ScratchDb', () => {
  it('accepts exactly the main P2 clone', () => {
    withUrl('postgres://u:p@127.0.0.1:5433/gc_curriculum_p2_scratch');
    expect(isP2ScratchDb()).toBe(true);
  });
  it.each([
    'postgres://u:p@127.0.0.1:5433/gc_curriculum',
    'postgres://u:p@127.0.0.1:5433/gc_curriculum_p2_pre',
    'postgres://u:p@127.0.0.1:5433/gc_curriculum_p1_scratch',
    'postgres://u:p@127.0.0.1:5433/gc_curriculum_p2_scratch_x',
    'postgres://u:p@127.0.0.1:5433/x_gc_curriculum_p2_scratch',
    'postgres://u:p@127.0.0.1:5433/gc_curriculum?db=gc_curriculum_p2_scratch',
    'postgres://gc_curriculum_p2_scratch:p@127.0.0.1:5433/gc_curriculum',
    'not a url',
  ])('rejects %s', (url) => {
    withUrl(url);
    expect(isP2ScratchDb()).toBe(false);
  });
  it('rejects an unset DATABASE_URL', () => {
    withUrl(undefined);
    expect(isP2ScratchDb()).toBe(false);
  });
});

describe('isP2PreDb', () => {
  it('accepts exactly the pre clone and rejects the main clone', () => {
    withUrl('postgres://u:p@127.0.0.1:5433/gc_curriculum_p2_pre');
    expect(isP2PreDb()).toBe(true);
    withUrl('postgres://u:p@127.0.0.1:5433/gc_curriculum_p2_scratch');
    expect(isP2PreDb()).toBe(false);
  });
});
