import { describe, it, expect, vi, beforeEach } from 'vitest';

const { resolvePartner, bumpLastActive, submissionsCount } = vi.hoisted(() => ({
  resolvePartner: vi.fn(),
  bumpLastActive: vi.fn(),
  submissionsCount: vi.fn(),
}));

vi.mock('@/lib/partners/auth', () => ({ resolvePartner }));

vi.mock('@/lib/partners/queries', () => ({
  bumpLastActive,
}));

vi.mock('@/lib/partners/stats', () => ({ getPartnerStats: submissionsCount }));

import { GET } from '@/app/api/partners/me/route';

beforeEach(() => {
  resolvePartner.mockReset();
  submissionsCount.mockReset();
});

function req(token: string | null) {
  const url = token
    ? `http://test/api/partners/me?token=${token}`
    : 'http://test/api/partners/me';
  return new Request(url);
}

describe('GET /api/partners/me', () => {
  it('401s with no auth', async () => {
    resolvePartner.mockResolvedValue(null);
    const res = await GET(req(null));
    expect(res.status).toBe(401);
  });

  it('returns partner profile + stats', async () => {
    resolvePartner.mockResolvedValue({
      id: 'p1', email: 'a@acme.test', firstName: 'A', lastName: 'One', company: 'Acme', active: true,
    });
    submissionsCount.mockResolvedValue({ drafts: 1, submitted: 2, ratingsCount: 0 });
    const res = await GET(req('TOK'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.partner).toMatchObject({ firstName: 'A', company: 'Acme' });
    expect(json.stats).toEqual({ drafts: 1, submitted: 2, ratingsCount: 0 });
  });
});
