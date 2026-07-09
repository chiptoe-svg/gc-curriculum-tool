import { describe, it, expect } from 'vitest';
import { captureCompetencySchema, captureProfileSchema } from '@/lib/ai/capture/schema';

const comp = { statement: 'prepress', type: 'technical' as const, k_depth: 3, u_depth: 2, d_depth: 3, evidence_k: 'q', evidence_u: 'm', evidence_d: 'p', rationale: 'x' };

describe('intended_target + adopted_from_scenario_id', () => {
  it('accepts a competency with an intended_target', () => {
    const r = captureCompetencySchema.safeParse({ ...comp, intended_target: { k: 3, u: 2, d: 4 } });
    expect(r.success && r.data.intended_target?.d).toBe(4);
  });
  it('accepts intended_target null and omitted (backward-compat)', () => {
    expect(captureCompetencySchema.safeParse({ ...comp, intended_target: null }).success).toBe(true);
    expect(captureCompetencySchema.safeParse(comp).success).toBe(true);
  });
  it('profile accepts adopted_from_scenario_id (string, null, omitted)', () => {
    const base = {
      course_code: 'GC 3460',
      scale_version: 'v1' as const,
      generated_at: 'now',
      overview: null,
      competencies: [comp],
      incoming_expectations: [],
      verification_summary: {
        course_shape: 'A lab-heavy course on prepress production.',
        strongest_evidence: ['Prepress project rubric'],
        dimensional_patterns: [],
        catalog_vs_evidence: [],
        foundationals_glance: 'Attention to detail developed through production checklists.',
      },
      audit_notes: {
        prereq_gaps: [],
        objective_misalignments: [],
        cross_source_conflicts: [],
        suggested_objective_revisions: [],
        productive_failure_conditions: null,
        source: 'inferred' as const,
        citations: [],
      },
      revised_objectives_draft: null,
      course_emphasis: [],
    };
    expect(captureProfileSchema.safeParse({ ...base, adopted_from_scenario_id: 's1' }).success).toBe(true);
    expect(captureProfileSchema.safeParse({ ...base, adopted_from_scenario_id: null }).success).toBe(true);
    expect(captureProfileSchema.safeParse(base).success).toBe(true);
  });
});
