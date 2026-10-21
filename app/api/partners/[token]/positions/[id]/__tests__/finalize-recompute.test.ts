// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFinalize = vi.fn();
const mockRecompute = vi.fn(async (_reason: string) => {});
vi.mock('@/lib/partners/queries', () => ({ findPartnerByToken: vi.fn(async () => ({ id: 'partner-1', active: true })) }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock('@/lib/ip-hash', () => ({ hashIp: () => 'h' }));
vi.mock('@/lib/db/position-capture-queries', () => ({
  getPositionCaptureById: vi.fn(async () => ({ id: 'cap-1', partnerId: 'partner-1', status: 'draft' })),
  updatePositionDraft: vi.fn(),
  finalizePosition: (...a: unknown[]) => mockFinalize(...a),
}));
vi.mock('@/lib/db/career-weight-queries', () => ({ recomputeCareerWeightsSafely: (r: string) => mockRecompute(r) }));

import { POST } from '../route';

const submit = () => POST(
  new Request('http://h/api/partners/tok/positions/cap-1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ completeness: 'rated' }) }),
  { params: Promise.resolve({ token: 'tok', id: 'cap-1' }) },
);

describe('position capture submit → career-weight recompute', () => {
  beforeEach(() => { mockFinalize.mockReset(); mockRecompute.mockClear(); });

  it('recomputes after a successful submit', async () => {
    mockFinalize.mockResolvedValue(undefined);
    expect((await submit()).status).toBe(200);
    expect(mockRecompute).toHaveBeenCalledWith('position capture submitted');
  });

  it('does not recompute when finalize fails', async () => {
    mockFinalize.mockRejectedValue(new Error('not draftable'));
    expect((await submit()).status).toBe(400);
    expect(mockRecompute).not.toHaveBeenCalled();
  });
});
