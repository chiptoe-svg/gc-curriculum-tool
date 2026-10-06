import { describe, it, expect } from 'vitest';
import { extractPrereqCodes } from '@/lib/capture/prereq-codes';

describe('extractPrereqCodes', () => {
  it('finds multiple codes in one line', () => {
    expect(extractPrereqCodes('GC 3460, GC 4060', 'GC 4070')).toEqual(['GC 3460', 'GC 4060']);
  });
  it('drops a self-reference', () => {
    expect(extractPrereqCodes('GC 3460 or GC 4070', 'GC 4070')).toEqual(['GC 3460']);
  });
  it('returns nothing for text without a course code', () => {
    expect(extractPrereqCodes('Sophomore standing', 'GC 3460')).toEqual([]);
  });
  it('dedupes and normalizes whitespace', () => {
    expect(extractPrereqCodes('GC  1040 (grade of C); GC 1040', 'GC 2070')).toEqual(['GC 1040']);
  });
});
