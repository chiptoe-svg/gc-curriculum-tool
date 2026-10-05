import { describe, it, expect } from 'vitest';
import {
  parseCanvasAssignmentNames, assignmentNameFromTitle, rubricRowName,
  findAssignment, findRubricRow, normalizeName,
} from '../canvas-names';
import { ASSIGNMENTS_TEXT } from './fixtures';

describe('assignmentNameFromTitle', () => {
  it('strips the points and [unpublished] suffixes', () => {
    expect(assignmentNameFromTitle('Final Brand Playbook (100 pts) [unpublished]')).toBe('Final Brand Playbook');
    expect(assignmentNameFromTitle('Brand Audit (50 pts)')).toBe('Brand Audit');
    expect(assignmentNameFromTitle('Lab 2 (2.5 pts)')).toBe('Lab 2');
    expect(assignmentNameFromTitle('Reading Quiz 1')).toBe('Reading Quiz 1');
  });
});

describe('rubricRowName', () => {
  it('takes the criterion before the points label', () => {
    expect(rubricRowName('Research depth (20 pts) — Uses at least three sources')).toBe('Research depth');
  });
  it('takes the criterion before the long description when there are no points', () => {
    expect(rubricRowName('Visual system — Consistent use of the identity')).toBe('Visual system');
  });
  it('returns the whole text when there is neither', () => {
    expect(rubricRowName('Craft')).toBe('Craft');
  });
});

describe('parseCanvasAssignmentNames', () => {
  it('lists every assignment with only the rubric rows under its own Rubric header', () => {
    expect(parseCanvasAssignmentNames(ASSIGNMENTS_TEXT)).toEqual({
      assignments: [
        { name: 'Brand Audit', rubricRows: ['Research depth', 'Strategic rationale'] },
        { name: 'Final Brand Playbook', rubricRows: ['Visual system', 'Strategic   Rationale'] },
        { name: 'Reading Quiz 1', rubricRows: [] },
      ],
    });
  });

  it('merges two assignments that share a name', () => {
    const text = '## Lab (5 pts)\nRubric:\n- Setup (5 pts)\n\n## Lab (5 pts) [unpublished]\nRubric:\n- Cleanup (5 pts)';
    expect(parseCanvasAssignmentNames(text).assignments).toEqual([{ name: 'Lab', rubricRows: ['Setup', 'Cleanup'] }]);
  });

  it('returns no assignments for empty text', () => {
    expect(parseCanvasAssignmentNames('')).toEqual({ assignments: [] });
  });
});

describe('matching', () => {
  const known = parseCanvasAssignmentNames(ASSIGNMENTS_TEXT);

  it('normalizeName folds case and whitespace only', () => {
    expect(normalizeName('  Strategic   RATIONALE ')).toBe('strategic rationale');
  });

  it('finds assignments case- and whitespace-insensitively', () => {
    expect(findAssignment(known, 'final  brand playbook')?.name).toBe('Final Brand Playbook');
    expect(findAssignment(known, 'Final Brand Playbooks')).toBeNull();
  });

  it('finds a rubric row only under its own assignment', () => {
    const audit = findAssignment(known, 'Brand Audit')!;
    const playbook = findAssignment(known, 'Final Brand Playbook')!;
    expect(findRubricRow(playbook, 'strategic rationale')).toBe('Strategic   Rationale');
    expect(findRubricRow(audit, 'Visual system')).toBeNull();
  });
});
