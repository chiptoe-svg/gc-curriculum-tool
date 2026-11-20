import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ override: null as 'on' | 'off' | null, set: vi.fn() }));

vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'good' }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit: async () => ({ allowed: true }) }));
vi.mock('@/lib/ip-hash', () => ({ hashIp: () => 'h' }));
vi.mock('@/lib/settings/app-settings', () => ({
  getRerankOverride: async () => m.override,
  setRerankOverride: async (v: 'on' | 'off' | null) => { m.set(v); m.override = v; },
  rerankEnabledNow: async () => (m.override === null ? true : m.override === 'on'),
}));

import { GET, PUT } from '@/app/api/settings/search/route';
import { classify } from '@/lib/auth/authorize';

const req = (method: string, slug: string, body?: unknown) =>
  new Request(`http://x/api/settings/search?slug=${slug}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });

describe('/api/settings/search', () => {
  beforeEach(() => { m.override = null; m.set.mockClear(); });

  it('GET reports the override, the effective state and the models', async () => {
    const res = await GET(req('GET', 'good'));
    expect(await res.json()).toEqual({
      rerank: { override: null, effective: true, model: 'qwen3-rerank-4b' },
      embedding: { model: 'qwen3-embedding-4b' },
    });
  });

  it('PUT sets on, off or back to default', async () => {
    for (const v of ['off', 'on', null] as const) {
      const res = await PUT(req('PUT', 'good', { rerank: v }));
      expect(res.status).toBe(200);
      expect(m.set).toHaveBeenLastCalledWith(v);
    }
  });

  it('PUT rejects anything else, and a bad slug', async () => {
    expect((await PUT(req('PUT', 'good', { rerank: 'maybe' }))).status).toBe(400);
    expect((await PUT(req('PUT', 'good', {}))).status).toBe(400);
    expect((await PUT(req('PUT', 'bad', { rerank: 'on' }))).status).toBe(401);
    expect(m.set).not.toHaveBeenCalled();
  });

  it('writes are admin-only', () => {
    expect(classify('PUT', '/api/settings/search')).toEqual({ kind: 'admin' });
  });
});
