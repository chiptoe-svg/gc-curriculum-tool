import { describe, it, expect } from 'vitest';
import { isSessionExpired, SCOPED_SESSION_COOKIE, SCOPED_SESSION_TTL_MS } from '@/lib/sandbox/sessions';

describe('scoped session helpers', () => {
  it('cookie name + 24h TTL', () => {
    expect(SCOPED_SESSION_COOKIE).toBe('gc_sandbox_sess');
    expect(SCOPED_SESSION_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
  it('isSessionExpired compares expiresAt to now', () => {
    expect(isSessionExpired({ expiresAt: new Date(Date.now() - 1000) })).toBe(true);
    expect(isSessionExpired({ expiresAt: new Date(Date.now() + 60_000) })).toBe(false);
  });
});
