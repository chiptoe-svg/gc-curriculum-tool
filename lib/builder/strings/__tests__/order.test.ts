import { describe, expect, it } from 'vitest';
import { orderPoints } from '../order';
import type { PointRow } from '../types';

const pt = (id: string, courseCode: string, role: PointRow['role']): PointRow => ({
  id, courseCode, role, statement: id, statementHash: id, snapshotId: null, k: null, u: null, d: null, term: null,
});
const levelOf = (c: string) => Number(c.split(' ')[1]![0]!);

describe('orderPoints', () => {
  it('orders by act, course number, then develops before requires', () => {
    const out = orderPoints(
      [pt('a', 'GC 4800', 'develops'), pt('b', 'GC 4400', 'requires'), pt('c', 'GC 4400', 'develops'),
        pt('d', 'GC 3400', 'develops'), pt('e', 'GC 1040', 'develops')],
      levelOf,
    );
    expect(out.map((p) => p.id)).toEqual(['e', 'd', 'c', 'b', 'a']);
  });
});
