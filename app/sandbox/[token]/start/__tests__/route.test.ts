import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetGrant = vi.fn();
const mockCreateSession = vi.fn();
const mockCreateCourse = vi.fn();
vi.mock('@/lib/sandbox/grants', () => ({
  getGrantByToken: (...a: unknown[]) => mockGetGrant(...a),
  isGrantValid: () => true,
}));
vi.mock('@/lib/sandbox/sessions', () => ({
  createScopedSession: (...a: unknown[]) => mockCreateSession(...a),
  SCOPED_SESSION_COOKIE: 'gc_sandbox_sess',
  SCOPED_SESSION_TTL_MS: 86400000,
}));
vi.mock('@/lib/sandbox/courses', () => ({
  createSandboxCourse: (...a: unknown[]) => mockCreateCourse(...a),
}));

import { POST } from '../route';

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new Request('http://host/sandbox/tok/start', { method: 'POST', body: fd });
}
beforeEach(() => {
  vi.clearAllMocks();
  mockGetGrant.mockResolvedValue({ id: 'g1', courseCode: null, active: true, revokedAt: null, expiresAt: new Date(Date.now() + 1e6) });
  mockCreateSession.mockResolvedValue({ id: 'sess-1', expiresAt: new Date(Date.now() + 86400000) });
  mockCreateCourse.mockResolvedValue({ code: 'EXT-abc123' });
});

describe('POST /sandbox/[token]/start', () => {
  it('creates the tester sandbox course, mints a session, redirects into capture', async () => {
    const res = await POST(form({ courseCode: 'GC 2400', title: 'Intro to GC', name: 'Dr. Lee', institution: 'UGA' }), { params: Promise.resolve({ token: 'tok' }) });
    expect(res.status).toBe(303);
    expect(mockCreateCourse).toHaveBeenCalledWith({ enteredCode: 'GC 2400', title: 'Intro to GC' });
    // session + redirect bind to the GENERATED internal code, not the entered one
    expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({ courseCode: 'EXT-abc123', instructorName: expect.stringContaining('Dr. Lee') }));
    expect(res.headers.get('location')).toContain('/capture/EXT-abc123');
    expect(res.headers.get('set-cookie')).toContain('gc_sandbox_sess=sess-1');
  });
  it('400s without a name', async () => {
    const res = await POST(form({ title: 'Intro', name: '' }), { params: Promise.resolve({ token: 'tok' }) });
    expect(res.status).toBe(400);
  });
  it('400s without a title or code', async () => {
    const res = await POST(form({ name: 'Dr. Lee' }), { params: Promise.resolve({ token: 'tok' }) });
    expect(res.status).toBe(400);
  });
  it('rejects an invalid grant', async () => {
    mockGetGrant.mockResolvedValue(null);
    const res = await POST(form({ title: 'x', name: 'y' }), { params: Promise.resolve({ token: 'bad' }) });
    expect(res.status).toBe(404);
  });
});
