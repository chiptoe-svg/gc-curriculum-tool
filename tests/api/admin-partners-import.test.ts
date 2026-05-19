import { describe, it, expect, vi, beforeEach } from 'vitest';

const { send, createPartner, findPartnerByEmail, markInvited, logPartnerEvent } = vi.hoisted(() => ({
  send: vi.fn(),
  createPartner: vi.fn(),
  findPartnerByEmail: vi.fn(),
  markInvited: vi.fn(),
  logPartnerEvent: vi.fn(),
}));

vi.mock('@/lib/email/send-partner-invite', () => ({
  sendPartnerInvite: send,
}));

vi.mock('@/lib/partners/queries', () => ({
  createPartner,
  findPartnerByEmail,
  markInvited,
  logPartnerEvent,
}));

vi.mock('@/lib/slug', () => ({
  isValidSlug: (s: string) => s === 'valid-slug-12345',
}));

import { POST } from '@/app/api/admin/partners/import/route';

beforeEach(() => {
  send.mockReset(); send.mockResolvedValue(undefined);
  createPartner.mockReset();
  findPartnerByEmail.mockReset(); findPartnerByEmail.mockResolvedValue(null);
  markInvited.mockReset(); markInvited.mockResolvedValue(undefined);
  logPartnerEvent.mockReset(); logPartnerEvent.mockResolvedValue(undefined);
});

function makeReq(body: unknown): Request {
  return new Request('http://test/api/admin/partners/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/partners/import', () => {
  it('401s on invalid slug', async () => {
    const res = await POST(makeReq({ slug: 'wrong', csv: 'x' }));
    expect(res.status).toBe(401);
  });

  it('inserts new partners and sends invites', async () => {
    let n = 0;
    createPartner.mockImplementation(async (input) => ({
      id: `id-${++n}`, ...input, magicToken: `tok-${n}`,
    }));
    const csv = [
      'email,firstName,lastName,company,roleTitle,weight,careerTargetHints',
      'a@acme.test,A,One,Acme,,1,',
      'b@acme.test,B,Two,Acme,,2,',
    ].join('\n');
    const res = await POST(makeReq({ slug: 'valid-slug-12345', csv }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ inserted: 2, skipped: 0, errors: [] });
    expect(createPartner).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(markInvited).toHaveBeenCalledTimes(2);
  });

  it('skips duplicate emails without sending', async () => {
    findPartnerByEmail.mockResolvedValueOnce({ id: 'existing-id', email: 'a@acme.test' });
    const csv = [
      'email,firstName,lastName,company,roleTitle,weight,careerTargetHints',
      'a@acme.test,A,One,Acme,,1,',
    ].join('\n');
    const res = await POST(makeReq({ slug: 'valid-slug-12345', csv }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.inserted).toBe(0);
    expect(json.skipped).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('returns 400 with errors on CSV validation failure', async () => {
    const csv = 'email,firstName\na@acme.test,A';
    const res = await POST(makeReq({ slug: 'valid-slug-12345', csv }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.errors.length).toBeGreaterThan(0);
  });

  it('continues after a single send failure and reports it', async () => {
    let n = 0;
    createPartner.mockImplementation(async (input) => ({ id: `id-${++n}`, ...input, magicToken: `tok-${n}` }));
    send.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('boom'));
    const csv = [
      'email,firstName,lastName,company,roleTitle,weight,careerTargetHints',
      'a@acme.test,A,One,Acme,,1,',
      'b@acme.test,B,Two,Acme,,1,',
    ].join('\n');
    const res = await POST(makeReq({ slug: 'valid-slug-12345', csv }));
    const json = await res.json();
    expect(json.inserted).toBe(2);
    expect(json.sendFailures).toEqual([{ email: 'b@acme.test', message: 'boom' }]);
  });
});
