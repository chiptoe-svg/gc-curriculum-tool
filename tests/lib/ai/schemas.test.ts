import { describe, it, expect } from 'vitest';
import {
  kudOutcomesSchema,
  coverageScoresSchema,
  prerequisiteClaimsSchema,
  prerequisiteGapsSchema,
} from '@/lib/ai/schemas';

describe('AI output schemas', () => {
  it('accepts valid KUDOutcomes', () => {
    const parsed = kudOutcomesSchema.parse({
      description: 'Course teaches X',
      know: ['fact one', 'fact two'],
      understand: ['why one'],
      do: ['can do one'],
    });
    expect(parsed.description).toBe('Course teaches X');
  });

  it('rejects KUDOutcomes with empty description', () => {
    expect(() => kudOutcomesSchema.parse({
      description: '',
      know: ['fact'],
      understand: ['why'],
      do: ['do'],
    })).toThrow();
  });

  it('accepts valid CoverageScore array with reasoning', () => {
    const parsed = coverageScoresSchema.parse([
      {
        subCompetencyId: 'workflow-design',
        kudLevel: 'do',
        confidence: 'high',
        reasoning: 'The Capstone Press Matching project requires students to design a workflow including curves and proofing — direct Do-level evidence.',
      },
    ]);
    expect(parsed).toHaveLength(1);
  });

  it('rejects CoverageScore with empty reasoning', () => {
    expect(() => coverageScoresSchema.parse([
      { subCompetencyId: 'x', kudLevel: 'know', confidence: 'low', reasoning: '' },
    ])).toThrow();
  });

  it('rejects CoverageScore with too-short reasoning', () => {
    expect(() => coverageScoresSchema.parse([
      { subCompetencyId: 'x', kudLevel: 'know', confidence: 'low', reasoning: 'yes' },
    ])).toThrow(/at least 20/);
  });

  it('accepts valid PrerequisiteCompetencyClaim array', () => {
    const parsed = prerequisiteClaimsSchema.parse([
      { subCompetencyId: 'color-foundations', expectedKudLevel: 'understand', rationale: 'GC 4060 cannot evaluate packaging color without baseline understanding of separation systems.' },
    ]);
    expect(parsed[0]?.expectedKudLevel).toBe('understand');
  });

  it('accepts valid PrerequisiteGap array', () => {
    const parsed = prerequisiteGapsSchema.parse([
      {
        subCompetencyId: 'color-foundations',
        expectedKudLevel: 'understand',
        status: 'underdeveloped',
        priorCourseworkEvidence: 'GC 3460 develops color at Do level for ink chemistry but does not generalize to packaging color decisions.',
        reasoning: 'The prior coursework covers the mechanics but not the application context this course needs.',
      },
    ]);
    expect(parsed[0]?.status).toBe('underdeveloped');
  });
});
