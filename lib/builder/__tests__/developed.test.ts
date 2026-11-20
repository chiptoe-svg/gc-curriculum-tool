import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { developedIds } from '../developed';

const m = (rows: Array<[string, number, string?]>) => new Map(rows.map(([id, d, method]) => [id, { k: 0, u: 0, d, method: method as never }]));

describe('developedIds (review I-3)', () => {
  it('lists competencies above 0, plus "needs a level" ones in the linked view so faculty can set them', () => {
    const map = m([['a', 2, 'scoring'], ['b', 0, 'needs_level'], ['c', 0, 'rejected'], ['d', 0, 'scoring']]);
    expect(developedIds(['a', 'b', 'c', 'd'], map, true)).toEqual(['a', 'b']);
    expect(developedIds(['a', 'b', 'c', 'd'], map, false)).toEqual(['a']);
  });
  it('the drawer uses it, and no longer explains the old "highest grouped skill" rule', () => {
    const src = readFileSync('app/build/[id]/CourseDrawer.tsx', 'utf8');
    expect(src).toContain('developedIds(');
    expect(src).not.toContain('highest grouped skill');
  });
});
