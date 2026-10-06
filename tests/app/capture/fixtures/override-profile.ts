import { captureScaleVersion, type CaptureProfile } from '@/lib/ai/capture/schema';

export const STMT = 'Students analyze brand-color reproduction';
export function validProfile(): CaptureProfile {
  return {
    competencies: [{
      statement: STMT, type: 'technical', k_depth: 2, u_depth: 2, d_depth: 2,
      evidence_k: 'k', evidence_u: 'u', evidence_d: 'd', rationale: 'r',
      source: 'inferred', citations: [], k_says: null, u_says: null, d_says: null,
    }],
    incoming_expectations: [],
    verification_summary: { course_shape: 'x', strongest_evidence: ['x'], dimensional_patterns: [], catalog_vs_evidence: [], foundationals_glance: 'x', source: 'inferred', citations: [] },
    audit_notes: { prereq_gaps: [], objective_misalignments: [], cross_source_conflicts: [], suggested_objective_revisions: [], source: 'inferred', citations: [] },
    course_emphasis: [], course_code: 'GC 2400', scale_version: captureScaleVersion, generated_at: 'now',
    overview: null, class_structure: null, major_projects: null, revised_objectives_draft: [],
  } as unknown as CaptureProfile;
}

