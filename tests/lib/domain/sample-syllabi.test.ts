import { describe, it, expect } from 'vitest';
import { SAMPLE_SYLLABI, getSampleByCode } from '@/lib/domain/sample-syllabi';

describe('sample-syllabi', () => {
  it('contains 6 syllabi for the documented courses', () => {
    expect(SAMPLE_SYLLABI).toHaveLength(6);
    const codes = SAMPLE_SYLLABI.map(s => s.courseCode);
    expect(codes).toEqual(['GC 3400', 'GC 3460', 'GC 3720', 'GC 4060', 'GC 4070', 'GC 4400']);
  });

  it('every sample has non-empty title, level, and syllabus text', () => {
    for (const s of SAMPLE_SYLLABI) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.level).toBeGreaterThanOrEqual(1);
      expect(s.level).toBeLessThanOrEqual(4);
      expect(s.syllabusText.length).toBeGreaterThan(100);
    }
  });

  it('getSampleByCode returns the right one', () => {
    expect(getSampleByCode('GC 3460')?.title).toContain('Ink and Substrates');
  });
});
