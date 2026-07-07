import { describe, it, expect } from 'vitest';
import { assembleNeighborContext } from '@/lib/ai/explore/neighbor-context';

const focal = { courseCode: 'GC 3460', competencies: [{ statement: 'prepress preparation', type: 'technical' as const, k_depth: 2, u_depth: 2, d_depth: 3 }], incoming_expectations: [] };
const gc4440 = { courseCode: 'GC 4440', competencies: [{ statement: 'imposition', type: 'technical' as const, k_depth: 3, u_depth: 3, d_depth: 4 }], incoming_expectations: [{ statement: 'trapping', expected_depth: { k: null, u: null, d: 4 } }] };
const gc1010 = { courseCode: 'GC 1010', competencies: [{ statement: 'color models', type: 'technical' as const, k_depth: 2, u_depth: 2, d_depth: 2 }], incoming_expectations: [] };

describe('assembleNeighborContext', () => {
  it('splits neighbors into upstream (focal relies on) and downstream (relies on focal)', () => {
    const ctx = assembleNeighborContext({
      focalCourseCode: 'GC 3460',
      profiles: { 'GC 3460': focal, 'GC 4440': gc4440, 'GC 1010': gc1010 },
      edgePairs: [
        { relyingCourseCode: 'GC 3460', prereqCourseCode: 'GC 1010' }, // focal relies on 1010 (upstream)
        { relyingCourseCode: 'GC 4440', prereqCourseCode: 'GC 3460' }, // 4440 relies on focal (downstream)
      ],
    });
    expect(ctx.upstream.map(c => c.courseCode)).toEqual(['GC 1010']);
    expect(ctx.downstream.map(c => c.courseCode)).toEqual(['GC 4440']);
    expect(ctx.focal.courseCode).toBe('GC 3460');
    expect(ctx.focal.competencies[0]!.type).toBe('technical');
  });
});
