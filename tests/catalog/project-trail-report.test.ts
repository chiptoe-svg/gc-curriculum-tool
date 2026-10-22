import { describe, it, expect, vi } from 'vitest';
vi.mock('@/lib/db/client', () => ({ db: {} }));
vi.mock('@/scripts/catalog/catalog-source', async (orig) => ({
  ...(await orig<typeof import('@/scripts/catalog/catalog-source')>()),
  assertExpectedDb: vi.fn(async (name: string) => { if (name !== 'scratch') throw new Error('wrong database'); }),
}));
import { main, formatReport } from '@/scripts/catalog/project-trail-report';

const pairs = [
  { courseCode: 'GC 1010', statement: 'Color proofing', competencyId: 'color-management', items: [{ label: 'Evaluate color', source: 'onet_task' as const, provisional: false, similarity: 0.8 }] },
  { courseCode: 'GC 2400', statement: 'Web layout', competencyId: 'cross-medium-production', items: [] },
];

describe('project-trail-report CLI', () => {
  it('requires --expect-db (exit 2) and refuses the wrong database (exit 1)', async () => {
    expect(await main([])).toBe(2);
    expect(await main(['--expect-db', 'live'])).toBe(1);
  });

  it('prints each sampled pair with its nearest items and a top-1 histogram', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { logs.push(a.join(' ')); });
    expect(await main(['--expect-db', 'scratch'], { load: async () => pairs })).toBe(0);
    spy.mockRestore();
    const text = logs.join('\n');
    expect(text).toContain('GC 1010 · Color proofing → color-management');
    expect(text).toContain('0.80  Evaluate color');
    expect(text).toContain('no embedded items');
    expect(formatReport(pairs, 40)).toMatch(/0\.80–0\.85: 1/);
  });
});
