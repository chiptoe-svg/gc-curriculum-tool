import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findPartnerByToken, findPartnerById, lookupSession } = vi.hoisted(() => ({
  findPartnerByToken: vi.fn(),
  findPartnerById: vi.fn(),
  lookupSession: vi.fn(),
}));

vi.mock('@/lib/partners/queries', () => ({ findPartnerByToken, findPartnerById }));
vi.mock('@/lib/partners/sessions', () => ({
  lookupSession, SESSION_COOKIE: 'gc_partner_sess',
}));

import { resolvePartner } from '@/lib/partners/auth';

beforeEach(() => {
  findPartnerByToken.mockReset();
  findPartnerById.mockReset();
  lookupSession.mockReset();
});

function req(headers: Record<string, string> = {}) {
  return new Request('http://test/whatever', { headers });
}

describe('resolvePartner', () => {
  it('returns null when neither token nor cookie present', async () => {
    expect(await resolvePartner(req(), null)).toBeNull();
  });

  it('resolves via token (URL param) when valid + active', async () => {
    findPartnerByToken.mockResolvedValue({ id: 'p1', active: true });
    const out = await resolvePartner(req(), 'TOKEN');
    expect(out).toMatchObject({ id: 'p1' });
  });

  it('returns null when token matches but partner is inactive', async () => {
    findPartnerByToken.mockResolvedValue({ id: 'p1', active: false });
    expect(await resolvePartner(req(), 'TOKEN')).toBeNull();
  });

  it('resolves via session cookie', async () => {
    lookupSession.mockResolvedValue({ id: 'sess', partnerId: 'p1' });
    findPartnerById.mockResolvedValue({ id: 'p1', active: true });
    const out = await resolvePartner(req({ cookie: 'gc_partner_sess=sess' }), null);
    expect(out).toMatchObject({ id: 'p1' });
  });

  it('prefers token if both present', async () => {
    findPartnerByToken.mockResolvedValue({ id: 'p-from-token', active: true });
    lookupSession.mockResolvedValue({ id: 'sess', partnerId: 'p-from-cookie' });
    findPartnerById.mockResolvedValue({ id: 'p-from-cookie', active: true });
    const out = await resolvePartner(req({ cookie: 'gc_partner_sess=sess' }), 'TOKEN');
    expect(out!.id).toBe('p-from-token');
  });
});
