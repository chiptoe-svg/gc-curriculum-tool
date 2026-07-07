import { describe, it, expect } from 'vitest';
import { computeRipple } from '@/lib/ai/explore/ripple';
import type { DeliveredAttainment, RelyEdge } from '@/lib/program/prereq-gaps';
import type { PredictedDelta, IncomingDemand } from '@/lib/ai/explore/scenario';

describe('computeRipple — downstream gap flips', () => {
  it('flags a downstream gap that closes when the focal course delivers more', () => {
    const edges: RelyEdge[] = [{ prereqCourseCode: 'GC 3460', subCompetencyId: 'sc-trap', expectedK: null, expectedU: null, expectedD: 4 }];
    const baseline: DeliveredAttainment[] = [{ prereqCourseCode: 'GC 3460', subCompetencyId: 'sc-trap', k: null, u: null, d: 3, basis: 'measured' }];
    const ripple = computeRipple({
      focalCourseCode: 'GC 3460',
      downstreamEdges: edges,
      baselineDelivered: baseline,
      predictedSubCompDepths: [{ subCompetencyId: 'sc-trap', k: null, u: null, d: 4 }],
      assumesIncoming: [],
      subCompLabel: (id) => (id === 'sc-trap' ? 'trapping' : id),
    });
    const down = ripple.filter(r => r.kind === 'downstream_gap');
    expect(down).toHaveLength(1);
    // pure & per-course: surfaces the flipped sub-comp; does NOT attach downstream courseCode (Task 6 stamps it).
    expect(down[0]).toMatchObject({ subCompetencyId: 'sc-trap', label: 'trapping', before: 'gap', after: 'met' });
  });

  it('emits an upstream_gap line for each new incoming demand', () => {
    const assumes: IncomingDemand[] = [{ label: 'color models', subCompetencyId: 'sc-color', k: 3, u: null, d: null }];
    const ripple = computeRipple({
      focalCourseCode: 'GC 3460', downstreamEdges: [], baselineDelivered: [],
      predictedSubCompDepths: [], assumesIncoming: assumes, subCompLabel: (id) => id,
    });
    const up = ripple.filter(r => r.kind === 'upstream_gap');
    expect(up).toHaveLength(1);
    expect(up[0]).toMatchObject({ kind: 'upstream_gap', label: 'color models', after: 'new demand K3' });
  });

  it('does not flag a downstream gap that was already met', () => {
    const edges: RelyEdge[] = [{ prereqCourseCode: 'GC 3460', subCompetencyId: 'sc-trap', expectedK: null, expectedU: null, expectedD: 3 }];
    const baseline: DeliveredAttainment[] = [{ prereqCourseCode: 'GC 3460', subCompetencyId: 'sc-trap', k: null, u: null, d: 3, basis: 'measured' }];
    const ripple = computeRipple({
      focalCourseCode: 'GC 3460', downstreamEdges: edges, baselineDelivered: baseline,
      predictedSubCompDepths: [{ subCompetencyId: 'sc-trap', k: null, u: null, d: 4 }],
      assumesIncoming: [], subCompLabel: (id) => id,
    });
    expect(ripple.filter(r => r.kind === 'downstream_gap')).toHaveLength(0);
  });
});
