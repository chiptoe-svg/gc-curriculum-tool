import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/career-target-demand-queries', () => ({
  getTargetDemand: async () => [
    { careerTargetId: 't5', subCompetencyId: 'kept', kDemand: 2, uDemand: 2, dDemand: 2, contributingPositionIds: [], generatedAt: new Date(0) },
    { careerTargetId: 't5', subCompetencyId: 'prompt-design', kDemand: 3, uDemand: 3, dDemand: 3, contributingPositionIds: [], generatedAt: new Date(0) },
  ],
}));
// getMatrixData already returns only non-retired sub-competencies (and their cells).
vi.mock('@/lib/db/program-coverage-queries', () => ({
  getMatrixData: async () => ({
    courses: [],
    targets: [{ id: 't5', name: 'T5', displayOrder: 4 }],
    subCompetencies: [{ id: 'kept', name: 'Kept', careerTargetId: 't5', careerTargetName: 'T5', displayOrder: 0 }],
    cells: [],
  }),
}));

import { getTargetSufficiency } from '@/lib/program/sufficiency-read';

describe('getTargetSufficiency — retired sub-competencies (2026-10-06 target batch)', () => {
  it('drops stored demand for a sub-competency that is no longer part of the target', async () => {
    const rows = await getTargetSufficiency('t5');
    expect(rows.map(r => r.subCompetencyId)).toEqual(['kept']);
    expect(rows[0]!.subCompetencyName).toBe('Kept');
  });
});
