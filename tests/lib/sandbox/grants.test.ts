import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: Record<string, unknown[]> = {};
vi.mock('@/lib/db/client', () => ({
  db: {
    insert: () => ({ values: (v: unknown) => ({ returning: async () => { calls.insert = [v]; return [{ id: 'g1', ...(v as object) }]; } }) }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => calls._rows ?? [] }) }) }),
    update: () => ({ set: (s: unknown) => ({ where: async () => { calls.update = [s]; } }) }),
  },
}));

import { isGrantValid } from '@/lib/sandbox/grants';

beforeEach(() => { for (const k of Object.keys(calls)) delete calls[k]; });

describe('isGrantValid', () => {
  const future = new Date(Date.now() + 60_000);
  const past = new Date(Date.now() - 60_000);
  it('valid when active, not revoked, unexpired', () => {
    expect(isGrantValid({ active: true, revokedAt: null, expiresAt: future })).toBe(true);
  });
  it('invalid when revoked, inactive, or expired', () => {
    expect(isGrantValid({ active: false, revokedAt: null, expiresAt: future })).toBe(false);
    expect(isGrantValid({ active: true, revokedAt: past, expiresAt: future })).toBe(false);
    expect(isGrantValid({ active: true, revokedAt: null, expiresAt: past })).toBe(false);
  });
});
