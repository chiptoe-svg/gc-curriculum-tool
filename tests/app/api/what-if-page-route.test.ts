import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Grant } from '@/lib/auth/authorize';
import { AiCreditsExhaustedError } from '@/lib/ai/credit-status';

const authorizeRequest = vi.fn();
vi.mock('@/lib/auth/route-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/route-auth')>('@/lib/auth/route-auth');
  return { ...actual, authorizeRequest: (...a: unknown[]) => authorizeRequest(...a) };
});
const getWhatIf = vi.fn();
vi.mock('@/lib/db/what-if-queries', () => ({ getWhatIf: (...a: unknown[]) => getWhatIf(...a) }));
const createWhatIfPage = vi.fn();
vi.mock('@/lib/what-if/create-page', () => ({ createWhatIfPage: (...a: unknown[]) => createWhatIfPage(...a) }));

import { POST } from '@/app/api/explore/[code]/what-ifs/[id]/page/route';

const CODE = 'GC 3730';
const ID = '8b1f0c2e-0000-4000-8000-000000000001';
const owner: Grant = { id: 'g1', label: 'Dr. Rivera', scope: [CODE], can: ['capture'] };
const other: Grant = { id: 'g2', label: 'Dr. Lee', scope: [CODE], can: ['capture'] };
const row = (over: object = {}) => ({
  id: ID, courseCode: CODE, ownerGrantId: 'g1', ownerKind: 'personal', authorName: 'Dr. Rivera',
  baseSnapshotId: 'snap-1', pageCreatedAt: new Date(), ...over,
});
const ctx = (id = ID) => ({ params: Promise.resolve({ code: encodeURIComponent(CODE), id }) });
const post = () => new Request(
  `http://x/api/explore/${encodeURIComponent(CODE)}/what-ifs/${ID}/page`,
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
);

beforeEach(() => {
  [authorizeRequest, getWhatIf, createWhatIfPage].forEach(m => m.mockReset());
  authorizeRequest.mockResolvedValue({ grant: owner });
  getWhatIf.mockResolvedValue(row());
  createWhatIfPage.mockResolvedValue({ ok: true });
});

describe('POST what-ifs/[id]/page', () => {
  it('a non-owner of a what-if that has a page gets 403 and nothing runs', async () => {
    authorizeRequest.mockResolvedValue({ grant: other });
    expect((await POST(post(), ctx())).status).toBe(403);
    expect(createWhatIfPage).not.toHaveBeenCalled();
  });

  it('a non-uuid id is a 404', async () => {
    expect((await POST(post(), ctx('nope'))).status).toBe(404);
    expect(createWhatIfPage).not.toHaveBeenCalled();
  });

  it('ok: 200 { ok: true }, run on the stored what-if', async () => {
    const res = await POST(post(), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(createWhatIfPage).toHaveBeenCalledWith(expect.objectContaining({ id: ID, courseCode: CODE }));
  });

  it('baseline_withdrawn: the scores route response', async () => {
    createWhatIfPage.mockResolvedValue({ ok: false, reason: 'baseline_withdrawn' });
    const res = await POST(post(), ctx());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'The approved version this revision started from was withdrawn. Start over to revise the current version.',
      code: 'baseline_withdrawn',
    });
  });

  it('daily_cap: 503 with the same body as the chat route', async () => {
    createWhatIfPage.mockResolvedValue({ ok: false, reason: 'daily_cap' });
    const res = await POST(post(), ctx());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'daily cost cap reached — service paused for today' });
  });

  it('prose_failed: 502 with the plain message', async () => {
    createWhatIfPage.mockResolvedValue({ ok: false, reason: 'prose_failed' });
    const res = await POST(post(), ctx());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'The page text could not be written. Try again.' });
  });

  it('credits exhausted: 503 with the interview\'s code', async () => {
    createWhatIfPage.mockRejectedValue(new AiCreditsExhaustedError('x'));
    const res = await POST(post(), ctx());
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('ai_credits_exhausted');
  });

  it('any other failure is a 502 and not a hang', async () => {
    createWhatIfPage.mockRejectedValue(new Error('boom'));
    const res = await POST(post(), ctx());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'The page could not be created. Try again.' });
  });
});
