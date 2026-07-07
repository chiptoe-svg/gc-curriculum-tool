import { describe, it, expect } from 'vitest';
import { scenarioSchema, type Scenario } from '@/lib/ai/explore/scenario';

const sample: Scenario = {
  id: 's1', courseCode: 'GC 3460', baselineSnapshotId: 'snap1',
  change: {
    prose: 'add a 3-week trapping lab graded on registration accuracy',
    activity: 'trapping lab (3 wk)', artifact: 'graded',
    competencies: ['prepress preparation'], rubricCriteria: ['registration accuracy'],
    assumesIncoming: [{ label: 'color models', subCompetencyId: null, k: 3, u: null, d: null }],
  },
  predictedDeltas: [{
    competency: 'prepress preparation',
    from: { k: 2, u: 2, d: 3 }, to: { k: 3, u: 2, d: 4 },
    confidence: 'medium', rationale: 'graded artifact with enforced rubric evidences D4',
  }],
  computedRipple: [{ kind: 'downstream_gap', courseCode: 'GC 4440', subCompetencyId: 'sc-trap', label: 'trapping', before: 'gap', after: 'met' }],
  agentNotes: null, caption: null, createdAt: '2026-07-07T00:00:00.000Z',
};

describe('scenarioSchema', () => {
  it('accepts a well-formed scenario', () => {
    expect(scenarioSchema.safeParse(sample).success).toBe(true);
  });
  it('rejects an unknown artifact kind', () => {
    const bad = { ...sample, change: { ...sample.change, artifact: 'sometimes' } };
    expect(scenarioSchema.safeParse(bad).success).toBe(false);
  });
  it('rejects a ripple line with an unknown kind', () => {
    const bad = { ...sample, computedRipple: [{ ...sample.computedRipple[0], kind: 'sideways' }] };
    expect(scenarioSchema.safeParse(bad).success).toBe(false);
  });
});
