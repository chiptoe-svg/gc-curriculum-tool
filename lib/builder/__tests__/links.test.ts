import { describe, expect, it } from 'vitest';
import { rollUp } from '../links';

const sk = (skillRef: string, k: number | null, u: number | null, d: number | null) => ({ skillRef, statement: skillRef, k, u, d });
const link = (skillRef: string, competencyId: string, status: 'proposed' | 'confirmed' | 'rejected' = 'proposed', source: 'embedding' | 'scoring' | 'faculty' | 'ai' = 'embedding') =>
  ({ skillRef, competencyId, status, source, similarity: null });

describe('rollUp', () => {
  const skills = [sk('a', 3, 3, 3), sk('b', 0, 0, 1), sk('c', 2, 4, 2), sk('d', 1, 1, 1)];

  it('takes the highest linked skill, dimension by dimension, and never changes the skills', () => {
    const before = JSON.stringify(skills);
    const r = rollUp(skills, [link('a', 'x'), link('c', 'x')], [], new Set());
    expect(r.depths[0]).toMatchObject({ competencyId: 'x', k: 3, u: 4, d: 3, method: 'max', soft: true });
    expect(JSON.stringify(skills)).toBe(before);
  });

  it('leaves rejected links out, and lists skills with no counting link as unmapped', () => {
    const r = rollUp(skills, [link('a', 'x', 'rejected'), link('b', 'x', 'confirmed')], [], new Set());
    expect(r.depths[0]).toMatchObject({ k: 0, u: 0, d: 1, soft: false });
    expect(r.unmapped.map(s => s.skillRef)).toEqual(['a', 'c', 'd']);
  });

  it('uses a stored roll-up (AI or faculty) instead of the highest skill', () => {
    const r = rollUp(skills, [link('a', 'x'), link('b', 'x')], [{ competencyId: 'x', k: 1, u: 1, d: 2, method: 'ai', rationale: 'one narrow skill' }], new Set());
    expect(r.depths[0]).toMatchObject({ k: 1, u: 1, d: 2, method: 'ai', rationale: 'one narrow skill', soft: false });
  });

  it('reads a foundational competency on Do only', () => {
    const r = rollUp(skills, [link('a', 'agency')], [], new Set(['agency']));
    expect(r.depths[0]).toMatchObject({ k: null, u: null, d: 3 });
  });
});
