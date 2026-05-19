import { describe, it, expect, vi, beforeEach } from 'vitest';

const { send, findPartnerById, markInvited, logPartnerEvent } = vi.hoisted(() => ({
  send: vi.fn(),
  findPartnerById: vi.fn(),
  markInvited: vi.fn(),
  logPartnerEvent: vi.fn(),
}));

vi.mock('@/lib/email/send-partner-invite', () => ({ sendPartnerInvite: send }));

vi.mock('@/lib/partners/queries', () => ({
  findPartnerById, markInvited, logPartnerEvent,
}));

vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'valid-slug-12345' }));

import { POST } from '@/app/api/admin/partners/[partnerId]/resend-invite/route';

beforeEach(() => {
  send.mockReset(); send.mockResolvedValue(undefined);
  findPartnerById.mockReset();
  markInvited.mockReset(); markInvited.mockResolvedValue(undefined);
  logPartnerEvent.mockReset(); logPartnerEvent.mockResolvedValue(undefined);
});

function makeReq(body: unknown): Request {
  return new Request('http://test/api/admin/partners/abc/resend-invite', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/partners/[partnerId]/resend-invite', () => {
  it('401s on invalid slug', async () => {
    const res = await POST(makeReq({ slug: 'nope' }), { params: Promise.resolve({ partnerId: 'abc' }) });
    expect(res.status).toBe(401);
  });

  it('404s when partner not found', async () => {
    findPartnerById.mockResolvedValue(null);
    const res = await POST(makeReq({ slug: 'valid-slug-12345' }), { params: Promise.resolve({ partnerId: 'abc' }) });
    expect(res.status).toBe(404);
  });

  it('sends invite and updates invitedAt', async () => {
    findPartnerById.mockResolvedValue({
      id: 'abc', firstName: 'A', email: 'a@acme.test', magicToken: 'tok', active: true,
    });
    const res = await POST(makeReq({ slug: 'valid-slug-12345' }), { params: Promise.resolve({ partnerId: 'abc' }) });
    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledWith({ firstName: 'A', email: 'a@acme.test', token: 'tok' });
    expect(markInvited).toHaveBeenCalledWith('abc');
    expect(logPartnerEvent).toHaveBeenCalledWith('abc', 'admin_resent_invite', expect.any(Object));
  });

  it('refuses to send for deactivated partners', async () => {
    findPartnerById.mockResolvedValue({
      id: 'abc', firstName: 'A', email: 'a@acme.test', magicToken: 'tok', active: false,
    });
    const res = await POST(makeReq({ slug: 'valid-slug-12345' }), { params: Promise.resolve({ partnerId: 'abc' }) });
    expect(res.status).toBe(409);
    expect(send).not.toHaveBeenCalled();
  });
});
