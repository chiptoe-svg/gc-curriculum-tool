import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/sandbox/access', () => ({ authorizeCourseWrite: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('@/lib/ip-hash', () => ({ hashIp: vi.fn().mockReturnValue('h') }));

const { runCourseReset } = vi.hoisted(() => ({ runCourseReset: vi.fn() }));
vi.mock('@/lib/capture/run-course-reset', () => ({ runCourseReset }));

import { POST } from '../route';
import { authorizeCourseWrite } from '@/lib/sandbox/access';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';

const authMock = authorizeCourseWrite as unknown as ReturnType<typeof vi.fn>;
const rateMock = checkIpRateLimit as unknown as ReturnType<typeof vi.fn>;

function reqFor(code: string, body: unknown, slug = 's') {
  return new Request(`http://x/api/capture/${code}/reset?slug=${slug}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function req(body: unknown, slug = 's') {
  return reqFor('GC%201010', body, slug);
}
function call(body: unknown, slug = 's') {
  return POST(req(body, slug), { params: Promise.resolve({ code: 'GC%201010' }) });
}

describe('POST /api/capture/[code]/reset', () => {
  beforeEach(() => {
    authMock.mockReset().mockResolvedValue(true);
    rateMock.mockReset().mockResolvedValue({ allowed: true });
    runCourseReset.mockReset().mockResolvedValue({ courseCode: 'GC 1010', scope: 'session' });
  });

  it('401s when authorizeCourseWrite refuses', async () => {
    authMock.mockResolvedValue(false);
    const res = await call({});
    expect(res.status).toBe(401);
    expect(runCourseReset).not.toHaveBeenCalled();
  });

  it('429s when the IP rate limit is exceeded', async () => {
    rateMock.mockResolvedValue({ allowed: false });
    const res = await call({});
    expect(res.status).toBe(429);
    expect(runCourseReset).not.toHaveBeenCalled();
  });

  it('takes the course code from the PATH and defaults scope to session', async () => {
    await call({});
    expect(runCourseReset).toHaveBeenCalledWith('GC 1010', { scope: 'session', includeSnapshots: false });
  });

  it('rejects a body courseCode that differs from the path', async () => {
    const res = await call({ courseCode: 'GC 2020' });
    expect(res.status).toBe(400);
    expect(runCourseReset).not.toHaveBeenCalled();
  });

  it('rejects an invalid scope with 400', async () => {
    const res = await call({ scope: 'bogus' });
    expect(res.status).toBe(400);
    expect(runCourseReset).not.toHaveBeenCalled();
  });

  it('returns the reset result on success', async () => {
    runCourseReset.mockResolvedValue({ courseCode: 'GC 1010', scope: 'session', workingDraftDeleted: 1 });
    const res = await call({});
    const json = await res.json();
    expect(json.workingDraftDeleted).toBe(1);
  });

  // ── Deeper resets are admin-only (owner must-fix, follow-up to the ── //
  // ── scoped-ingest-reset review) — this route accepts ONLY scope      //
  // ── 'session' with includeSnapshots false/absent. Anything else 403s //
  // ── rather than silently passing through to runCourseReset.          //
  describe('deeper resets are admin-only (403, not passed to runCourseReset)', () => {
    it("200s for the default (no scope, no includeSnapshots) — equivalent to scope 'session'", async () => {
      const res = await call({});
      expect(res.status).toBe(200);
      expect(runCourseReset).toHaveBeenCalledWith('GC 1010', { scope: 'session', includeSnapshots: false });
    });

    it("200s for explicit scope:'session', includeSnapshots:false", async () => {
      const res = await call({ scope: 'session', includeSnapshots: false });
      expect(res.status).toBe(200);
      expect(runCourseReset).toHaveBeenCalledWith('GC 1010', { scope: 'session', includeSnapshots: false });
    });

    it("403s for scope:'materials'", async () => {
      const res = await call({ scope: 'materials' });
      expect(res.status).toBe(403);
      expect(runCourseReset).not.toHaveBeenCalled();
      const json = await res.json();
      expect(json.error).toBe('Deeper resets are admin-only — use /api/admin/v2-reset');
    });

    it("403s for scope:'everything'", async () => {
      const res = await call({ scope: 'everything' });
      expect(res.status).toBe(403);
      expect(runCourseReset).not.toHaveBeenCalled();
    });

    it('403s for includeSnapshots:true, even with scope session', async () => {
      const res = await call({ scope: 'session', includeSnapshots: true });
      expect(res.status).toBe(403);
      expect(runCourseReset).not.toHaveBeenCalled();
    });

    it('403s for includeSnapshots:true with no scope given', async () => {
      const res = await call({ includeSnapshots: true });
      expect(res.status).toBe(403);
      expect(runCourseReset).not.toHaveBeenCalled();
    });
  });

  // ── F4 (security review 2026-10-07): canonicalize the path code ────────
  describe('canonicalizes the path course code before use', () => {
    it('GC%204900AP canonicalizes to GC 4900ap before calling runCourseReset', async () => {
      const res = await POST(reqFor('GC%204900AP', {}), { params: Promise.resolve({ code: 'GC%204900AP' }) });
      expect(res.status).toBe(200);
      expect(runCourseReset).toHaveBeenCalledWith('GC 4900ap', { scope: 'session', includeSnapshots: false });
    });

    it('a body courseCode matching the canonical form is accepted', async () => {
      const res = await POST(reqFor('GC%204900AP', { courseCode: 'GC 4900ap' }), { params: Promise.resolve({ code: 'GC%204900AP' }) });
      expect(res.status).toBe(200);
    });

    it('a body courseCode matching the raw (un-canonicalized) path spelling is also accepted', async () => {
      const res = await POST(reqFor('GC%204900AP', { courseCode: 'GC 4900AP' }), { params: Promise.resolve({ code: 'GC%204900AP' }) });
      expect(res.status).toBe(200);
    });

    it('a genuinely different course in the body still 400s', async () => {
      const res = await POST(reqFor('GC%204900AP', { courseCode: 'GC 1010' }), { params: Promise.resolve({ code: 'GC%204900AP' }) });
      expect(res.status).toBe(400);
      expect(runCourseReset).not.toHaveBeenCalled();
    });
  });
});
