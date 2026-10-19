// @vitest-environment node
// Read-only: runs only on the CA scratch DB.
import { describe, it, expect } from 'vitest';
import { loadProblemSolvingInputs } from '@/lib/db/problem-solving-queries';
import { isCaScratchDb } from './scratch-guard';

describe.skipIf(!isCaScratchDb())('loadProblemSolvingInputs (CA scratch)', () => {
  it('returns one row per course and only technical depth 4+ cells', async () => {
    const { courses, depths } = await loadProblemSolvingInputs();
    const codes = courses.map(c => c.courseCode);
    expect(new Set(codes).size).toBe(codes.length);
    expect(courses.length).toBeGreaterThan(0);
    expect(depths.every(d => d.dDepth >= 4)).toBe(true);
    expect(depths.some(d => d.competencyId === 'problem-solving')).toBe(false);
    const known = new Set(codes);
    expect(depths.every(d => known.has(d.courseCode))).toBe(true);
  });
});
