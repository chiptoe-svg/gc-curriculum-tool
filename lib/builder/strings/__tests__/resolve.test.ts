import { describe, it, expect } from 'vitest';
import { textHash } from '@/lib/catalog/bundles';
import { normalizeStatement } from '@/lib/catalog/project-trail';
import type { Library } from '../../types';
import type { PointRow } from '../types';

import { resolveExact } from '../resolve';

const h = (s: string) => textHash(normalizeStatement(s));
const lib = (version: unknown | null, code = 'GC 1010'): Library => ({
  courses: [{ code, versions: version ? [version] : [] }],
} as unknown as Library);
const version = {
  snapshotId: 'snap1',
  skills: [{ skillRef: 'x', statement: 'Mix ink to a target color', k: 2, u: 1, d: 3 }, { skillRef: 'y', statement: 'Clean a press', k: 1, u: null, d: 2 }],
  required: [{ ref: h('Read a spec sheet'), statement: 'Read a spec sheet', need: { k: 2, u: null, d: null } }],
};
const point = (over: Partial<PointRow>): PointRow => ({
  id: 'p1', courseCode: 'GC 1010', role: 'develops', statement: 'Mix ink to a target color', statementHash: h('Mix ink to a target color'),
  snapshotId: null, k: null, u: null, d: null, term: null, ...over,
});

describe('resolveExact', () => {
  it('develops: intact with depth from the skill', () => {
    expect(resolveExact(point({}), lib(version), new Set())).toEqual({ kind: 'intact', now: { k: 2, u: 1, d: 3 } });
  });
  it('requires: intact with depth = need', () => {
    const p = point({ role: 'requires', statement: 'Read a spec sheet', statementHash: h('Read a spec sheet') });
    expect(resolveExact(p, lib(version), new Set())).toEqual({ kind: 'intact', now: { k: 2, u: null, d: null } });
  });
  it('course not found', () => {
    expect(resolveExact(point({ courseCode: 'GC 9999' }), lib(version), new Set())).toEqual({ kind: 'unanchored', why: 'course not found' });
  });
  it('no capture', () => {
    expect(resolveExact(point({}), lib(null), new Set())).toEqual({ kind: 'unanchored', why: 'no capture' });
  });
  it('skill gone when the pool is empty', () => {
    const p = point({ role: 'requires', statement: 'Old', statementHash: h('Old') });
    const none = { ...version, required: [] };
    expect(resolveExact(p, lib(none), new Set())).toEqual({ kind: 'unanchored', why: 'skill gone' });
  });
  it('needs-check pool excludes hashes other points hold', () => {
    const p = point({ statement: 'Old wording', statementHash: h('Old wording') });
    const r = resolveExact(p, lib(version), new Set([h('Clean a press')]));
    expect(r).toEqual({ kind: 'needs-check', snapshotId: 'snap1', pool: [{ statement: 'Mix ink to a target color', hash: h('Mix ink to a target color') }] });
  });
  it('everything held means skill gone', () => {
    const p = point({ statement: 'Old wording', statementHash: h('Old wording') });
    const r = resolveExact(p, lib(version), new Set([h('Clean a press'), h('Mix ink to a target color')]));
    expect(r).toEqual({ kind: 'unanchored', why: 'skill gone' });
  });
});
