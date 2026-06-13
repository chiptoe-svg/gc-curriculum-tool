import { describe, it, expect } from 'vitest';
import { formatCourseLabel } from '@/lib/db/courses-queries';

describe('formatCourseLabel', () => {
  it('returns the bare code when there are no paired codes', () => {
    expect(formatCourseLabel('GC 3460', [])).toBe('GC 3460');
  });
  it('collapses a shared-prefix pair to prefix + slash numbers', () => {
    expect(formatCourseLabel('GC 3460', [{ pairedCode: 'GC 3461', role: 'lab' }])).toBe('GC 3460/3461');
  });
  it('joins differing prefixes with +', () => {
    expect(formatCourseLabel('GC 3460', [{ pairedCode: 'XX 1234', role: 'lab' }])).toBe('GC 3460 + XX 1234');
  });
});
