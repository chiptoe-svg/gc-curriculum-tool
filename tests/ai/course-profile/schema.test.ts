import { describe, it, expect } from 'vitest';
import {
  analysisFindingSchema,
  analysisFindingJsonSchema,
  courseProfileResultSchema,
  courseProfileResultJsonSchema,
} from '@/lib/ai/course-profile/schema';

describe('analysisFindingSchema', () => {
  it('accepts a valid finding', () => {
    expect(() =>
      analysisFindingSchema.parse({
        materialType: 'rubric',
        competencies: [
          {
            name: 'Color management',
            description: 'Ability to match Pantone swatches.',
            evidenceQuotes: ['Students must hit a delta-E of ≤ 2.0 on the press check.'],
          },
        ],
        skills: ['Spectrophotometry', 'ICC profile generation'],
        notes: 'Assignment 3 is the most demanding.',
      })
    ).not.toThrow();
  });

  it('accepts a finding with empty competencies and skills', () => {
    expect(() =>
      analysisFindingSchema.parse({
        materialType: 'worksheet',
        competencies: [],
        skills: [],
        notes: '',
      })
    ).not.toThrow();
  });

  it('rejects missing materialType', () => {
    expect(() =>
      analysisFindingSchema.parse({ competencies: [], skills: [], notes: '' })
    ).toThrow();
  });
});

describe('analysisFindingJsonSchema', () => {
  it('is a JSON Schema object with required top-level fields', () => {
    expect(analysisFindingJsonSchema.type).toBe('object');
    const required = analysisFindingJsonSchema.required as readonly string[];
    for (const f of ['materialType', 'competencies', 'skills', 'notes']) {
      expect(required).toContain(f);
    }
  });
});

describe('courseProfileResultSchema', () => {
  const minimal = {
    summary: 'This course develops press-floor fluency.',
    learningObjectives: ['Operate an 8-color press safely'],
    skills: ['Color management'],
    competencies: [
      {
        name: 'Press operation',
        description: 'Run a commercial press through make-ready and production.',
        level: 'developed',
        evidence: [{ fileName: 'rubric.pdf', quote: 'Student must complete a 10k-impression run.' }],
      },
    ],
    catalogDivergence: {
      reinforced: ['Color theory'],
      additions: ['Spectrophotometric measurement'],
      gaps: ['Bindery operations'],
    },
  };

  it('accepts a valid full result', () => {
    expect(() => courseProfileResultSchema.parse(minimal)).not.toThrow();
  });

  it('accepts empty arrays throughout', () => {
    expect(() =>
      courseProfileResultSchema.parse({
        summary: 'Short.',
        learningObjectives: [],
        skills: [],
        competencies: [],
        catalogDivergence: { reinforced: [], additions: [], gaps: [] },
      })
    ).not.toThrow();
  });

  it('rejects missing catalogDivergence', () => {
    const { catalogDivergence: _cd, ...bad } = minimal;
    expect(() => courseProfileResultSchema.parse(bad)).toThrow();
  });

  it('rejects a competency without required fields', () => {
    expect(() =>
      courseProfileResultSchema.parse({
        ...minimal,
        competencies: [{ name: 'X' }],
      })
    ).toThrow();
  });
});

describe('courseProfileResultJsonSchema', () => {
  it('has required top-level fields', () => {
    expect(courseProfileResultJsonSchema.type).toBe('object');
    const required = courseProfileResultJsonSchema.required as readonly string[];
    for (const f of ['summary', 'learningObjectives', 'skills', 'competencies', 'catalogDivergence']) {
      expect(required).toContain(f);
    }
  });
});
