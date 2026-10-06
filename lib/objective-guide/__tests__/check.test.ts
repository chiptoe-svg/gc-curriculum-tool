import { describe, it, expect } from 'vitest';
import { objectiveInSyllabus, normalizeForQuote, findGuideProblems, finalizeGuide } from '../check';
import { parseCanvasAssignmentNames } from '../canvas-names';
import type { ModelGuide } from '../schema';
import { ASSIGNMENTS_TEXT, SYLLABUS_TEXT } from './fixtures';

const known = parseCanvasAssignmentNames(ASSIGNMENTS_TEXT);

describe('objectiveInSyllabus', () => {
  it('ignores bullets, numbering and line wrapping', () => {
    expect(objectiveInSyllabus('Develop a brand strategy grounded in audience research.', SYLLABUS_TEXT)).toBe(true);
    expect(objectiveInSyllabus('Build a visual identity system that holds across media.', SYLLABUS_TEXT)).toBe(true);
    expect(objectiveInSyllabus('Present a strategic rationale to a client.', SYLLABUS_TEXT)).toBe(true);
    expect(objectiveInSyllabus('•  Develop a brand   strategy grounded in audience research.', SYLLABUS_TEXT)).toBe(true);
  });

  it('rejects paraphrase, other casing and text that is not there', () => {
    expect(objectiveInSyllabus('Develop a brand strategy based on audience research.', SYLLABUS_TEXT)).toBe(false);
    expect(objectiveInSyllabus('develop a brand strategy grounded in audience research.', SYLLABUS_TEXT)).toBe(false);
    expect(objectiveInSyllabus('Measure brand equity over time.', SYLLABUS_TEXT)).toBe(false);
    expect(objectiveInSyllabus('   ', SYLLABUS_TEXT)).toBe(false);
  });

  it('normalizeForQuote joins wrapped lines with single spaces', () => {
    expect(normalizeForQuote('• Build a visual identity system\n  that holds across media.')).toBe('Build a visual identity system that holds across media.');
  });
});

const DRAFT: ModelGuide = {
  intro: '  Intro.  ',
  objectives: [
    { objective: 'Develop a brand strategy grounded in audience research.', measure: 'clear', evidence: [{ assignment: 'brand  audit', rubric_row: 'RESEARCH DEPTH' }], gather: 'g1', suggestion: null },
    { objective: 'Build a visual identity system that holds across media.', measure: 'partial', evidence: [{ assignment: 'Brand Audit', rubric_row: 'Visual system' }, { assignment: 'Capstone Pitch', rubric_row: null }], gather: 'g2', suggestion: 's2' },
    { objective: 'Measure brand equity over time.', measure: 'none', evidence: [], gather: 'g3', suggestion: 's3' },
  ],
};

describe('findGuideProblems', () => {
  it('lists unknown assignments, rubric rows under the wrong assignment, and unquoted objectives', () => {
    expect(findGuideProblems(DRAFT, known, SYLLABUS_TEXT)).toEqual([
      'rubric row: Visual system (under Brand Audit)',
      'assignment: Capstone Pitch',
      'objective: Measure brand equity over time.',
    ]);
  });

  it('returns nothing for a clean draft', () => {
    expect(findGuideProblems({ intro: 'x', objectives: [DRAFT.objectives[0]!] }, known, SYLLABUS_TEXT)).toEqual([]);
  });
});

