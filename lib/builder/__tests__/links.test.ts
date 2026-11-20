import { describe, expect, it } from 'vitest';
import { rollUp } from '../links';

const sk = (skillRef: string, k: number | null, u: number | null, d: number | null) => ({ skillRef, statement: skillRef, k, u, d });
const link = (skillRef: string, competencyId: string, status: 'proposed' | 'confirmed' | 'rejected' = 'proposed', source: 'embedding' | 'scoring' | 'faculty' | 'ai' = 'embedding') =>
  ({ skillRef, competencyId, status, source, similarity: null });
const lvl = (competencyId: string, k: number | null, u: number | null, d: number, method: 'faculty' | 'ai' | 'scoring' | 'needs_level' | 'rejected', rationale: string | null = null) =>
  ({ competencyId, k, u, d, method, rationale, source: null });

// Levels come from competency_levels (spec 2026-11-20-links-drive-coverage-design.md): rollUp attaches the
// counting links and lists unmapped skills and suggestions; it never computes a level from the skills.
describe('rollUp', () => {
  const skills = [sk('a', 3, 3, 3), sk('b', 0, 0, 1), sk('c', 2, 4, 2), sk('d', 1, 1, 1)];

  it("a scored competency shows the scorer's level, not the highest skill", () => {
    const before = JSON.stringify(skills);
    const r = rollUp(skills, [link('a', 'x', 'proposed', 'scoring')], [lvl('x', 1, 0, 0, 'scoring')]);
    expect(r.depths[0]).toMatchObject({ competencyId: 'x', k: 1, u: 0, d: 0, method: 'scoring', soft: true });
    expect(r.depths[0]!.links!.map(l => l.skillRef)).toEqual(['a']);
    expect(JSON.stringify(skills)).toBe(before);
  });

  it('needs_level competency appears with D 0 and its links', () => {
    const r = rollUp(skills, [link('c', 'y', 'confirmed', 'embedding')], [lvl('y', 0, 0, 0, 'needs_level')]);
    expect(r.depths[0]).toMatchObject({ competencyId: 'y', d: 0, method: 'needs_level', soft: false });
    expect(r.depths[0]!.links!.map(l => l.skillRef)).toEqual(['c']);
  });

  it('a faculty level carries its rationale; rejected links are not attached', () => {
    const r = rollUp(skills, [link('a', 'x', 'rejected', 'scoring'), link('b', 'x', 'confirmed')], [lvl('x', 1, 1, 2, 'faculty', 'narrow')]);
    expect(r.depths[0]).toMatchObject({ k: 1, u: 1, d: 2, method: 'faculty', rationale: 'narrow', soft: false });
    expect(r.depths[0]!.links!.map(l => l.skillRef)).toEqual(['b']);
  });

  it('suggestions and unmapped unchanged: an embedding match alone is a suggestion, its skill unmapped', () => {
    const r = rollUp(skills, [link('a', 'x', 'proposed', 'embedding')], []);
    expect(r.depths).toEqual([]);
    expect(r.unmapped.map(s => s.skillRef)).toEqual(['a', 'b', 'c', 'd']);
    expect(r.suggestions).toMatchObject([{ skillRef: 'a', competencyId: 'x' }]);
  });
});
