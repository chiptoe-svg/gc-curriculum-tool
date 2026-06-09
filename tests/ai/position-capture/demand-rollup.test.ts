import { describe, it, expect, vi, beforeEach } from 'vitest';

const listSubmittedPositionsForTarget = vi.fn();
const listPartners = vi.fn();
const upsertTargetDemand = vi.fn();

vi.mock('@/lib/db/position-capture-queries', () => ({
  listSubmittedPositionsForTarget: (...a: unknown[]) => listSubmittedPositionsForTarget(...a),
}));
vi.mock('@/lib/partners/queries', () => ({
  listPartners: (...a: unknown[]) => listPartners(...a),
}));
vi.mock('@/lib/db/career-target-demand-queries', () => ({
  upsertTargetDemand: (...a: unknown[]) => upsertTargetDemand(...a),
}));

import { regenerateTargetDemand } from '@/lib/ai/position-capture/demand-rollup';

function position(id: string, partnerId: string, competencies: Array<{ sub: string | null; k: number | null; u: number | null; d: number | null }>) {
  return {
    id,
    partnerId,
    completeness: 'interviewed',
    profile: {
      qualifying_competencies: competencies.map(c => ({
        name: 'c',
        description: '',
        sub_competency_id: c.sub,
        required_for_success: { k_depth: c.k, u_depth: c.u, d_depth: c.d, rationale: '', evidenced_by: [], confidence: 'high' },
        notes: null,
      })),
    },
  };
}

describe('regenerateTargetDemand', () => {
  beforeEach(() => {
    listSubmittedPositionsForTarget.mockReset();
    listPartners.mockReset();
    upsertTargetDemand.mockReset();
  });

  it('partner-weights demand per sub-competency, excludes unmapped, tracks contributing positions', async () => {
    listPartners.mockResolvedValue([
      { id: 'p1', weight: 1 },
      { id: 'p2', weight: 3 },
    ]);
    listSubmittedPositionsForTarget.mockResolvedValue([
      position('pos1', 'p1', [{ sub: 'X', k: null, u: null, d: 2 }, { sub: null, k: 5, u: 5, d: 5 }]), // unmapped ignored
      position('pos2', 'p2', [{ sub: 'X', k: null, u: null, d: 5 }]),
    ]);

    const result = await regenerateTargetDemand('target-1');

    expect(result.subCompetencies).toBe(1);
    expect(upsertTargetDemand).toHaveBeenCalledTimes(1);
    const [targetId, rows] = upsertTargetDemand.mock.calls[0]!;
    expect(targetId).toBe('target-1');
    expect(rows).toHaveLength(1);
    const x = rows[0];
    expect(x.subCompetencyId).toBe('X');
    expect(x.d).toBeCloseTo((1 * 2 + 3 * 5) / 4, 5); // 4.25 — weighted by partner weight
    expect(x.k).toBeNull();
    expect(new Set(x.contributingPositionIds)).toEqual(new Set(['pos1', 'pos2']));
  });

  it('skips non-interviewed positions and writes an empty set when nothing maps', async () => {
    listPartners.mockResolvedValue([{ id: 'p1', weight: 1 }]);
    listSubmittedPositionsForTarget.mockResolvedValue([
      { id: 'pos1', partnerId: 'p1', completeness: 'rated', profile: null },
    ]);
    const result = await regenerateTargetDemand('target-2');
    expect(result.subCompetencies).toBe(0);
    expect(upsertTargetDemand).toHaveBeenCalledWith('target-2', []);
  });
});
