import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/sandbox/access', () => ({ authorizeCourseWrite: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('@/lib/ip-hash', () => ({ hashIp: vi.fn().mockReturnValue('h') }));
vi.mock('@/lib/rate-limit/daily-cap', () => ({ checkDailyCap: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock('@/lib/capture/ingest-cooldown', () => ({
  checkIngestCooldown: vi.fn().mockReturnValue({ allowed: true }),
  recordIngestStart: vi.fn(),
}));
// Defaults to "whatever path segment it's given, decoded, is the real
// course" — individual tests override this to exercise the case-
// insensitive-resolution and not-found paths (G2, security re-review).
vi.mock('@/lib/db/courses-queries', () => ({
  resolveCourseCodeCaseInsensitive: vi.fn(async (code: string) => code),
}));

const { runCourseIngest } = vi.hoisted(() => ({ runCourseIngest: vi.fn() }));
vi.mock('@/lib/capture/run-course-ingest', () => ({ runCourseIngest }));

import { POST } from '../route';
import { authorizeCourseWrite } from '@/lib/sandbox/access';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap } from '@/lib/rate-limit/daily-cap';
import { checkIngestCooldown, recordIngestStart } from '@/lib/capture/ingest-cooldown';
import { resolveCourseCodeCaseInsensitive } from '@/lib/db/courses-queries';

const authMock = authorizeCourseWrite as unknown as ReturnType<typeof vi.fn>;
const rateMock = checkIpRateLimit as unknown as ReturnType<typeof vi.fn>;
const capMock = checkDailyCap as unknown as ReturnType<typeof vi.fn>;
const cooldownMock = checkIngestCooldown as unknown as ReturnType<typeof vi.fn>;
const recordMock = recordIngestStart as unknown as ReturnType<typeof vi.fn>;
const resolveMock = resolveCourseCodeCaseInsensitive as unknown as ReturnType<typeof vi.fn>;

function reqFor(code: string, body: unknown, slug = 's') {
  return new Request(`http://x/api/capture/${code}/ingest?slug=${slug}`, {
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

describe('POST /api/capture/[code]/ingest', () => {
  beforeEach(() => {
    authMock.mockReset().mockResolvedValue(true);
    rateMock.mockReset().mockResolvedValue({ allowed: true });
    capMock.mockReset().mockResolvedValue({ ok: true });
    cooldownMock.mockReset().mockReturnValue({ allowed: true });
    recordMock.mockReset();
    resolveMock.mockReset().mockImplementation(async (code: string) => code);
    runCourseIngest.mockReset().mockResolvedValue({
      courseCode: 'GC 1010', count: 0, queued: 0, skipped: 0, failed: 0, results: [],
    });
  });

  it('401s when authorizeCourseWrite refuses (bad/missing slug, out-of-scope session)', async () => {
    authMock.mockResolvedValue(false);
    const res = await call({});
    expect(res.status).toBe(401);
    expect(runCourseIngest).not.toHaveBeenCalled();
  });

  it('429s when the IP rate limit is exceeded, with a plain body (no reason field)', async () => {
    rateMock.mockResolvedValue({ allowed: false });
    const res = await call({});
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json).toEqual({ error: 'rate limit exceeded' });
    expect(runCourseIngest).not.toHaveBeenCalled();
  });

  it('takes the course code from the PATH, not the body', async () => {
    await call({});
    expect(runCourseIngest).toHaveBeenCalledWith('GC 1010', { mode: 'hybrid' });
  });

  it('rejects a body courseCode that differs from the path', async () => {
    const res = await call({ courseCode: 'GC 2020' });
    expect(res.status).toBe(400);
    expect(runCourseIngest).not.toHaveBeenCalled();
  });

  it('allows a body courseCode that matches the path', async () => {
    const res = await call({ courseCode: 'GC 1010' });
    expect(res.status).toBe(200);
  });

  it('rejects an invalid mode with 400', async () => {
    const res = await call({ mode: 'bogus' });
    expect(res.status).toBe(400);
    expect(runCourseIngest).not.toHaveBeenCalled();
  });

  it("accepts mode:'local'", async () => {
    await call({ mode: 'local' });
    expect(runCourseIngest).toHaveBeenCalledWith('GC 1010', { mode: 'local' });
  });

  it('defaults to hybrid when mode is omitted', async () => {
    await call({});
    expect(runCourseIngest).toHaveBeenCalledWith('GC 1010', { mode: 'hybrid' });
  });

  it('404s when the course does not exist (runCourseIngest never reached)', async () => {
    resolveMock.mockResolvedValue(null);
    const res = await call({});
    expect(res.status).toBe(404);
    expect(runCourseIngest).not.toHaveBeenCalled();
  });

  it('returns the ingest result on success', async () => {
    runCourseIngest.mockResolvedValue({
      courseCode: 'GC 1010', count: 2, queued: 1, skipped: 1, failed: 0,
      results: [{ id: 'm1', fileName: 'a.pdf', status: 'queued' }, { id: 'm2', fileName: 'b.pdf', status: 'skipped' }],
    });
    const res = await call({});
    const json = await res.json();
    expect(json.queued).toBe(1);
    expect(json.skipped).toBe(1);
  });

  // ── F2 (security review 2026-10-07): cooldown + daily cap ──────────────

  // H1 (security re-review #3, 2026-10-07): the cooldown 429 must carry a
  // DISTINCT body from the IP-rate-limit 429, so the client can tell "a
  // concurrent caller is already reading" (poll) apart from "you're being
  // throttled" (back off) instead of treating every 429 the same way.
  it("429s with a distinct { reason: 'cooldown', retryAfter } body when the same course was ingested recently", async () => {
    cooldownMock.mockReturnValue({ allowed: false, retryAfterSeconds: 42 });
    const res = await call({});
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json).toEqual({
      error: 'Reading already started a moment ago — try again in 42 seconds',
      reason: 'cooldown',
      retryAfter: 42,
    });
    expect(runCourseIngest).not.toHaveBeenCalled();
  });

  it('checks the cooldown using the resolved (stored) course code', async () => {
    await call({});
    expect(cooldownMock).toHaveBeenCalledWith('GC 1010');
  });

  it('503s when the daily cost cap is reached', async () => {
    capMock.mockResolvedValue({ ok: false });
    const res = await call({});
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe('daily cost cap reached');
    expect(runCourseIngest).not.toHaveBeenCalled();
  });

  it('does not consume the cooldown or cap checks on a 400 (invalid mode)', async () => {
    await call({ mode: 'bogus' });
    expect(cooldownMock).not.toHaveBeenCalled();
    expect(capMock).not.toHaveBeenCalled();
  });

  it('records the cooldown start (resolved code) right before calling runCourseIngest', async () => {
    await call({});
    expect(recordMock).toHaveBeenCalledWith('GC 1010');
    expect(runCourseIngest).toHaveBeenCalled();
  });

  it('does not record the cooldown when refused for another reason (IP rate limit)', async () => {
    rateMock.mockResolvedValue({ allowed: false });
    await call({});
    expect(recordMock).not.toHaveBeenCalled();
  });

  // ── G2 (security re-review 2026-10-07): resolve the stored course code
  // case-insensitively instead of blindly canonicalizing. GC 1010L (an
  // upper-case-suffix course on the live roster) must not be broken by a
  // path spelled with a different case.
  describe('resolves the stored course code case-insensitively', () => {
    it('GC%201010l resolves to the stored GC 1010L and that spelling reaches runCourseIngest', async () => {
      resolveMock.mockImplementation(async (code: string) =>
        code.toLowerCase() === 'gc 1010l' ? 'GC 1010L' : code);
      const res = await POST(reqFor('GC%201010l', {}), { params: Promise.resolve({ code: 'GC%201010l' }) });
      expect(res.status).toBe(200);
      expect(resolveMock).toHaveBeenCalledWith('GC 1010l');
      expect(runCourseIngest).toHaveBeenCalledWith('GC 1010L', { mode: 'hybrid' });
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
      expect(runCourseIngest).not.toHaveBeenCalled();
    });

    it('the cooldown is keyed by the resolved (stored) code too', async () => {
      resolveMock.mockImplementation(async (code: string) =>
        code.toLowerCase() === 'gc 1010l' ? 'GC 1010L' : code);
      await POST(reqFor('GC%201010l', {}), { params: Promise.resolve({ code: 'GC%201010l' }) });
      expect(cooldownMock).toHaveBeenCalledWith('GC 1010L');
      expect(recordMock).toHaveBeenCalledWith('GC 1010L');
    });

    it('an unknown course 404s before touching the cooldown or cap', async () => {
      resolveMock.mockResolvedValue(null);
      const res = await POST(reqFor('GC%209999', {}), { params: Promise.resolve({ code: 'GC%209999' }) });
      expect(res.status).toBe(404);
      expect(cooldownMock).not.toHaveBeenCalled();
      expect(capMock).not.toHaveBeenCalled();
      expect(runCourseIngest).not.toHaveBeenCalled();
    });
  });
});
