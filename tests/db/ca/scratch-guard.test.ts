// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { isCaScratchDb, isCaPreDb } from './scratch-guard';

const ORIGINAL = process.env.DATABASE_URL;
afterEach(() => { process.env.DATABASE_URL = ORIGINAL; });

function withUrl(url: string | undefined) {
  if (url === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = url;
}

describe('isCaScratchDb', () => {
  it('accepts exactly the main CA clone', () => {
    withUrl('postgres://u:p@127.0.0.1:5433/gc_curriculum_ca_scratch');
    expect(isCaScratchDb()).toBe(true);
  });
  it.each([
    'postgres://u:p@127.0.0.1:5433/gc_curriculum',
    'postgres://u:p@127.0.0.1:5433/gc_curriculum_ca_pre',
    'postgres://u:p@127.0.0.1:5433/gc_curriculum_p2_scratch',
    'postgres://u:p@127.0.0.1:5433/gc_curriculum_ca_scratch_x',
    'postgres://u:p@127.0.0.1:5433/x_gc_curriculum_ca_scratch',
    'postgres://u:p@127.0.0.1:5433/gc_curriculum?db=gc_curriculum_ca_scratch',
    'postgres://gc_curriculum_ca_scratch:p@127.0.0.1:5433/gc_curriculum',
    'not a url',
  ])('rejects %s', (url) => {
    withUrl(url);
    expect(isCaScratchDb()).toBe(false);
  });
  it('rejects an unset DATABASE_URL', () => {
    withUrl(undefined);
    expect(isCaScratchDb()).toBe(false);
  });
});

describe('isCaPreDb', () => {
  it('accepts exactly the pre clone and rejects the main clone', () => {
    withUrl('postgres://u:p@127.0.0.1:5433/gc_curriculum_ca_pre');
    expect(isCaPreDb()).toBe(true);
    withUrl('postgres://u:p@127.0.0.1:5433/gc_curriculum_ca_scratch');
    expect(isCaPreDb()).toBe(false);
  });
});
