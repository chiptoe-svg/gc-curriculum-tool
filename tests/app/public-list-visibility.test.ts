import { describe, it, expect } from 'vitest';
import { isProgramVisible } from '@/lib/courses/program-visibility';

describe('public course list visibility', () => {
  const rows = [
    { code: 'GC 1010', scope: 'gc', status: 'offered' },
    { code: 'GC 9999', scope: 'gc', status: 'proposed' },
    { code: 'XU 1010', scope: 'external', status: 'sandbox' },
  ] as Array<{ code: string; scope: 'gc'|'external'; status: 'offered'|'proposed'|'sandbox'|'retired' }>;
  it('keeps only gc/offered', () => {
    expect(rows.filter(isProgramVisible).map(r => r.code)).toEqual(['GC 1010']);
  });
});
