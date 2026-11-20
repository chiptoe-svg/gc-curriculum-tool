import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({ ensure: vi.fn(async () => 'added') }));
vi.mock('@/lib/db/client', () => ({
  db: { insert: () => ({ values: () => ({ onConflictDoUpdate: () => Promise.resolve() }) }) },
}));
vi.mock('@/lib/program/scoring-links', () => ({ ensureScoringLink: h.ensure }));

import { upsertCoverageCell } from '@/lib/db/program-coverage-queries';

describe('upsertCoverageCell auto-link (spec 2026-11-20)', () => {
  it('adds a scoring link for the cell, with level = max(K, U, D)', async () => {
    await upsertCoverageCell({
      snapshotId: 's1', subCompetencyId: 'c1', kDepth: 1, uDepth: null, dDepth: 3,
      matchedCompetency: 'Students pitch work.', evidenceExcerpt: null, confidence: 'high', rationale: 'r', model: 'm',
    } as never);
    expect(h.ensure).toHaveBeenCalledWith(expect.anything(), { snapshotId: 's1', competencyId: 'c1', matchedCompetency: 'Students pitch work.', level: 3 });
  });
});
