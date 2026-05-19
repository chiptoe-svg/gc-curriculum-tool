import { describe, it, expect, vi, beforeEach } from 'vitest';

const { synthesizeTarget } = vi.hoisted(() => ({
  synthesizeTarget: vi.fn(),
}));

vi.mock('@/lib/ai/synthesis/orchestrator', () => ({ synthesizeTarget }));

vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'valid-slug-12345' }));

import { POST } from '@/app/api/admin/synthesis/[targetId]/run/route';

beforeEach(() => {
  synthesizeTarget.mockReset();
});

function makeReq(body: unknown): Request {
  return new Request('http://test/api/admin/synthesis/production-operations/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/synthesis/[targetId]/run', () => {
  it('401s on invalid slug', async () => {
    const res = await POST(makeReq({ slug: 'wrong' }), { params: Promise.resolve({ targetId: 'production-operations' }) });
    expect(res.status).toBe(401);
  });

  it('runs synthesis and returns the run on success', async () => {
    synthesizeTarget.mockResolvedValue({
      id: 'run-1', result: { aggregatedJobTitles: [] }, model: 'gpt-5.4-mini', costUsdCents: 42, submissionCount: 3,
    });
    const res = await POST(makeReq({ slug: 'valid-slug-12345' }), { params: Promise.resolve({ targetId: 'production-operations' }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.run.id).toBe('run-1');
    expect(synthesizeTarget).toHaveBeenCalledWith('production-operations');
  });

  it('429s on daily cap exhaustion', async () => {
    synthesizeTarget.mockRejectedValue(new Error('Daily cap exceeded (99999¢). Synthesis blocked.'));
    const res = await POST(makeReq({ slug: 'valid-slug-12345' }), { params: Promise.resolve({ targetId: 'production-operations' }) });
    expect(res.status).toBe(429);
  });

  it('404s when target not found', async () => {
    synthesizeTarget.mockRejectedValue(new Error('Career target not found: does-not-exist'));
    const res = await POST(makeReq({ slug: 'valid-slug-12345' }), { params: Promise.resolve({ targetId: 'does-not-exist' }) });
    expect(res.status).toBe(404);
  });

  it('409s when there are no submissions', async () => {
    synthesizeTarget.mockRejectedValue(new Error('No submissions to synthesize for target production-operations.'));
    const res = await POST(makeReq({ slug: 'valid-slug-12345' }), { params: Promise.resolve({ targetId: 'production-operations' }) });
    expect(res.status).toBe(409);
  });

  it('500s on any other failure', async () => {
    synthesizeTarget.mockRejectedValue(new Error('OpenAI returned non-JSON'));
    const res = await POST(makeReq({ slug: 'valid-slug-12345' }), { params: Promise.resolve({ targetId: 'production-operations' }) });
    expect(res.status).toBe(500);
  });
});
