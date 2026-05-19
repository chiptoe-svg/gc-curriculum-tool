import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbSelect, countSubmittedForTarget } = vi.hoisted(() => ({
  dbSelect: vi.fn(),
  countSubmittedForTarget: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  db: { select: dbSelect },
}));
vi.mock('@/lib/db/schema', () => ({ synthesisRuns: {} }));

vi.mock('@/lib/ai/synthesis/queries', () => ({ countSubmittedForTarget }));

import { stalenessCheck } from '@/lib/ai/synthesis/staleness';

beforeEach(() => {
  dbSelect.mockReset();
  countSubmittedForTarget.mockReset();
  delete process.env.SYNTHESIS_STALENESS_THRESHOLD;
});

function mockLatestRun(row: { submissionCount: number; createdAt: Date } | null) {
  dbSelect.mockReturnValue({
    from: () => ({
      where: () => ({
        orderBy: () => ({
          limit: () => Promise.resolve(row ? [row] : []),
        }),
      }),
    }),
  });
}

describe('stalenessCheck', () => {
  it('returns stale=true with reason "no_run" when no run exists', async () => {
    mockLatestRun(null);
    countSubmittedForTarget.mockResolvedValue(3);
    const out = await stalenessCheck('production-operations');
    expect(out).toMatchObject({ stale: true, reason: 'no_run' });
  });

  it('returns stale=false when run is recent and within submission threshold', async () => {
    mockLatestRun({ submissionCount: 10, createdAt: new Date() });
    countSubmittedForTarget.mockResolvedValue(12);
    const out = await stalenessCheck('production-operations');
    expect(out.stale).toBe(false);
  });

  it('returns stale=true with reason "new_submissions" when delta meets threshold', async () => {
    mockLatestRun({ submissionCount: 10, createdAt: new Date() });
    countSubmittedForTarget.mockResolvedValue(15);
    const out = await stalenessCheck('production-operations');
    expect(out).toMatchObject({ stale: true, reason: 'new_submissions' });
  });

  it('honors a custom threshold from env', async () => {
    process.env.SYNTHESIS_STALENESS_THRESHOLD = '2';
    mockLatestRun({ submissionCount: 10, createdAt: new Date() });
    countSubmittedForTarget.mockResolvedValue(12);
    const out = await stalenessCheck('production-operations');
    expect(out).toMatchObject({ stale: true, reason: 'new_submissions' });
  });

  it('returns stale=true with reason "age" when run is older than 30 days', async () => {
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    mockLatestRun({ submissionCount: 10, createdAt: old });
    countSubmittedForTarget.mockResolvedValue(10);
    const out = await stalenessCheck('production-operations');
    expect(out).toMatchObject({ stale: true, reason: 'age' });
  });
});
