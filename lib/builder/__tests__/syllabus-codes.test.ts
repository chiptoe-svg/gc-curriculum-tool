import { describe, it, expect } from 'vitest';
import { newCourseConflict, normalizeCourseCode, sameCode } from '../syllabus-codes';

const tracked = [{ code: 'GC 4800', captured: true }, { code: 'GC 3020', captured: false }, { code: 'GC 4900ap', captured: false }];
const proposed = [{ code: 'GC 5100' }];

describe('newCourseConflict', () => {
  it('normalizes typed codes', () => {
    expect(normalizeCourseCode('gc4800')).toBe('GC 4800');
    expect(normalizeCourseCode('GC  4800')).toBe('GC 4800');
    expect(sameCode('gc 4900AP', 'GC 4900ap')).toBe(true);
  });
  it('refuses a code that has a capture', () => {
    expect(newCourseConflict('gc4800', tracked, proposed)).toBe('GC 4800 already has a capture, so it cannot be drafted from a syllabus.');
  });
  it('refuses a tracked course without a capture: pick it from the list', () => {
    expect(newCourseConflict('GC  3020', tracked, proposed)).toBe('GC 3020 is already in the catalog; choose it from the list instead.');
    expect(newCourseConflict('gc 4900AP', tracked, proposed)).toMatch(/^GC 4900ap is already in the catalog/);
  });
  it('refuses a course already proposed on this plan', () => {
    expect(newCourseConflict('gc5100', tracked, proposed)).toMatch(/already proposed on this map/);
  });
  it('accepts a new code, and a free label that is not a code', () => {
    expect(newCourseConflict('GC 5000', tracked, proposed)).toBeNull();
    expect(newCourseConflict('Packaging lab', tracked, proposed)).toBeNull();
  });
});
