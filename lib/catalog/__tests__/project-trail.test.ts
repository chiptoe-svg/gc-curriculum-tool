import { describe, it, expect } from 'vitest';
import { buildProjectTrail, nearestItems, normalizeStatement, type TrailCell } from '@/lib/catalog/project-trail';

const cell = (competencyId: string, matched: string, d = 3): TrailCell => ({ competencyId, competencyName: competencyId.toUpperCase(), matched, k: 2, u: 2, d });
const none = () => [];

describe('normalizeStatement', () => {
  it('trims, lowercases and collapses spaces', () => expect(normalizeStatement('  Color   Proofing ')).toBe('color proofing'));
});

describe('buildProjectTrail', () => {
  const statements = ['Color proofing', 'Press makeready'];
  it('joins project → statement → every competency that matched it, case/space-insensitively', () => {
    const trail = buildProjectTrail({
      projects: [{ title: 'Proof lab', competencies: ['color  proofing'] }],
      statements,
      cells: [cell('color-management', 'Color proofing'), cell('quality-control', 'COLOR PROOFING', 2)],
      nearest: none,
    });
    expect(trail).toEqual([{ title: 'Proof lab', skills: [{ statement: 'Color proofing', competencies: [
      { id: 'color-management', name: 'COLOR-MANAGEMENT', k: 2, u: 2, d: 3, onet: [] },
      { id: 'quality-control', name: 'QUALITY-CONTROL', k: 2, u: 2, d: 2, onet: [] },
    ] }] }]);
  });

  it('keeps an unmatched statement and a statement missing from the profile, with no competencies', () => {
    const trail = buildProjectTrail({ projects: [{ title: 'P', competencies: ['Press makeready', 'Not in profile'] }], statements, cells: [], nearest: none });
    expect(trail[0]!.skills).toEqual([
      { statement: 'Press makeready', competencies: [] },
      { statement: 'Not in profile', competencies: [] },
    ]);
  });

  it('no projects, null or a non-array gives an empty trail', () => {
    for (const projects of [[], null, undefined, 'x', { a: 1 }]) {
      expect(buildProjectTrail({ projects, statements, cells: [], nearest: none })).toEqual([]);
    }
  });

  it('asks nearest() for each (statement, competency) pair', () => {
    const asked: string[] = [];
    buildProjectTrail({ projects: [{ title: 'P', competencies: ['Color proofing'] }], statements, cells: [cell('color-management', 'Color proofing')],
      nearest: (s, c) => { asked.push(`${s}|${c}`); return []; } });
    expect(asked).toEqual(['Color proofing|color-management']);
  });
});

describe('nearestItems', () => {
  const c = (label: string, vector: number[], provisional = false) => ({ label, source: 'onet_element' as const, provisional, vector });
  it('returns the top 3 at or above the floor, best first, with the provisional flag', () => {
    const out = nearestItems([1, 0], [c('a', [1, 0]), c('b', [0.8, 0.6], true), c('c', [0.6, 0.8]), c('d', [0.5, 0.866]), c('far', [0, 1])], 0.5, 3);
    expect(out.map(i => [i.label, i.provisional])).toEqual([['a', false], ['b', true], ['c', false]]);
    expect(out[0]!.similarity).toBeCloseTo(1);
  });
  it('drops pairs below the floor and returns [] with no vector', () => {
    expect(nearestItems([1, 0], [c('far', [0, 1])], 0.5)).toEqual([]);
    expect(nearestItems(undefined, [c('a', [1, 0])])).toEqual([]);
  });
  it('skips a candidate whose vector length differs instead of throwing', () => {
    expect(nearestItems([1, 0], [c('other-model', [1, 0, 0]), c('a', [1, 0])]).map(i => i.label)).toEqual(['a']);
  });
});
