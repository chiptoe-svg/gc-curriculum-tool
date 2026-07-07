import { describe, it, expect } from 'vitest';
import { compareScenarios } from '@/lib/ai/explore/compare';
import type { Scenario } from '@/lib/ai/explore/scenario';

const base = (over: Partial<Scenario>): Scenario => ({
  id: 'x', courseCode: 'GC 3460', baselineSnapshotId: 'snap1',
  change: { prose: 'p', activity: 'a', artifact: 'graded', competencies: ['prepress'], rubricCriteria: [], assumesIncoming: [] },
  predictedDeltas: [{ competency: 'prepress', from: { k: 2, u: 2, d: 3 }, to: { k: 2, u: 2, d: 4 }, confidence: 'medium', rationale: 'r' }],
  computedRipple: [{ kind: 'downstream_gap', courseCode: 'GC 4440', subCompetencyId: 'sc', label: 'trapping', before: 'gap', after: 'met' }],
  createdAt: '2026-07-07T00:00:00.000Z',
  ...over,
});

describe('compareScenarios', () => {
  it('reports deltas that differ between two scenarios', () => {
    const a = base({ id: 'a' });
    const b = base({ id: 'b', predictedDeltas: [{ competency: 'prepress', from: { k: 2, u: 2, d: 3 }, to: { k: 2, u: 2, d: 5 }, confidence: 'low', rationale: 'r2' }] });
    const diff = compareScenarios(a, b);
    expect(diff.deltaChanges).toHaveLength(1);
    expect(diff.deltaChanges[0]).toMatchObject({ competency: 'prepress', aTo: { d: 4 }, bTo: { d: 5 } });
  });
  it('reports ripple lines present in one but not the other', () => {
    const a = base({ id: 'a' });
    const b = base({ id: 'b', computedRipple: [] });
    const diff = compareScenarios(a, b);
    expect(diff.rippleOnlyInA.map(r => r.label)).toEqual(['trapping']);
    expect(diff.rippleOnlyInB).toHaveLength(0);
  });
});
