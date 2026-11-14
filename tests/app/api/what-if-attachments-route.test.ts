import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Grant } from '@/lib/auth/authorize';

const authorizeRequest = vi.fn();
vi.mock('@/lib/auth/route-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/route-auth')>('@/lib/auth/route-auth');
  return { ...actual, authorizeRequest: (...a: unknown[]) => authorizeRequest(...a) };
});
const getWhatIf = vi.fn();
const checkIpRateLimit = vi.fn();
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit: (...a: unknown[]) => checkIpRateLimit(...a) }));
const checkDailyCap = vi.fn();
const recordSpend = vi.fn();
vi.mock('@/lib/rate-limit/daily-cap', () => ({
  checkDailyCap: (...a: unknown[]) => checkDailyCap(...a),
  recordSpend: (...a: unknown[]) => recordSpend(...a),
}));
// Run the real ingest (so the vision cost reaches recordSpend) with its collaborators mocked; spy on the call.
const extractText = vi.fn();
vi.mock('@/lib/courses/extract-text', () => ({ extractText: (...a: unknown[]) => extractText(...a) }));
vi.mock('@/lib/privacy/scrub', () => ({ scrubForRecord: async (t: string) => ({ text: t, redactions: {} }) }));
vi.mock('@/lib/storage/local-storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storage/local-storage')>('@/lib/storage/local-storage');
  return { ...actual, putLocal: async () => ({ url: 'local:k', key: 'k' }) };
});
const insertRow = vi.fn();
vi.mock('@/lib/db/what-if-queries', () => ({
  getWhatIf: (...a: unknown[]) => getWhatIf(...a),
  insertWhatIfAttachment: (...a: unknown[]) => insertRow(...a),
  listWhatIfAttachments: vi.fn(),
}));
const ingestSpy = vi.hoisted(() => vi.fn());
vi.mock('@/lib/what-if/attachments', async () => {
  const actual = await vi.importActual<typeof import('@/lib/what-if/attachments')>('@/lib/what-if/attachments');
  ingestSpy.mockImplementation(actual.ingestWhatIfAttachment);
  return { ...actual, ingestWhatIfAttachment: (...a: unknown[]) => ingestSpy(...a) };
});

import { POST } from '@/app/api/explore/[code]/what-ifs/[id]/attachments/route';

const CODE = 'GC 3730';
const ID = '8b1f0c2e-0000-4000-8000-000000000001';
const owner: Grant = { id: 'g1', label: 'Dr. Rivera', scope: [CODE], can: ['capture'] };
const other: Grant = { id: 'g2', label: 'Dr. Lee', scope: [CODE], can: ['capture'] };
const row = (over: object = {}) => ({
  id: ID, courseCode: CODE, ownerGrantId: 'g1', ownerKind: 'personal', authorName: 'Dr. Rivera', title: 'T',
  summary: 's', pageCreatedAt: new Date('2026-11-02'), createdAt: new Date('2026-11-01'), ...over,
});
const ctx = () => ({ params: Promise.resolve({ code: encodeURIComponent(CODE), id: ID }) });
const url = `http://x/api/explore/${encodeURIComponent(CODE)}/what-ifs/${ID}/attachments`;
const upload = (file: File | null, headers: Record<string, string> = {}) => {
  const fd = new FormData();
  if (file) fd.set('file', file);
  const req = new Request(url, { method: 'POST', body: fd, headers });
  // Re-parsing the multipart body under jsdom drops the file name and size; hand the route the original form.
  vi.spyOn(req, 'formData').mockResolvedValue(fd);
  return req;
};
const pdf = (size = 10) => new File([new Uint8Array(size)], 'plan.pdf', { type: 'application/pdf' });

beforeEach(() => {
  [authorizeRequest, getWhatIf, checkIpRateLimit, checkDailyCap, recordSpend, extractText, insertRow].forEach((m) => m.mockReset());
  ingestSpy.mockClear(); // keeps the call-through implementation
  authorizeRequest.mockResolvedValue({ grant: owner });
  getWhatIf.mockResolvedValue(row());
  checkIpRateLimit.mockResolvedValue({ allowed: true });
  checkDailyCap.mockResolvedValue({ ok: true });
  extractText.mockResolvedValue({ status: 'ok', text: 'A real paragraph about color management in the press room.' });
  insertRow.mockImplementation(async (r: object) => ({ id: 'att-1', createdAt: new Date(), ...r }));
});

describe('POST what-if attachments', () => {
  it('no grant: 401', async () => {
    authorizeRequest.mockResolvedValue({ response: new Response('no', { status: 401 }) });
    expect((await POST(upload(pdf()), ctx())).status).toBe(401);
    expect(ingestSpy).not.toHaveBeenCalled();
  });

  it('non-owner on a what-if with a page: 403', async () => {
    authorizeRequest.mockResolvedValue({ grant: other });
    expect((await POST(upload(pdf()), ctx())).status).toBe(403);
    expect(ingestSpy).not.toHaveBeenCalled();
  });

  it('cross-site POST: 403 cross_origin_blocked, nothing ingested', async () => {
    const res = await POST(upload(pdf(), { 'sec-fetch-site': 'cross-site' }), ctx());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('cross_origin_blocked');
    expect(ingestSpy).not.toHaveBeenCalled();
  });

  it('unsupported type: 400', async () => {
    const res = await POST(upload(new File(['x'], 'a.mp4', { type: 'video/mp4' })), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/^Unsupported MIME type: video\/mp4/);
  });

  it('no file field: 400', async () => {
    const res = await POST(upload(null), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('file field is required');
  });

  it('over the size limit: 400', async () => {
    const big = pdf();
    Object.defineProperty(big, 'size', { value: 100 * 1024 * 1024 + 1 });
    const res = await POST(upload(big), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/^file too large/);
    expect(ingestSpy).not.toHaveBeenCalled();
  });

  it('rate limited: 429', async () => {
    checkIpRateLimit.mockResolvedValue({ allowed: false });
    expect((await POST(upload(pdf()), ctx())).status).toBe(429);
  });

  it('daily cap reached: 503', async () => {
    checkDailyCap.mockResolvedValue({ ok: false });
    const res = await POST(upload(pdf()), ctx());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'daily cost cap reached — service paused for today' });
    expect(ingestSpy).not.toHaveBeenCalled();
  });

  it('a good file: 201 and ingest called once with the what-if id', async () => {
    const res = await POST(upload(pdf()), ctx());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ attachment: { id: 'att-1', fileName: 'plan.pdf', status: 'ok', heldBackReason: null } });
    expect(ingestSpy).toHaveBeenCalledTimes(1);
    expect(ingestSpy.mock.calls[0]![0]).toMatchObject({ whatIfId: ID, fileName: 'plan.pdf', mimeType: 'application/pdf' });
  });

  it('records the vision cost when extraction reports one', async () => {
    extractText.mockResolvedValue({ status: 'ok', text: 'A real paragraph about color management in the press room.', visionCostUsdCents: 17 });
    await POST(upload(pdf()), ctx());
    expect(recordSpend).toHaveBeenCalledWith(17);
  });
});
