import { describe, it, expect } from 'vitest';
import { filterByImportance } from '../importance-filter';

const s = (id: string, weight: number | null, pinned = false) => ({ id, name: id, careerTargetId: 't', careerTargetName: 'T', displayOrder: 0, weight, pinned, provisional: false });

describe('filterByImportance', () => {
  const subs = [s('pin', null, true), s('v', 0.8), s('i', 0.5), s('w', 0.3)];
  it('each stop filters by its floor; pins show at every stop', () => {
    expect(filterByImportance(subs, 0.75).map(x => x.id)).toEqual(['pin', 'v']);
    expect(filterByImportance(subs, 0.5).map(x => x.id)).toEqual(['pin', 'v', 'i']);
    expect(filterByImportance(subs, 0.25).map(x => x.id)).toEqual(['pin', 'v', 'i', 'w']);
  });
});
