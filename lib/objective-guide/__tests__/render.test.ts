import { describe, it, expect } from 'vitest';
import { renderGuideText, formatEvidence, MEASURE_LABEL } from '../render';
import type { ObjectiveGuide } from '../schema';

const GUIDE: ObjectiveGuide = {
  intro: 'At the end of the semester, a few class-level numbers from Canvas show how well students met each objective.',
  objectives: [
    { objective: 'Develop a brand strategy grounded in audience research.', measure: 'clear',
      evidence: [{ assignment: 'Brand Audit', rubric_row: 'Research depth' }], gather: 'The score distribution on the Research depth row.', suggestion: null },
    { objective: 'Present a strategic rationale to a client.', measure: 'none', evidence: [],
      gather: 'Nothing is graded on this yet.', suggestion: 'Add a Presentation row to the Final Brand Playbook rubric.' },
  ],
  checklist: [{ assignment: 'Brand Audit', rubric_row: 'Research depth' }],
};

describe('renderGuideText', () => {
  it('renders the guide as plain instructions to a person', () => {
    expect(renderGuideText(GUIDE, { code: 'MKT 4320', title: 'Brand Management' })).toBe([
      'Assessing the course objectives: MKT 4320 Brand Management',
      '',
      'At the end of the semester, a few class-level numbers from Canvas show how well students met each objective.',
      '',
      '1. Develop a brand strategy grounded in audience research.',
      '   How it is measured now: Clearly measured',
      '   Where the evidence is: Brand Audit, rubric row "Research depth"',
      '   What to gather: The score distribution on the Research depth row.',
      '',
      '2. Present a strategic rationale to a client.',
      '   How it is measured now: No graded measure yet',
      '   Where the evidence is: no graded item yet',
      '   What to gather: Nothing is graded on this yet.',
      '   Smallest change that would help: Add a Presentation row to the Final Brand Playbook rubric.',
      '',
      'Items to pull from Canvas at the end of the semester:',
      '- Brand Audit, rubric row "Research depth"',
      '',
      "Report class-level numbers only, such as score distributions and the share of students at each level. Do not include any student's name or individual grade.",
    ].join('\n'));
  });

  it('says so when no objective could be quoted', () => {
    const text = renderGuideText({ intro: 'Intro.', objectives: [], checklist: [] }, { code: 'GC 1010', title: 'Intro' });
    expect(text).toContain('No learning objectives could be quoted from the syllabus.');
    expect(text).not.toContain('Items to pull from Canvas');
  });

  it('labels and evidence formatting', () => {
    expect(MEASURE_LABEL).toEqual({ clear: 'Clearly measured', partial: 'Partly measured', none: 'No graded measure yet' });
    expect(formatEvidence({ assignment: 'Reading Quiz 1', rubric_row: null })).toBe('Reading Quiz 1');
  });
});
