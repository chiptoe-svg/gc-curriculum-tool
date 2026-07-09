import { describe, it, expect } from 'vitest';
import { buildAdoptedProfile } from '@/lib/ai/explore/adopt';
import type { CaptureProfile } from '@/lib/ai/capture/schema';
import type { Scenario } from '@/lib/ai/explore/scenario';

const baseline = {
  course_code: 'GC 3460', scale_version: 'v1', generated_at: 'now', overview: null,
  competencies: [{ statement: 'Prepress preparation', type: 'technical', k_depth: 2, u_depth: 2, d_depth: 3, evidence_k: 'q', evidence_u: 'm', evidence_d: 'p', rationale: 'x' }],
  incoming_expectations: [], verification_summary: null,
  audit_notes: { prereq_gaps: [], objective_misalignments: [], cross_source_conflicts: [], suggested_objective_revisions: [], productive_failure_conditions: null, source: 'inferred', citations: [] },
  revised_objectives_draft: null, course_emphasis: [],
} as unknown as CaptureProfile;

const scenario = {
  id: 's1', courseCode: 'GC 3460', baselineSnapshotId: 'snap1',
  change: { prose: 'add trapping lab', activity: 'trapping lab', artifact: 'graded', competencies: ['Prepress preparation'], rubricCriteria: ['registration'], assumesIncoming: [{ label: 'color models', subCompetencyId: null, k: 3, u: null, d: null }] },
  predictedDeltas: [{ competency: 'Prepress preparation', from: { k: 2, u: 2, d: 3 }, to: { k: 3, u: 2, d: 4 }, confidence: 'medium', rationale: 'r' }],
  computedRipple: [], caption: null, createdAt: 'now',
} as unknown as Scenario;

describe('buildAdoptedProfile', () => {
  it('sets intended_target from predicted delta, provenance, objectives + incoming', () => {
    const p = buildAdoptedProfile(baseline, scenario);
    expect((p.competencies[0] as any).intended_target).toEqual({ k: 3, u: 2, d: 4 });
    expect((p.competencies[0] as any).d_depth).toBe(3); // measured baseline untouched
    expect(p.adopted_from_scenario_id).toBe('s1');
    expect(p.revised_objectives_draft?.some(o => /trapping lab/i.test(o))).toBe(true);
    expect(p.incoming_expectations.some(e => /color models/i.test(e.statement))).toBe(true);
  });
  it('does not duplicate an incoming-expectation the baseline already has', () => {
    const withExisting = { ...baseline, incoming_expectations: [{ statement: 'color models', expected_depth: { k: 2, u: null, d: 1 }, evidenced_by: ['syllabus'], confidence: 'medium' }] } as unknown as CaptureProfile;
    const p = buildAdoptedProfile(withExisting, scenario);
    expect(p.incoming_expectations.filter(e => /color models/i.test(e.statement))).toHaveLength(1);
  });
  it('does not mutate the baseline (pure)', () => {
    const p = buildAdoptedProfile(baseline, scenario);
    expect((baseline.competencies[0] as any).intended_target).toBeUndefined();
    expect(baseline.adopted_from_scenario_id).toBeUndefined();
    expect(p).not.toBe(baseline);
  });
});
