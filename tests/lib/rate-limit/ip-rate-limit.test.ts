import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/client', () => ({ db: {} as any }));

const incrementSpy = vi.fn();
vi.mock('@/lib/rate-limit/ip-rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rate-limit/ip-rate-limit')>('@/lib/rate-limit/ip-rate-limit');
  return { ...actual };
});

import { checkIpRateLimit, MAX_PER_HOUR } from '@/lib/rate-limit/ip-rate-limit';

describe('checkIpRateLimit', () => {
  beforeEach(() => incrementSpy.mockReset());

  it('exports a constant MAX_PER_HOUR of 10', () => {
    expect(MAX_PER_HOUR).toBe(10);
  });

  // Integration tests against the real DB run separately; this unit test just verifies the constant.
});
