import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mergeCourseInfo } from '@/lib/ai/wiki/update';
import { captureProfileSchema } from '@/lib/ai/capture/schema';

// ---------------------------------------------------------------------------
// GOOGLE_SHEET_ID unset → all sheet-derived fields null/empty
// ---------------------------------------------------------------------------
describe('mergeCourseInfo — GOOGLE_SHEET_ID unset', () => {
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env.GOOGLE_SHEET_ID;
    delete process.env.GOOGLE_SHEET_ID;
  });

  afterEach(() => {
    if (prev !== undefined) process.env.GOOGLE_SHEET_ID = prev;
    else delete process.env.GOOGLE_SHEET_ID;
  });

  it('sheetSourceUrl is null when GOOGLE_SHEET_ID is unset', () => {
    // Even if sheetData were provided by some other mechanism, sheetSourceUrl
    // depends on GOOGLE_SHEET_ID being set.
    const info = mergeCourseInfo({ title: 'Test', level: 1000, prerequisites: null }, null);
    expect(info.sheetSourceUrl).toBeNull();
  });

  it('all sheet fields are null/empty when sheetData is null', () => {
    const info = mergeCourseInfo({ title: 'Test', level: 1000, prerequisites: null }, null);
    expect(info.sheetDescription).toBeNull();
    expect(info.sheetLearningObjectives).toEqual([]);
    expect(info.sheetMajorProjects).toEqual([]);
    expect(info.sheetSkillsRequired).toEqual([]);
    expect(info.syllabusUrl).toBeNull();
    expect(info.sheetSourceUrl).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// captureProfileSchema backward compat — legacy snapshots parse cleanly
// ---------------------------------------------------------------------------
describe('captureProfileSchema — legacy snapshot backward compat', () => {
  // Minimal pre-2026-06-08 snapshot: no class_structure, no major_projects.
  const legacyProfile = {
    course_code: 'GC 1010',
    scale_version: 'v1' as const,
    generated_at: '2026-05-15T12:00:00Z',
    overview: null,
    competencies: [
      {
        statement: 'Students identify primary print processes.',
        type: 'technical' as const,
        k_depth: 2,
        u_depth: 0,
        d_depth: 1,
        evidence_k: 'Quiz 1 asks to identify letterpress.',
        evidence_u: null,
        evidence_d: 'Lab 1 tour report.',
        rationale: 'Exposure-level course.',
      },
    ],
    incoming_expectations: [],
    verification_summary: {
      course_shape: 'Survey course.',
      strongest_evidence: ['Quiz 1'],
      dimensional_patterns: [],
      catalog_vs_evidence: [],
      foundationals_glance: 'Agency observed.',
    },
    audit_notes: {
      prereq_gaps: [],
      objective_misalignments: [],
      cross_source_conflicts: [],
      suggested_objective_revisions: [],
      productive_failure_conditions: null,
    },
    revised_objectives_draft: null,
    course_emphasis: null,
    // Explicitly omit class_structure and major_projects
  };

  it('parses a legacy profile with no class_structure or major_projects', () => {
    expect(() => captureProfileSchema.parse(legacyProfile)).not.toThrow();
  });

  it('parsed legacy profile has undefined (not null) for new fields', () => {
    const result = captureProfileSchema.parse(legacyProfile);
    expect(result.class_structure).toBeUndefined();
    expect(result.major_projects).toBeUndefined();
  });

  it('parses when class_structure is explicitly null', () => {
    expect(() =>
      captureProfileSchema.parse({ ...legacyProfile, class_structure: null })
    ).not.toThrow();
  });

  it('parses when major_projects is explicitly null', () => {
    expect(() =>
      captureProfileSchema.parse({ ...legacyProfile, major_projects: null })
    ).not.toThrow();
  });

  it('parses when both new fields are null', () => {
    expect(() =>
      captureProfileSchema.parse({
        ...legacyProfile,
        class_structure: null,
        major_projects: null,
      })
    ).not.toThrow();
  });
});
