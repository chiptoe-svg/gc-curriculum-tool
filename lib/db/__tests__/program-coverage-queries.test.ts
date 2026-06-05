import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbDeleteWhere = vi.fn();

vi.mock('@/lib/db/client', () => ({
  db: {
    delete: () => ({ where: () => ({ returning: dbDeleteWhere }) }),
    select: () => ({ from: () => ({ where: () => [] }) }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: () => Promise.resolve() }) }),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

vi.mock('@/lib/db/schema', () => ({
  snapshotTargetCoverage: {
    careerTargetId: 'career_target_id',
    subCompetencyId: 'sub_competency_id',
    snapshotId: 'snapshot_id',
  },
  courseCaptureSnapshots: {},
  careerTargets: { id: 'id', name: 'name', displayOrder: 'display_order' },
  subCompetencies: {
    id: 'id',
    name: 'name',
    careerTargetId: 'career_target_id',
    displayOrder: 'display_order',
    retired: 'retired',
  },
}));

import { invalidateCoverageForSubCompetency } from '@/lib/db/program-coverage-queries';

beforeEach(() => vi.clearAllMocks());

describe('invalidateCoverageForSubCompetency', () => {
  it('deletes rows for the given (careerTargetId, subCompetencyId) and returns count', async () => {
    dbDeleteWhere.mockResolvedValue([{ snapshotId: 'snap-1' }, { snapshotId: 'snap-2' }]);
    const count = await invalidateCoverageForSubCompetency('target-abc', 'sc-xyz');
    expect(dbDeleteWhere).toHaveBeenCalledTimes(1);
    expect(count).toBe(2);
  });

  it('returns 0 when no cells exist for the pair', async () => {
    dbDeleteWhere.mockResolvedValue([]);
    const count = await invalidateCoverageForSubCompetency('target-abc', 'sc-xyz');
    expect(count).toBe(0);
  });
});
