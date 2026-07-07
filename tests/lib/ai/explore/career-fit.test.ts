import { describe, it, expect } from 'vitest';
import { computeCareerFit } from '@/lib/ai/explore/career-fit';
import type { MatrixData } from '@/lib/db/program-coverage-queries';

const matrix = {
  courses: [], targets: [{ id: 't1', name: 'Prepress Technician', displayOrder: 0 }],
  subCompetencies: [{ id: 'sc-trap', name: 'Trapping', careerTargetId: 't1', careerTargetName: 'Prepress Technician', displayOrder: 0 }],
  cells: [{ snapshotId: 'snap1', careerTargetId: 't1', subCompetencyId: 'sc-trap', kDepth: null, uDepth: null, dDepth: 3, matchedCompetency: null, evidenceExcerpt: null, confidence: 'medium', rationale: '', model: 'x' }],
} as unknown as MatrixData;

describe('computeCareerFit', () => {
  it('emits a career_fit line when the predicted D band improves', () => {
    const out = computeCareerFit({ focalSnapshotId: 'snap1', predictedSubCompDepths: [{ subCompetencyId: 'sc-trap', k: null, u: null, d: 4 }], matrix });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'career_fit', subCompetencyId: 'sc-trap', label: 'Prepress Technician · Trapping', before: 'working (3)', after: 'high (4–5)' });
  });
  it('no line when the band is unchanged', () => {
    const out = computeCareerFit({ focalSnapshotId: 'snap1', predictedSubCompDepths: [{ subCompetencyId: 'sc-trap', k: null, u: null, d: 3 }], matrix });
    expect(out).toHaveLength(0);
  });
  it('ignores cells from other snapshots and unpredicted sub-comps', () => {
    expect(computeCareerFit({ focalSnapshotId: 'OTHER', predictedSubCompDepths: [{ subCompetencyId: 'sc-trap', k: null, u: null, d: 5 }], matrix })).toHaveLength(0);
    expect(computeCareerFit({ focalSnapshotId: 'snap1', predictedSubCompDepths: [], matrix })).toHaveLength(0);
  });
});
