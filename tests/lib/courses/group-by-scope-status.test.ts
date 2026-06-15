import { describe, it, expect } from 'vitest';
import { partitionRosterRows } from '@/lib/courses/group-by-scope-status';

const R = (code: string, scope: string, courseStatus: string) =>
  ({ code, scope, courseStatus }) as { code: string; scope: 'gc' | 'external'; courseStatus: 'offered' | 'proposed' | 'sandbox' | 'retired' };

describe('partitionRosterRows', () => {
  it('splits rows into gc-visible, proposed, and external/sandbox buckets', () => {
    const out = partitionRosterRows([
      R('GC 1010', 'gc', 'offered'),
      R('GC 9999', 'gc', 'proposed'),
      R('XU 1010', 'external', 'sandbox'),
      R('GC 0001', 'gc', 'retired'),
    ]);
    expect(out.gc.map((r) => r.code)).toEqual(['GC 1010']);
    expect(out.proposed.map((r) => r.code)).toEqual(['GC 9999']);
    expect(out.external.map((r) => r.code)).toEqual(['XU 1010']);
    // retired falls out of all three buckets (not shown by default)
  });
});
