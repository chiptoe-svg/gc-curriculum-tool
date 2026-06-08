import { describe, it, expect } from 'vitest';
import {
  classStructureSchema,
  majorProjectItemSchema,
  captureProfileSchema,
} from '@/lib/ai/capture/schema';

// ---------------------------------------------------------------------------
// classStructureSchema
// ---------------------------------------------------------------------------
describe('classStructureSchema', () => {
  const validStructure = {
    topics: ['Color theory', 'Press operations', 'Prepress workflow'],
    cadence: 'Two 75-minute studio sessions per week.',
    assessment: 'Three tests, two major projects, and weekly graded labs.',
    source: 'materials' as const,
    citations: [],
  };

  it('accepts a valid class structure', () => {
    expect(() => classStructureSchema.parse(validStructure)).not.toThrow();
  });

  it('accepts source and citations as absent (optional)', () => {
    const { source: _s, citations: _c, ...noAttrib } = validStructure;
    expect(() => classStructureSchema.parse(noAttrib)).not.toThrow();
  });

  it('rejects empty topics array', () => {
    expect(() =>
      classStructureSchema.parse({ ...validStructure, topics: [] })
    ).toThrow();
  });

  it('rejects topics containing empty strings', () => {
    expect(() =>
      classStructureSchema.parse({ ...validStructure, topics: [''] })
    ).toThrow();
  });

  it('rejects cadence shorter than 5 chars', () => {
    expect(() =>
      classStructureSchema.parse({ ...validStructure, cadence: 'Hi' })
    ).toThrow();
  });

  it('rejects assessment shorter than 10 chars', () => {
    expect(() =>
      classStructureSchema.parse({ ...validStructure, assessment: 'Graded.' })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// majorProjectItemSchema
// ---------------------------------------------------------------------------
describe('majorProjectItemSchema', () => {
  const validProject = {
    title: 'Brand Color Report',
    description: 'Students produce a 12-page press-ready specification document.',
    competencies: ['Students prepare production-ready package artwork'],
    source: 'materials' as const,
    citations: [],
  };

  it('accepts a valid project item', () => {
    expect(() => majorProjectItemSchema.parse(validProject)).not.toThrow();
  });

  it('accepts source and citations as absent', () => {
    const { source: _s, citations: _c, ...noAttrib } = validProject;
    expect(() => majorProjectItemSchema.parse(noAttrib)).not.toThrow();
  });

  it('rejects empty title', () => {
    expect(() =>
      majorProjectItemSchema.parse({ ...validProject, title: '' })
    ).toThrow();
  });

  it('rejects description shorter than 10 chars', () => {
    expect(() =>
      majorProjectItemSchema.parse({ ...validProject, description: 'Short.' })
    ).toThrow();
  });

  it('rejects empty competencies array', () => {
    expect(() =>
      majorProjectItemSchema.parse({ ...validProject, competencies: [] })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// captureProfileSchema — backward compat
// ---------------------------------------------------------------------------
describe('captureProfileSchema — new fields are nullable/optional', () => {
  // Minimal profile without the new fields (simulates a legacy snapshot)
  const legacyProfile = {
    course_code: 'GC 3460',
    scale_version: 'v1' as const,
    generated_at: new Date().toISOString(),
    overview: null,
    competencies: [
      {
        statement: 'Students operate color measurement devices.',
        type: 'technical' as const,
        k_depth: 2,
        u_depth: 2,
        d_depth: 3,
        evidence_k: 'Lab 3 requires spectrophotometer readings.',
        evidence_u: 'Quiz asks why delta-E matters.',
        evidence_d: 'Project 1 rubric includes a press check item.',
        rationale: 'Evidence from rubric and labs.',
        source: 'materials' as const,
        citations: [],
      },
    ],
    incoming_expectations: [],
    verification_summary: {
      course_shape: 'Studio-heavy color course.',
      strongest_evidence: ['Project 1 rubric'],
      dimensional_patterns: [],
      catalog_vs_evidence: [],
      foundationals_glance: 'Agency developed through independent press checks.',
      source: 'materials' as const,
      citations: [],
    },
    audit_notes: {
      prereq_gaps: [],
      objective_misalignments: [],
      cross_source_conflicts: [],
      suggested_objective_revisions: [],
      productive_failure_conditions: null,
      source: 'materials' as const,
      citations: [],
    },
    revised_objectives_draft: null,
    course_emphasis: null,
    // class_structure and major_projects deliberately absent
  };

  it('parses a legacy profile without class_structure or major_projects', () => {
    const result = captureProfileSchema.parse(legacyProfile);
    expect(result.class_structure).toBeUndefined();
    expect(result.major_projects).toBeUndefined();
  });

  it('parses a profile with class_structure: null', () => {
    const result = captureProfileSchema.parse({ ...legacyProfile, class_structure: null });
    expect(result.class_structure).toBeNull();
  });

  it('parses a profile with major_projects: null', () => {
    const result = captureProfileSchema.parse({ ...legacyProfile, major_projects: null });
    expect(result.major_projects).toBeNull();
  });

  it('parses a profile with both fields populated', () => {
    const result = captureProfileSchema.parse({
      ...legacyProfile,
      class_structure: {
        topics: ['Color theory', 'Press ops'],
        cadence: 'Two 75-min sessions per week.',
        assessment: 'Three tests and two major projects.',
      },
      major_projects: [
        {
          title: 'Brand Color Report',
          description: 'Students produce a 12-page press-ready spec.',
          competencies: ['Students prepare production-ready package artwork'],
        },
      ],
    });
    expect(result.class_structure?.topics).toHaveLength(2);
    expect(result.major_projects).toHaveLength(1);
  });
});
