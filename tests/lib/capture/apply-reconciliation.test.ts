import { describe, it, expect } from 'vitest';
import { applyReconciliation } from '@/lib/capture/apply-reconciliation';
import { captureCompetencySchema, incomingExpectationSchema, type CaptureProfile } from '@/lib/ai/capture/schema';

const baseProfile = (over: Partial<CaptureProfile>): CaptureProfile => ({
  course_code: 'GC 9999', scale_version: 'v1' as CaptureProfile['scale_version'], generated_at: 'now',
  competencies: [], incoming_expectations: [],
  verification_summary: { course_shape: 'x', strongest_evidence: ['e'], dimensional_patterns: [], catalog_vs_evidence: [], foundationals_glance: 'ok' } as CaptureProfile['verification_summary'],
  audit_notes: { prereq_gaps: [], objective_misalignments: [], cross_source_conflicts: [], suggested_objective_revisions: [] } as CaptureProfile['audit_notes'], revised_objectives_draft: null, course_emphasis: null,
  ...over,
}) as CaptureProfile;

const comp = (over: Record<string, unknown>) => ({
  statement: 'Color mgmt', type: 'technical', k_depth: 3, u_depth: 3, d_depth: 4,
  evidence_k: 'k ev', evidence_u: 'u ev', evidence_d: 'd ev', rationale: 'r',
  source: 'materials', citations: [{ type: 'chunk', chunkId: 'c1', messageId: null, excerpt: 'ex' }], ...over,
});

describe('applyReconciliation — outgoing (competencies), schema-valid output', () => {
  const profile = baseProfile({ competencies: [
    comp({}),
    comp({ statement: 'Curiosity', type: 'foundational', k_depth: null, u_depth: null, d_depth: 3, evidence_k: null, evidence_u: null, source: 'inferred', citations: [] }),
  ] as unknown as CaptureProfile['competencies'] });

  it('modify flips source→instructor, clears citations, sets faculty evidence for the changed depth, and STILL parses', () => {
    const out = applyReconciliation(profile, 'outgoing', [{ index: 0, action: 'modify', revised: { statement: null, k: null, u: null, d: 2 }, rationale: 'x' }]);
    const c = out.competencies[0]!;
    expect(c.d_depth).toBe(2);
    expect(c.source).toBe('instructor');
    expect(c.citations ?? []).toEqual([]);
    expect(c.evidence_d && c.evidence_d.length > 0).toBe(true); // refine: d_depth>0 needs evidence_d
    expect(() => captureCompetencySchema.parse(c)).not.toThrow();
  });
  it('does not set K/U on a foundational competency', () => {
    const out = applyReconciliation(profile, 'outgoing', [{ index: 1, action: 'modify', revised: { statement: null, k: 4, u: 4, d: 5 }, rationale: 'x' }]);
    const c = out.competencies[1]!;
    expect(c.k_depth).toBeNull(); expect(c.u_depth).toBeNull(); expect(c.d_depth).toBe(5);
    expect(() => captureCompetencySchema.parse(c)).not.toThrow();
  });
  it('add appends a schema-valid instructor-sourced competency (evidence + rationale present, depth clamped)', () => {
    const out = applyReconciliation(profile, 'outgoing', [{ index: null, action: 'add', revised: { statement: 'New skill', k: null, u: null, d: 9 }, rationale: 'x' }]);
    const added = out.competencies.find(c => c.statement === 'New skill')!;
    expect(added.source).toBe('instructor');
    expect(added.d_depth).toBe(5); // 9 clamped
    expect(added.rationale.length).toBeGreaterThan(0);
    expect(() => captureCompetencySchema.parse(added)).not.toThrow();
  });
  it('remove drops the item', () => {
    const out = applyReconciliation(profile, 'outgoing', [{ index: 0, action: 'remove', revised: null, rationale: 'x' }]);
    expect(out.competencies.find(c => c.statement === 'Color mgmt')).toBeUndefined();
  });
});

