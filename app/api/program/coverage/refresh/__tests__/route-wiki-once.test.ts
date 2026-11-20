import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({
  results: [
    { snapshotId: 's1', courseCode: 'GC 1010', status: 'ok', cellCount: 1, competencyIds: ['c-new'] },
    { snapshotId: 's2', courseCode: 'GC 4800', status: 'ok', cellCount: 1, competencyIds: ['c-new'] },
  ],
  after: vi.fn(),
  perSnapshot: vi.fn(),
}));
vi.mock('@/lib/slug', () => ({ isValidSlug: () => true }));
vi.mock('@/lib/ip-hash', () => ({ hashIp: () => 'h' }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit: async () => ({ allowed: true }) }));
vi.mock('@/lib/program/score-stale', () => ({ scoreStaleSnapshots: async () => ({ results: h.results, stoppedAtCap: false }) }));
vi.mock('@/lib/program/refresh-after-scoring', () => ({ refreshWikiAfterScoringInBackground: h.after }));
vi.mock('@/lib/ai/wiki/update', () => ({ regenerateWikiInBackground: h.perSnapshot }));

import { POST } from '../route';

describe('POST /api/program/coverage/refresh — wiki rebuild (owner, 2026-11-19)', () => {
  it('rebuilds the wiki once for everything scored, not once per snapshot', async () => {
    const res = await POST(new Request('http://x/api/program/coverage/refresh?slug=ok', { method: 'POST' }));
    expect(res.status).toBe(200);
    expect(h.after).toHaveBeenCalledTimes(1);
    expect(h.after).toHaveBeenCalledWith(h.results);
    expect(h.perSnapshot).not.toHaveBeenCalled();
  });
});
