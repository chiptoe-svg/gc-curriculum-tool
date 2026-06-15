import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetGrant = vi.fn();
const mockCreateSession = vi.fn();
vi.mock('@/lib/sandbox/grants', () => ({
  getGrantByToken: (...a: unknown[]) => mockGetGrant(...a),
  isGrantValid: () => true,
}));
vi.mock('@/lib/sandbox/sessions', () => ({
  createScopedSession: (...a: unknown[]) => mockCreateSession(...a),
  SCOPED_SESSION_COOKIE: 'gc_sandbox_sess',
  SCOPED_SESSION_TTL_MS: 86400000,
}));

import { POST } from '../route';

function form(name: string, institution: string) {
  const fd = new FormData(); fd.set('name', name); fd.set('institution', institution);
  return new Request('http://host/sandbox/tok/start', { method: 'POST', body: fd });
}
beforeEach(() => {
  vi.clearAllMocks();
  mockGetGrant.mockResolvedValue({ id: 'g1', courseCode: 'GC 2400', active: true, revokedAt: null, expiresAt: new Date(Date.now() + 1e6) });
  mockCreateSession.mockResolvedValue({ id: 'sess-1', expiresAt: new Date(Date.now() + 86400000) });
});

describe('POST /sandbox/[token]/start', () => {
  it('mints a session cookie and redirects to the course capture page', async () => {
    const res = await POST(form('Dr. Lee', 'UGA'), { params: Promise.resolve({ token: 'tok' }) });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/capture/GC%202400');
    expect(res.headers.get('set-cookie')).toContain('gc_sandbox_sess=sess-1');
    expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({ courseCode: 'GC 2400', instructorName: expect.stringContaining('Dr. Lee') }));
  });
  it('rejects an invalid grant', async () => {
    mockGetGrant.mockResolvedValue(null);
    const res = await POST(form('x', 'y'), { params: Promise.resolve({ token: 'bad' }) });
    expect(res.status).toBe(404);
  });
});
