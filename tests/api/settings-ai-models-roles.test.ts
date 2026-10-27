// @vitest-environment node
/** PUT /api/settings/ai-models accepts roles and 'custom', and rejects the old tier names. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { upsert } = vi.hoisted(() => ({ upsert: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/db/client', () => ({ db: {} }));
vi.mock('@/lib/slug', () => ({ isValidSlug: () => true }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit: async () => ({ allowed: true }) }));
vi.mock('@/lib/ip-hash', () => ({ hashIp: () => 'h' }));
vi.mock('@/lib/ai/function-settings', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai/function-settings')>()),
  upsertFunctionSetting: upsert,
}));

import { PUT } from '@/app/api/settings/ai-models/route';

const put = (body: object) => PUT(new Request('http://x/api/settings/ai-models?slug=s', {
  method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}));

describe('PUT /api/settings/ai-models', () => {
  beforeEach(() => upsert.mockClear());

  it('rejects an old tier name', async () => {
    const res = await put({ functionId: 'wiki-update', tier: 'default' });
    expect(res.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('saves a role', async () => {
    const res = await put({ functionId: 'wiki-update', tier: 'judge' });
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith({ functionId: 'wiki-update', tier: 'judge', customModel: null });
  });
});
