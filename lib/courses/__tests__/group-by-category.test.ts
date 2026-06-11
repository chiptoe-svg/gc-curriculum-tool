import { describe, it, expect } from 'vitest';
import { groupByCategory } from '@/lib/courses/group-by-category';

const rows = [
  { code: 'STAT 2300', category: 'major_req' as const },
  { code: 'GC 1020', category: 'gc_core' as const },
  { code: 'GC 1010', category: 'gc_core' as const },
  { code: 'GC 3700', category: 'specialty' as const },
];

describe('groupByCategory', () => {
  it('returns categories in fixed display order, omitting empty ones', () => {
    const groups = groupByCategory(rows);
    expect(groups.map((g) => g.category)).toEqual(['gc_core', 'specialty', 'major_req']);
  });

  it('sorts rows within a category by code', () => {
    const core = groupByCategory(rows).find((g) => g.category === 'gc_core')!;
    expect(core.rows.map((r) => r.code)).toEqual(['GC 1010', 'GC 1020']);
  });

  it('omits "other" when empty and includes it when populated', () => {
    expect(groupByCategory(rows).some((g) => g.category === 'other')).toBe(false);
    const withOther = groupByCategory([...rows, { code: 'NEW 1000', category: 'other' as const }]);
    expect(withOther[withOther.length - 1]!.category).toBe('other');
  });
});
