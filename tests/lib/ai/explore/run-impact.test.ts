import { describe, it, expect } from 'vitest';
import { assembleScenario } from '@/lib/ai/explore/run-impact';

it('stamps downstream courseCode by running ripple per downstream course', () => {
  const scenario = assembleScenario({
    id: 's1', courseCode: 'GC 3460', baselineSnapshotId: 'snap1', createdAt: '2026-07-07T00:00:00.000Z',
    aiResult: {
      change: { prose: 'add trapping lab', activity: 'lab', artifact: 'graded', competencies: ['prepress'], rubricCriteria: [], assumesIncoming: [] },
      predictedDeltas: [{ competency: 'prepress', from: { k: null, u: null, d: 3 }, to: { k: null, u: null, d: 4 }, confidence: 'medium', rationale: 'r' }],
    },
    predictedSubCompDepths: [{ subCompetencyId: 'sc-trap', k: null, u: null, d: 4 }],
    baselineDelivered: [{ prereqCourseCode: 'GC 3460', subCompetencyId: 'sc-trap', k: null, u: null, d: 3, basis: 'measured' }],
    downstreamByCourse: { 'GC 4440': [{ prereqCourseCode: 'GC 3460', subCompetencyId: 'sc-trap', expectedK: null, expectedU: null, expectedD: 4 }] },
    subCompLabel: (id) => (id === 'sc-trap' ? 'trapping' : id),
  });
  const down = scenario.computedRipple.filter(r => r.kind === 'downstream_gap');
  expect(down).toHaveLength(1);
  expect(down[0]).toMatchObject({ courseCode: 'GC 4440', label: 'trapping', before: 'gap', after: 'met' });
});
