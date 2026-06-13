import { describe, it, expect } from 'vitest';
import { formatCourseLabel } from '@/lib/db/courses-queries';

describe('formatCourseLabel', () => {
  it('returns the bare code when there are no paired codes', () => {
    expect(formatCourseLabel('GC 3460', [])).toBe('GC 3460');
  });
  it('collapses a shared-prefix pair to prefix + slash numbers', () => {
    const pairs: Array<{ pairedCode: string }> = [{ pairedCode: 'GC 3461' }];
    expect(formatCourseLabel('GC 3460', pairs)).toBe('GC 3460/3461');
  });
  it('joins differing prefixes with +', () => {
    const pairs: Array<{ pairedCode: string }> = [{ pairedCode: 'XX 1234' }];
    expect(formatCourseLabel('GC 3460', pairs)).toBe('GC 3460 + XX 1234');
  });
  it('preserves every prefix in a mixed multi-paired bundle', () => {
    expect(formatCourseLabel('GC 3460', [{ pairedCode: 'GC 3461' }, { pairedCode: 'XX 9999' }]))
      .toBe('GC 3460 + GC 3461 + XX 9999');
  });
});
