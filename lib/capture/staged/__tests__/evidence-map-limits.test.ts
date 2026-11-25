import { describe, it, expect } from 'vitest';
import { EvidenceMapSchema } from '../evidence-map';

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
