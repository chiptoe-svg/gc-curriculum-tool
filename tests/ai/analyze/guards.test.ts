import { describe, it, expect, vi, beforeEach } from 'vitest';

const { checkIpRateLimit, checkDailyCap } = vi.hoisted(() => ({
  checkIpRateLimit: vi.fn(),
  checkDailyCap: vi.fn(),
}));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit }));
vi.mock('@/lib/rate-limit/daily-cap', () => ({ checkDailyCap }));

import { applyAnalyzeGuards } from '@/lib/ai/analyze/guards';

beforeEach(() => {
  vi.clearAllMocks();
});

function req(headers: Record<string, string> = {}) {
  return new Request('http://test/analyze', { headers });
}

describe('applyAnalyzeGuards', () => {
  it('returns null + ipHash when allowed', async () => {
    checkIpRateLimit.mockResolvedValue({ allowed: true, remaining: 9 });
    checkDailyCap.mockResolvedValue({ ok: true, spentCents: 0 });
    const out = await applyAnalyzeGuards(req({ 'x-forwarded-for': '1.2.3.4' }));
    expect(out.short).toBe(null);
    expect(typeof out.ipHash).toBe('string');
    expect(out.ipHash.length).toBeGreaterThan(0);
  });
  it('returns a 429 NextResponse when rate-limited', async () => {
    checkIpRateLimit.mockResolvedValue({ allowed: false, remaining: 0 });
    checkDailyCap.mockResolvedValue({ ok: true, spentCents: 0 });
    const out = await applyAnalyzeGuards(req());
    expect(out.short?.status).toBe(429);
  });
  it('returns a 503 NextResponse when daily cap exhausted', async () => {
    checkIpRateLimit.mockResolvedValue({ allowed: true, remaining: 5 });
    checkDailyCap.mockResolvedValue({ ok: false, spentCents: 99999 });
    const out = await applyAnalyzeGuards(req());
    expect(out.short?.status).toBe(503);
  });
});
