import { describe, it, expect, vi, beforeEach } from 'vitest';

// isValidSlug: only 'FACULTY' is the (mock) faculty secret.
vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'FACULTY' }));
const mockLookup = vi.fn();
vi.mock('@/lib/sandbox/sessions', () => ({
  lookupScopedSession: (...a: unknown[]) => mockLookup(...a),
  SCOPED_SESSION_COOKIE: 'gc_sandbox_sess',
}));
vi.mock('@/lib/sandbox/grants', () => ({
  getGrantById: vi.fn(async () => ({ active: true, revokedAt: null, expiresAt: new Date(Date.now() + 1e6) })),
  isGrantValid: () => true,
}));

import { authorizeCourseWrite } from '@/lib/sandbox/access';

function reqWith(cookie?: string) {
  return { headers: { get: (n: string) => (n.toLowerCase() === 'cookie' ? (cookie ?? null) : null) } };
}
beforeEach(() => { vi.clearAllMocks(); });

describe('authorizeCourseWrite (security gate)', () => {
  it('true for a valid faculty slug — no session needed', async () => {
    expect(await authorizeCourseWrite(reqWith(), 'GC 2400', 'FACULTY')).toBe(true);
  });
  it('true for a scoped session bound to the SAME course (invalid slug)', async () => {
    mockLookup.mockResolvedValue({ grantId: 'g', courseCode: 'GC 2400', instructorName: 'x', expiresAt: new Date(Date.now() + 1e6) });
    expect(await authorizeCourseWrite(reqWith('gc_sandbox_sess=sess1'), 'GC 2400', 'bad')).toBe(true);
  });
  it('FALSE for a session bound to a DIFFERENT course', async () => {
    mockLookup.mockResolvedValue({ grantId: 'g', courseCode: 'GC 2400', instructorName: 'x', expiresAt: new Date(Date.now() + 1e6) });
    expect(await authorizeCourseWrite(reqWith('gc_sandbox_sess=sess1'), 'GC 9999', 'bad')).toBe(false);
  });
  it('FALSE with no valid slug and no session cookie', async () => {
    expect(await authorizeCourseWrite(reqWith(), 'GC 2400', 'bad')).toBe(false);
  });
});
