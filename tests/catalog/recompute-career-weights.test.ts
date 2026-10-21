import { describe, it, expect, vi } from 'vitest';
vi.mock('@/lib/db/client', () => ({ db: { transaction: (fn: (tx: unknown) => unknown) => fn('TX') } }));
vi.mock('@/scripts/catalog/catalog-source', async (orig) => ({
  ...(await orig<typeof import('@/scripts/catalog/catalog-source')>()),
  assertExpectedDb: vi.fn(async (name: string) => { if (name !== 'scratch') throw new Error('wrong database'); }),
}));
import { main, formatReport } from '@/scripts/catalog/recompute-career-weights';
import type { RecomputeReport } from '@/lib/db/career-weight-queries';

const report: RecomputeReport = {
  onetUpserted: 3, onetDeleted: 1, employerUpserted: 0, employerDeleted: 0, pairs: 3,
  byTarget: [{ targetId: 't1', horizon: 'entry', members: 3, withOnet: 2, onetMin: 0.4, onetMedian: 0.5, onetMax: 0.9 }],
  nonMemberCandidates: [{ targetId: 't1', horizon: 'entry', competencyId: 'c9', onet: 0.8 }],
};

describe('recompute-career-weights CLI', () => {
  it('requires --expect-db (exit 2) and refuses the wrong database (exit 1)', async () => {
    expect(await main([])).toBe(2);
    expect(await main(['--expect-db', 'live'])).toBe(1);
  });

  it('dry run by default: calls recompute with apply false', async () => {
    const recompute = vi.fn(async () => report);
    expect(await main(['--expect-db', 'scratch'], { recompute })).toBe(0);
    expect(recompute).toHaveBeenCalledWith('TX', { apply: false });
  });

  it('--apply writes', async () => {
    const recompute = vi.fn(async () => report);
    expect(await main(['--expect-db', 'scratch', '--apply'], { recompute })).toBe(0);
    expect(recompute).toHaveBeenCalledWith('TX', { apply: true });
  });

  it('the report lists per-target spread, members without an O*NET weight, and non-member candidates', () => {
    const text = formatReport(report);
    expect(text).toMatch(/t1 entry: 3 members, 2 with an O\*NET weight, min 0\.40 median 0\.50 max 0\.90/);
    expect(text).toMatch(/not members.*c9 \(t1 entry, 0\.80\)/s);
  });
});