describe('finalizeGuide', () => {
  it('drops unmatched items, canonicalises names, downgrades to none and records the drops', () => {
    const { guide, dropped } = finalizeGuide(DRAFT, known, SYLLABUS_TEXT);
    expect(guide).toEqual({
      intro: 'Intro.',
      objectives: [
        { objective: 'Develop a brand strategy grounded in audience research.', measure: 'clear', evidence: [{ assignment: 'Brand Audit', rubric_row: 'Research depth' }], gather: 'g1', suggestion: null },
        { objective: 'Build a visual identity system that holds across media.', measure: 'none', evidence: [], gather: 'g2', suggestion: 's2' },
      ],
      checklist: [{ assignment: 'Brand Audit', rubric_row: 'Research depth' }],
    });
    expect(dropped).toEqual([
      'rubric row: Visual system (under Brand Audit)',
      'assignment: Capstone Pitch',
      'objective: Measure brand equity over time.',
    ]);
  });

  it('dedups evidence, keeps at most three, clears the suggestion when clear, and dedups the checklist across objectives', () => {
    const draft: ModelGuide = {
      intro: 'x',
      objectives: [
        {
          objective: 'Develop a brand strategy grounded in audience research.', measure: 'clear', gather: 'g', suggestion: 'should vanish',
          evidence: [
            { assignment: 'Brand Audit', rubric_row: 'Research depth' },
            { assignment: 'brand audit', rubric_row: 'research depth' },
            { assignment: 'Final Brand Playbook', rubric_row: null },
            { assignment: 'Reading Quiz 1', rubric_row: null },
            { assignment: 'Brand Audit', rubric_row: 'Strategic rationale' },
          ],
        },
        {
          objective: '• Present a strategic rationale to a client.', measure: 'partial', gather: 'g', suggestion: 's',
          evidence: [{ assignment: 'Final Brand Playbook', rubric_row: 'strategic rationale' }, { assignment: 'Brand Audit', rubric_row: 'Research depth' }],
        },
      ],
    };
    const { guide, dropped } = finalizeGuide(draft, known, SYLLABUS_TEXT);
    expect(dropped).toEqual([]);
    expect(guide.objectives[0]).toEqual({
      objective: 'Develop a brand strategy grounded in audience research.', measure: 'clear', gather: 'g', suggestion: null,
      evidence: [
        { assignment: 'Brand Audit', rubric_row: 'Research depth' },
        { assignment: 'Final Brand Playbook', rubric_row: null },
        { assignment: 'Reading Quiz 1', rubric_row: null },
      ],
    });
    expect(guide.objectives[1]!.objective).toBe('Present a strategic rationale to a client.');
    expect(guide.checklist).toEqual([
      { assignment: 'Brand Audit', rubric_row: 'Research depth' },
      { assignment: 'Final Brand Playbook', rubric_row: null },
      { assignment: 'Reading Quiz 1', rubric_row: null },
      { assignment: 'Final Brand Playbook', rubric_row: 'Strategic   Rationale' },
    ]);
  });

  it('scrubs a dropped assignment/rubric name out of gather when it leaks there, and nulls a leaking suggestion', () => {
    const draft: ModelGuide = {
      intro: 'x',
      objectives: [
        {
          objective: 'Develop a brand strategy grounded in audience research.',
          measure: 'partial',
          // "Brand Playbook / Strategic rationale" is not a real Canvas name — gets dropped.
          evidence: [
            { assignment: 'Brand Playbook', rubric_row: 'Strategic rationale' },
            { assignment: 'Brand Audit', rubric_row: 'Research depth' },
          ],
          gather: 'Pull the Brand Playbook scores and the share of students at proficient or above.',
          suggestion: 'Add a rubric row to the Brand Playbook.',
        },
      ],
    };
    const { guide, dropped } = finalizeGuide(draft, known, SYLLABUS_TEXT);
    expect(dropped).toEqual(['assignment: Brand Playbook']);
    const o = guide.objectives[0]!;
    expect(o.gather.toLowerCase()).not.toContain('brand playbook');
    expect(o.gather).toBe(
      "The score distribution on the 'Research depth' row of the Brand Audit rubric, and the share of students at proficient or above.",
    );
    expect(o.suggestion).toBeNull();
  });

  it('falls back to the no-measure gather sentence when no evidence survives the drop', () => {
    const draft: ModelGuide = {
      intro: 'x',
      objectives: [
        {
          objective: 'Develop a brand strategy grounded in audience research.',
          measure: 'partial',
          evidence: [{ assignment: 'Brand Playbook', rubric_row: 'Strategic rationale' }],
          gather: 'Pull the Brand Playbook scores.',
          suggestion: null,
        },
      ],
    };
    const { guide } = finalizeGuide(draft, known, SYLLABUS_TEXT);
    expect(guide.objectives[0]!.gather).toBe(
      'Once a graded measure exists, the score distribution on it and the share of students at proficient or above.',
    );
    expect(guide.objectives[0]!.measure).toBe('none');
  });

  it('leaves gather untouched when nothing was dropped for that objective', () => {
    const draft: ModelGuide = {
      intro: 'x',
      objectives: [
        {
          objective: 'Develop a brand strategy grounded in audience research.',
          measure: 'clear',
          evidence: [{ assignment: 'Brand Audit', rubric_row: 'Research depth' }],
          gather: 'Mentions Brand Playbook in passing but nothing was dropped here.',
          suggestion: null,
        },
      ],
    };
    const { guide, dropped } = finalizeGuide(draft, known, SYLLABUS_TEXT);
    expect(dropped).toEqual([]);
    expect(guide.objectives[0]!.gather).toBe('Mentions Brand Playbook in passing but nothing was dropped here.');
  });

  it('clears evidence when the model says measure is none but evidence survived', () => {
    const draft: ModelGuide = {
      intro: 'x',
      objectives: [
        {
          objective: 'Develop a brand strategy grounded in audience research.',
          measure: 'none',
          evidence: [{ assignment: 'Brand Audit', rubric_row: 'Research depth' }],
          gather: 'g',
          suggestion: 's',
        },
      ],
    };
    const { guide } = finalizeGuide(draft, known, SYLLABUS_TEXT);
    expect(guide.objectives[0]!.measure).toBe('none');
    expect(guide.objectives[0]!.evidence).toEqual([]);
    expect(guide.checklist).toEqual([]);
  });
});
