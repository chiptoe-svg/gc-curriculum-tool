export const foundationalRow = (statement: string, evidence = 'graded artifact') => ({
  statement,
  type: 'foundational' as const,
  k_depth: null,
  u_depth: null,
  d_depth: 2,
  evidence_k: null,
  evidence_u: null,
  evidence_d: evidence,
  rationale: 'x',
});

export const baseProfile = (competencies: unknown[]) => ({
  course_code: 'GC 3460',
  scale_version: 'v1' as const,
  generated_at: 'now',
  overview: null,
  competencies,
  incoming_expectations: [],
  verification_summary: {
    course_shape: 'A lab-heavy course.',
    strongest_evidence: ['rubric'],
    dimensional_patterns: [],
    catalog_vs_evidence: [],
    foundationals_glance: 'ok',
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
});