describe('applyReconciliation — incoming + apparent outcomes', () => {
  it('incoming modify → instructor source, evidenced_by kept non-empty, parses', () => {
    const p = baseProfile({ incoming_expectations: [{ statement: 'Spot color', expected_depth: { k: 1, u: null, d: 2 }, evidenced_by: ['old'], confidence: 'low', source: 'materials' }] as unknown as CaptureProfile['incoming_expectations'] });
    const out = applyReconciliation(p, 'incoming', [{ index: 0, action: 'modify', revised: { statement: 'Spot color matching', k: null, u: null, d: 3 }, rationale: 'x' }]);
    const e = out.incoming_expectations[0]!;
    expect(e.statement).toBe('Spot color matching'); expect(e.expected_depth.d).toBe(3); expect(e.source).toBe('instructor');
    expect(e.evidenced_by.length).toBeGreaterThan(0);
    expect(() => incomingExpectationSchema.parse(e)).not.toThrow();
  });
  it('incoming add parses (evidenced_by + confidence present)', () => {
    const p = baseProfile({ incoming_expectations: [] });
    const out = applyReconciliation(p, 'incoming', [{ index: null, action: 'add', revised: { statement: 'New incoming', k: null, u: null, d: 2 }, rationale: 'x' }]);
    expect(() => incomingExpectationSchema.parse(out.incoming_expectations[0])).not.toThrow();
  });
  it('apparent outcomes are plain-string edits', () => {
    const p = baseProfile({ revised_objectives_draft: ['Old A', 'Old B'] });
    const out = applyReconciliation(p, 'apparent_outcomes', [
      { index: 0, action: 'modify', revised: { statement: 'New A', k: null, u: null, d: null }, rationale: 'x' },
      { index: 1, action: 'remove', revised: null, rationale: 'x' },
      { index: null, action: 'add', revised: { statement: 'Added C', k: null, u: null, d: null }, rationale: 'x' },
    ]);
    expect(out.revised_objectives_draft).toEqual(['New A', 'Added C']);
  });
  it('keep / bad index leave items untouched', () => {
    const p = baseProfile({ revised_objectives_draft: ['Only'] });
    const out = applyReconciliation(p, 'apparent_outcomes', [{ index: 0, action: 'keep', revised: null, rationale: 'x' }, { index: 7, action: 'modify', revised: { statement: 'ghost', k: null, u: null, d: null }, rationale: 'x' }]);
    expect(out.revised_objectives_draft).toEqual(['Only']);
  });
});

describe('applyReconciliation — input immutability', () => {
  it('does not mutate the original profile (modify + remove + add)', () => {
    const input = baseProfile({
      competencies: [
        comp({}),
        comp({ statement: 'Second skill' }),
      ] as unknown as CaptureProfile['competencies'],
      revised_objectives_draft: ['Objective A', 'Objective B'],
    });
    const clone = structuredClone(input);
    // modify first comp, remove second, add a new one
    applyReconciliation(input, 'outgoing', [
      { index: 0, action: 'modify', revised: { statement: 'Changed', k: 1, u: 1, d: 1 }, rationale: 'x' },
      { index: 1, action: 'remove', revised: null, rationale: 'x' },
      { index: null, action: 'add', revised: { statement: 'Brand new', k: null, u: null, d: 2 }, rationale: 'x' },
    ]);
    expect(input).toEqual(clone);
  });
});

describe('clampDepth NaN safety', () => {
  it('add proposal with NaN d produces schema-valid competency (d_depth is 0, not NaN)', () => {
    const p = baseProfile({ competencies: [] });
    const out = applyReconciliation(p, 'outgoing', [{
      index: null,
      action: 'add',
      revised: { statement: 'NaN depth skill', k: null, u: null, d: NaN as unknown as number },
      rationale: 'x',
    }]);
    const added = out.competencies.at(-1)!;
    expect(Number.isNaN(added.d_depth)).toBe(false);
    expect(() => captureCompetencySchema.parse(added)).not.toThrow();
  });
});
