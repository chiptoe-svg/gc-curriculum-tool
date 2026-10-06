import { describe, it, expect } from 'vitest';
import { renderGuideText, renderGuideCanvasPrompt, formatEvidence, MEASURE_LABEL } from '../render';
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

const CANVAS_GUIDE: ObjectiveGuide = {
  intro: 'Intro.',
  objectives: [
    { objective: 'Develop a brand strategy grounded in audience research.', measure: 'clear',
      evidence: [{ assignment: 'Brand Audit', rubric_row: 'Research depth' }], gather: 'The Research depth distribution.', suggestion: null },
    { objective: 'Present a strategic rationale to a client.', measure: 'partial',
      evidence: [{ assignment: 'Final Brand Playbook', rubric_row: null }],
      gather: 'The playbook rubric does not have a rationale row, so this score blends several skills.',
      suggestion: 'Add a Rationale row.' },
    { objective: 'Build a visual identity system that holds across media.', measure: 'none', evidence: [],
      gather: 'Nothing is graded on this yet.', suggestion: 'Add a Visual System row to a rubric.' },
  ],
  checklist: [{ assignment: 'Brand Audit', rubric_row: 'Research depth' }],
};

const COURSE = { code: 'MKT 4320', title: 'Brand Management' };

describe('renderGuideCanvasPrompt', () => {
  it('opens with Canvas access, the privacy sentence, and a literal [term] placeholder', () => {
    const prompt = renderGuideCanvasPrompt(CANVAS_GUIDE, COURSE);
    expect(prompt).toContain(
      'You have access to my Canvas course "MKT 4320 Brand Management" for the [term] semester. ' +
      'Produce an objective-attainment report using class-level data only. ' +
      'Never include student names, IDs, or individual scores.'
    );
  });

  it('states the owner-fixed MET / PARTLY MET / NOT MET thresholds', () => {
    const prompt = renderGuideCanvasPrompt(CANVAS_GUIDE, COURSE);
    expect(prompt).toContain('MET if at least 70%');
    expect(prompt).toContain('PARTLY MET if 50-69%');
    expect(prompt).toContain('NOT MET if below 50%');
    expect(prompt).toContain('80%');
    expect(prompt).toContain('Proficient');
  });

  it('quotes each objective verbatim and numbers them', () => {
    const prompt = renderGuideCanvasPrompt(CANVAS_GUIDE, COURSE);
    expect(prompt).toContain('1. Develop a brand strategy grounded in audience research.');
    expect(prompt).toContain('2. Present a strategic rationale to a client.');
    expect(prompt).toContain('3. Build a visual identity system that holds across media.');
  });

  it('formats a rubric-row evidence item and a bare assignment-score item', () => {
    const prompt = renderGuideCanvasPrompt(CANVAS_GUIDE, COURSE);
    expect(prompt).toContain('Brand Audit (rubric row: Research depth)');
    expect(prompt).toContain('Final Brand Playbook (assignment score)');
  });

  it('adds a Note for a partially-measured objective, taken from the gather text', () => {
    const prompt = renderGuideCanvasPrompt(CANVAS_GUIDE, COURSE);
    expect(prompt).toContain('Note: The playbook rubric does not have a rationale row, so this score blends several skills.');
  });

  it('for an unmeasured objective, tells the agent not to estimate and gives the suggested fix, without a Pull list', () => {
    const prompt = renderGuideCanvasPrompt(CANVAS_GUIDE, COURSE);
    expect(prompt).toContain(
      'No graded evidence yet — report "no graded evidence" for this objective and do not estimate. ' +
      'Suggested fix: Add a Visual System row to a rubric.'
    );
    const objective3 = prompt.split('3. Build a visual identity system that holds across media.')[1]!.split(/\n\n/)[0]!;
    expect(objective3).not.toContain('Pull:');
  });

  it('ends with the output instructions: one table, one sentence per objective, then a not-found list', () => {
    const prompt = renderGuideCanvasPrompt(CANVAS_GUIDE, COURSE);
    expect(prompt).toContain('objective | items used | n | mean | % at or above level | judgment');
    expect(prompt).toContain('one sentence per objective on what the evidence shows');
    expect(prompt).toContain('anything not found in Canvas (instead of guessing)');
  });

  it('never includes student names, IDs, or individual scores', () => {
    const prompt = renderGuideCanvasPrompt(CANVAS_GUIDE, COURSE);
    expect(prompt).not.toMatch(/\b\d{2,3}%\s+(scored|got|earned)\b/i);
    expect(prompt).not.toMatch(/C\d{8}/);
  });
});
