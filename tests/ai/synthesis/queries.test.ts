import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbExecute, dbSelect } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  dbSelect: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    execute: dbExecute,
    select: dbSelect,
  },
}));
vi.mock('@/lib/db/schema', () => ({
  partnerSubmissions: {},
  partners: {},
}));

import {
  countSubmittedForTarget,
  countUniquePartnersForTarget,
  sumPartnerWeightsForTarget,
  salaryDistributionForTarget,
  nearbyUnmappedLabelsForTarget,
} from '@/lib/ai/synthesis/queries';

beforeEach(() => {
  dbExecute.mockReset();
  dbSelect.mockReset();
});

describe('countSubmittedForTarget', () => {
  it('returns the integer count', async () => {
    dbExecute.mockResolvedValue({ rows: [{ n: 7 }] });
    const n = await countSubmittedForTarget('production-operations');
    expect(n).toBe(7);
  });

  it('returns 0 when no rows', async () => {
    dbExecute.mockResolvedValue({ rows: [] });
    const n = await countSubmittedForTarget('production-operations');
    expect(n).toBe(0);
  });
});

describe('countUniquePartnersForTarget', () => {
  it('returns the distinct partner count', async () => {
    dbExecute.mockResolvedValue({ rows: [{ n: 4 }] });
    const n = await countUniquePartnersForTarget('production-operations');
    expect(n).toBe(4);
  });
});

describe('sumPartnerWeightsForTarget', () => {
  it('sums partners.weight across distinct partners who submitted', async () => {
    dbExecute.mockResolvedValue({ rows: [{ s: 11 }] });
    const s = await sumPartnerWeightsForTarget('production-operations');
    expect(s).toBe(11);
  });

  it('returns 0 when no partners', async () => {
    dbExecute.mockResolvedValue({ rows: [{ s: null }] });
    const s = await sumPartnerWeightsForTarget('production-operations');
    expect(s).toBe(0);
  });
});

describe('salaryDistributionForTarget', () => {
  it('returns p25/p50/p75 + n when salaries are present', async () => {
    dbExecute.mockResolvedValue({
      rows: [{ p25: 48000, p50: 55000, p75: 65000, n: 6 }],
    });
    const d = await salaryDistributionForTarget('production-operations');
    expect(d).toEqual({ p25: 48000, p50: 55000, p75: 65000, n: 6 });
  });

  it('returns n=0 with no percentiles when no salaries reported', async () => {
    dbExecute.mockResolvedValue({ rows: [{ p25: null, p50: null, p75: null, n: 0 }] });
    const d = await salaryDistributionForTarget('production-operations');
    expect(d).toEqual({ n: 0 });
  });
});

describe('nearbyUnmappedLabelsForTarget', () => {
  it('returns up to 20 unmapped labels with their submission counts', async () => {
    dbExecute.mockResolvedValue({
      rows: [
        { label: 'Packaging design lead', count: 3 },
        { label: 'Pre-press supervisor', count: 1 },
      ],
    });
    const labels = await nearbyUnmappedLabelsForTarget('production-operations');
    expect(labels).toHaveLength(2);
    expect(labels[0]).toEqual({ label: 'Packaging design lead', count: 3 });
  });
});
