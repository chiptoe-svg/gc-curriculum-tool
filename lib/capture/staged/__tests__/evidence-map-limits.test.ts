import { describe, it, expect } from 'vitest';
import { EvidenceMapSchema, clampEvidenceMap, EVIDENCE_MAP_LIMITS } from '../evidence-map';

const MAP = { summary: 's', graded_work: [], tests: [], competencies: [], assumed_skills: [], objectives: [], conflicts: [], unreadable: [] };
const gw = { title: 't', weight: null, deliverables: null, rubric_criteria: [], source: 'c' };

describe('EvidenceMapSchema size limits', () => {
  it('accepts values at the limits', () => {
    expect(EvidenceMapSchema.safeParse({ ...MAP, summary: 'x'.repeat(2000), graded_work: Array(60).fill(gw), conflicts: Array(40).fill('c') }).success).toBe(true);
  });
  it.each([
    ['a string over 2000 chars', { ...MAP, summary: 'x'.repeat(2001) }],
    ['61 graded_work', { ...MAP, graded_work: Array(61).fill(gw) }],
    ['61 tests', { ...MAP, tests: Array(61).fill({ name: 'n', item_types: [], source: 's' }) }],
    ['61 competencies', { ...MAP, competencies: Array(61).fill({ statement: 's', graded_work: [] }) }],
    ['61 assumed_skills', { ...MAP, assumed_skills: Array(61).fill({ skill: 's', used_in: 'u', source: 's' }) }],
    ['61 objectives', { ...MAP, objectives: Array(61).fill({ text: 't', status: 'not_found', graded_work: [] }) }],
    ['41 rubric_criteria', { ...MAP, graded_work: [{ ...gw, rubric_criteria: Array(41).fill('r') }] }],
    ['41 item_types', { ...MAP, tests: [{ name: 'n', item_types: Array(41).fill('i'), source: 's' }] }],
    ['41 competency graded_work refs', { ...MAP, competencies: [{ statement: 's', graded_work: Array(41).fill('g') }] }],
    ['41 objective graded_work refs', { ...MAP, objectives: [{ text: 't', status: 'not_found', graded_work: Array(41).fill('g') }] }],
    ['41 conflicts', { ...MAP, conflicts: Array(41).fill('c') }],
    ['41 unreadable', { ...MAP, unreadable: Array(41).fill({ file: 'f', note: 'n' }) }],
  ])('rejects %s', (_n, m) => { expect(EvidenceMapSchema.safeParse(m).success).toBe(false); });
});

describe('final-fix 5: assumed_skills holds at most 12 (the stage-4 card and the stage-4 skill see the same list)', () => {
  const skill = (i: number) => ({ skill: `Skill ${i}`, used_in: 'u', source: 's' });
  it('the limit is 12', () => { expect(EVIDENCE_MAP_LIMITS.assumedSkills).toBe(12); });
  it('the schema accepts 12 and rejects 13', () => {
    expect(EvidenceMapSchema.safeParse({ ...MAP, assumed_skills: Array.from({ length: 12 }, (_, i) => skill(i)) }).success).toBe(true);
    expect(EvidenceMapSchema.safeParse({ ...MAP, assumed_skills: Array.from({ length: 13 }, (_, i) => skill(i)) }).success).toBe(false);
  });
  it("the model clamp keeps the first 12 skills and counts the cut; other lists keep 60", () => {
    const { value, clamped } = clampEvidenceMap({ ...MAP, assumed_skills: Array.from({ length: 20 }, (_, i) => skill(i)), graded_work: Array(30).fill(gw) });
    const v = value as typeof MAP & { assumed_skills: unknown[]; graded_work: unknown[] };
    expect(v.assumed_skills).toEqual(Array.from({ length: 12 }, (_, i) => skill(i)));
    expect(v.graded_work).toHaveLength(30);
    expect(clamped).toBe(1);
    expect(EvidenceMapSchema.safeParse(value).success).toBe(true);
  });
});
