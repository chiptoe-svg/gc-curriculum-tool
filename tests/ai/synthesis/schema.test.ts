import { describe, it, expect } from 'vitest';
import { synthesisResultSchema, synthesisResultJsonSchema } from '@/lib/ai/synthesis/schema';

describe('synthesisResultSchema', () => {
  it('accepts a minimal valid result', () => {
    const minimal = {
      aggregatedJobTitles: [],
      responsibilityThemes: [],
      commonRequiredSkills: [],
      commonNiceToHaveSkills: [],
      interviewQuestionThemes: [],
      salaryDistribution: { n: 0 },
      sampleQuotes: [],
      proposedKUDEdits: [],
    };
    expect(() => synthesisResultSchema.parse(minimal)).not.toThrow();
  });

  it('accepts a populated result', () => {
    const full = {
      aggregatedJobTitles: [{ title: 'Press Operator', count: 3, partnerIds: ['p1', 'p2', 'p3'] }],
      responsibilityThemes: [
        { theme: 'Color management', quotedFrom: [{ partnerId: 'p1', snippet: 'must hit Pantone match' }] },
      ],
      commonRequiredSkills: [{ skill: 'GMI', count: 2 }],
      commonNiceToHaveSkills: [{ skill: 'Esko ArtPro+', count: 1 }],
      interviewQuestionThemes: [
        { theme: 'Color science', examples: ['Explain delta-E.'] },
      ],
      salaryDistribution: { p25: 48000, p50: 55000, p75: 65000, n: 6 },
      sampleQuotes: [{ partnerId: 'p1', quote: 'We hire for color literacy first.' }],
      proposedKUDEdits: [
        {
          descriptor: 'know',
          type: 'addition',
          proposedText: 'Color management workflows including spectrophotometric measurement and ICC profile generation.',
          rationale: '7 of 12 submissions mention color management; not currently in Know descriptors.',
          supportingPartnerIds: ['p1', 'p2'],
        },
      ],
    };
    expect(() => synthesisResultSchema.parse(full)).not.toThrow();
  });

  it('rejects missing required fields', () => {
    expect(() => synthesisResultSchema.parse({ aggregatedJobTitles: [] })).toThrow();
  });

  it('rejects an invalid descriptor value on a proposed edit', () => {
    const bad = {
      aggregatedJobTitles: [],
      responsibilityThemes: [],
      commonRequiredSkills: [],
      commonNiceToHaveSkills: [],
      interviewQuestionThemes: [],
      salaryDistribution: { n: 0 },
      sampleQuotes: [],
      proposedKUDEdits: [
        { descriptor: 'nonsense', type: 'addition', proposedText: 'x', rationale: 'y', supportingPartnerIds: [] },
      ],
    };
    expect(() => synthesisResultSchema.parse(bad)).toThrow();
  });
});

describe('synthesisResultJsonSchema', () => {
  it('is a JSON Schema object with required top-level fields', () => {
    expect(synthesisResultJsonSchema.type).toBe('object');
    const required = synthesisResultJsonSchema.required ?? [];
    for (const f of ['aggregatedJobTitles', 'responsibilityThemes', 'commonRequiredSkills',
                     'commonNiceToHaveSkills', 'interviewQuestionThemes', 'salaryDistribution',
                     'sampleQuotes', 'proposedKUDEdits']) {
      expect(required).toContain(f);
    }
  });
});
