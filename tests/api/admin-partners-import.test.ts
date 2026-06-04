import { describe, it, expect, vi, beforeEach } from 'vitest';

const { createPartner, findPartnerByEmail, magicLinkUrl, logPartnerEvent } = vi.hoisted(() => ({
  createPartner: vi.fn(),
  findPartnerByEmail: vi.fn(),
  magicLinkUrl: vi.fn(),
  logPartnerEvent: vi.fn(),
}));

vi.mock('@/lib/partners/queries', () => ({
  createPartner,
  findPartnerByEmail,
  magicLinkUrl,
  logPartnerEvent,
}));

vi.mock('@/lib/slug', () => ({
  isValidSlug: (s: string) => s === 'valid-slug-12345',
}));

import { POST } from '@/app/api/admin/partners/import/route';

beforeEach(() => {
  createPartner.mockReset();
  findPartnerByEmail.mockReset(); findPartnerByEmail.mockResolvedValue(null);
  magicLinkUrl.mockReset(); magicLinkUrl.mockImplementation((p: { magicToken: string }) =>
    `https://example.test/partners/${p.magicToken}`);
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

  it('inserts new partners and returns magic links for manual sending', async () => {
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
    expect(json.createdPartners).toHaveLength(2);
    expect(json.createdPartners[0]).toMatchObject({
      id: 'id-1',
      email: 'a@acme.test',
      magicLinkUrl: 'https://example.test/partners/tok-1',
    });
    expect(json.createdPartners[1]).toMatchObject({
      id: 'id-2',
      email: 'b@acme.test',
      magicLinkUrl: 'https://example.test/partners/tok-2',
    });
  });

  it('skips duplicate emails without creating', async () => {
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
    expect(createPartner).not.toHaveBeenCalled();
    expect(json.createdPartners).toEqual([]);
  });

  it('returns 400 with errors on CSV validation failure', async () => {
    const csv = 'email,firstName\na@acme.test,A';
    const res = await POST(makeReq({ slug: 'valid-slug-12345', csv }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.errors.length).toBeGreaterThan(0);
  });

  it('logs an admin_imported_csv event with the row counts', async () => {
    let n = 0;
    createPartner.mockImplementation(async (input) => ({
      id: `id-${++n}`, ...input, magicToken: `tok-${n}`,
    }));
    const csv = [
      'email,firstName,lastName,company,roleTitle,weight,careerTargetHints',
      'a@acme.test,A,One,Acme,,1,',
    ].join('\n');
    await POST(makeReq({ slug: 'valid-slug-12345', csv }));
    expect(logPartnerEvent).toHaveBeenCalledWith(null, 'admin_imported_csv', expect.objectContaining({
      inserted: 1,
      skipped: 0,
    }));
  });
});
