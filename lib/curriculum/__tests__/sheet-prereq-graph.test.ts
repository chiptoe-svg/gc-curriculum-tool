import { describe, it, expect } from 'vitest';
import { sheetPrereqPairsFrom, prereqsOf, dependentsOf, mergePrereqPairs } from '@/lib/curriculum/sheet-prereq-graph';

const rows = [
  { code: 'GC 1040', prerequisites: '' },
  { code: 'GC 3460', prerequisites: 'GC 1040' },
  { code: 'GC 4060', prerequisites: 'GC 3460' },
  { code: 'GC 4070', prerequisites: 'GC 3460, GC 4060' },
  { code: 'GC 4400', prerequisites: 'GC 3460 or GC 4400' },
  { code: 'GC 3700', prerequisites: 'Sophomore standing' },
  { code: 'GC 4480', prerequisites: 'GC 9999, GC 4060' },
  { code: 'GC 4900ap', prerequisites: 'GC 3700' },
  { code: 'GC 4999', prerequisites: 'GC 4900ap' },
];

describe('sheetPrereqPairsFrom', () => {
  const pairs = sheetPrereqPairsFrom(rows);
  it('gives both directions', () => {
    expect(prereqsOf(pairs, 'GC 3460')).toEqual(['GC 1040']);
    expect(dependentsOf(pairs, 'GC 3460')).toEqual(['GC 4060', 'GC 4070', 'GC 4400']);
  });
  it('reads multiple codes in one line', () => {
    expect(prereqsOf(pairs, 'GC 4070')).toEqual(['GC 3460', 'GC 4060']);
  });
  it('drops self-references', () => {
    expect(prereqsOf(pairs, 'GC 4400')).toEqual(['GC 3460']);
  });
  it('gives no pair for text without a code', () => {
    expect(prereqsOf(pairs, 'GC 3700')).toEqual([]);
  });
  it('drops codes not in courses', () => {
    expect(prereqsOf(pairs, 'GC 4480')).toEqual(['GC 4060']);
  });
  it('maps codes back to the canonical courses.code case', () => {
    expect(prereqsOf(pairs, 'GC 4999')).toEqual(['GC 4900ap']);
    expect(dependentsOf(pairs, 'gc 4900AP')).toEqual(['GC 4999']);
  });
});

describe('mergePrereqPairs', () => {
  it('unions and dedupes on normalized codes', () => {
    expect(mergePrereqPairs(
      [{ focal: 'GC 4060', prereq: 'GC 3460' }],
      [{ focal: 'gc  4060', prereq: 'GC 3460' }, { focal: 'GC 4070', prereq: 'GC 3460' }],
    )).toEqual([{ focal: 'GC 4060', prereq: 'GC 3460' }, { focal: 'GC 4070', prereq: 'GC 3460' }]);
  });
});
