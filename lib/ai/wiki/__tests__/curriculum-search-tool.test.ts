import { describe, it, expect } from 'vitest';
import { diversifyByCourse } from '@/lib/ai/wiki/curriculum-search-tool';

const hit = (id: string, courseCode: string, score: number) =>
  ({ id, courseCode, score } as any);

describe('diversifyByCourse', () => {
  it('caps hits per course and preserves score order within a course', () => {
    const hits = [
      hit('a', 'GC 1000', 0.9), hit('b', 'GC 1000', 0.8), hit('c', 'GC 1000', 0.7),
      hit('d', 'GC 2000', 0.6),
    ];
    const out = diversifyByCourse(hits, 2);
    expect(out.filter(h => h.courseCode === 'GC 1000').map(h => h.id)).toEqual(['a', 'b']);
    expect(out.some(h => h.courseCode === 'GC 2000')).toBe(true);
  });
});
