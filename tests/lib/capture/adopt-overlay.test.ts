import { describe, it, expect } from 'vitest';
import { preserveAdoptOverlay } from '@/lib/capture/adopt-overlay';
import type { CaptureProfile } from '@/lib/ai/capture/schema';

const mk = (over: Partial<CaptureProfile>): CaptureProfile => ({
  course_code: 'GC 3460', scale_version: 'v1', generated_at: 'now', overview: null,
  competencies: [], incoming_expectations: [], verification_summary: null,
  audit_notes: { prereq_gaps: [], objective_misalignments: [], cross_source_conflicts: [], suggested_objective_revisions: [], productive_failure_conditions: null, source: 'inferred', citations: [] },
  revised_objectives_draft: null, course_emphasis: [], ...over,
} as unknown as CaptureProfile);

const comp = (statement: string, extra: Record<string, unknown> = {}) => ({ statement, type: 'technical', k_depth: 3, u_depth: 2, d_depth: 3, evidence_k: 'q', evidence_u: 'm', evidence_d: 'p', rationale: 'x', ...extra });

describe('preserveAdoptOverlay', () => {
  it('carries intended_target + adopted_from onto a fresh score by statement match', () => {
    const prev = mk({ adopted_from_scenario_id: 's1', competencies: [comp('Prepress Prep', { intended_target: { k: null, u: null, d: 4 } }) as never] });
    const next = mk({ competencies: [comp('  prepress   prep ', { d_depth: 4 }) as never] });
    const out = preserveAdoptOverlay(prev, next);
    expect((out as any).adopted_from_scenario_id).toBe('s1');
    expect((out.competencies[0] as any).intended_target?.d).toBe(4);
    expect((out.competencies[0] as any).d_depth).toBe(4); // measured from the fresh score, untouched
  });
  it('is a no-op when prev has no adopt overlay', () => {
    const prev = mk({ competencies: [comp('X') as never] });
    const next = mk({ competencies: [comp('X') as never] });
    const out = preserveAdoptOverlay(prev, next);
    expect((out as any).adopted_from_scenario_id ?? null).toBe(null);
    expect((out.competencies[0] as any).intended_target ?? null).toBe(null);
  });
  it('leaves a fresh competency without a matching prev target unchanged', () => {
    const prev = mk({ adopted_from_scenario_id: 's1', competencies: [comp('A', { intended_target: { k: null, u: null, d: 4 } }) as never] });
    const next = mk({ competencies: [comp('A') as never, comp('B (new)') as never] });
    const out = preserveAdoptOverlay(prev, next);
    expect((out.competencies[0] as any).intended_target?.d).toBe(4);
    expect((out.competencies[1] as any).intended_target ?? null).toBe(null);
  });
});
