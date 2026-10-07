import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/sandbox/access', () => ({ authorizeCourseWrite: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('@/lib/ip-hash', () => ({ hashIp: vi.fn().mockReturnValue('h') }));
// Defaults to "whatever path segment it's given, decoded, is the real
// course" — individual tests override this to exercise the case-
// insensitive-resolution and not-found paths (G2, security re-review).
vi.mock('@/lib/db/courses-queries', () => ({
  resolveCourseCodeCaseInsensitive: vi.fn(async (code: string) => code),
}));

const { runCourseReset } = vi.hoisted(() => ({ runCourseReset: vi.fn() }));
vi.mock('@/lib/capture/run-course-reset', () => ({ runCourseReset }));

import { POST } from '../route';
import { authorizeCourseWrite } from '@/lib/sandbox/access';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { resolveCourseCodeCaseInsensitive } from '@/lib/db/courses-queries';

const authMock = authorizeCourseWrite as unknown as ReturnType<typeof vi.fn>;
const rateMock = checkIpRateLimit as unknown as ReturnType<typeof vi.fn>;
const resolveMock = resolveCourseCodeCaseInsensitive as unknown as ReturnType<typeof vi.fn>;

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
    resolveMock.mockReset().mockImplementation(async (code: string) => code);
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

  // G2 (security re-review 2026-10-07): the KEY regression this closes —
  // before this fix, resetting an unknown/mis-cased course 200'd with
  // runCourseReset silently deleting zero rows (a false "success"). It
  // must 404 instead, and never call runCourseReset at all.
  it('404s on an unknown course and never calls runCourseReset (no silent success)', async () => {
    resolveMock.mockResolvedValue(null);
    const res = await call({});
    expect(res.status).toBe(404);
    expect(runCourseReset).not.toHaveBeenCalled();
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

  // ── G2 (security re-review 2026-10-07): resolve the stored course code
  // case-insensitively instead of blindly canonicalizing. GC 1010L (an
  // upper-case-suffix course on the live roster) must not be broken by a
  // path spelled with a different case — and reset on an unknown course
  // must 404, never silently "succeed."
  describe('resolves the stored course code case-insensitively', () => {
    it('GC%201010l resolves to the stored GC 1010L and that spelling reaches runCourseReset', async () => {
      resolveMock.mockImplementation(async (code: string) =>
        code.toLowerCase() === 'gc 1010l' ? 'GC 1010L' : code);
      const res = await POST(reqFor('GC%201010l', {}), { params: Promise.resolve({ code: 'GC%201010l' }) });
      expect(res.status).toBe(200);
      expect(resolveMock).toHaveBeenCalledWith('GC 1010l');
      expect(runCourseReset).toHaveBeenCalledWith('GC 1010L', { scope: 'session', includeSnapshots: false });
    });

    it('a body courseCode matching case-insensitively is accepted', async () => {
      resolveMock.mockImplementation(async (code: string) =>
        code.toLowerCase() === 'gc 1010l' ? 'GC 1010L' : code);
      const res = await POST(
        reqFor('GC%201010l', { courseCode: 'gc 1010l' }),
        { params: Promise.resolve({ code: 'GC%201010l' }) },
      );
      expect(res.status).toBe(200);
    });

    it('a genuinely different course in the body still 400s', async () => {
      resolveMock.mockImplementation(async (code: string) =>
        code.toLowerCase() === 'gc 1010l' ? 'GC 1010L' : code);
      const res = await POST(
        reqFor('GC%201010l', { courseCode: 'GC 1010' }),
        { params: Promise.resolve({ code: 'GC%201010l' }) },
      );
      expect(res.status).toBe(400);
      expect(runCourseReset).not.toHaveBeenCalled();
    });

    it('an unknown course 404s, never reaching scope validation or runCourseReset', async () => {
      resolveMock.mockResolvedValue(null);
      const res = await POST(reqFor('GC%209999', {}), { params: Promise.resolve({ code: 'GC%209999' }) });
      expect(res.status).toBe(404);
      expect(runCourseReset).not.toHaveBeenCalled();
    });
  });
});
