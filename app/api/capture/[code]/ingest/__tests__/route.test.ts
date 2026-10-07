import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/sandbox/access', () => ({ authorizeCourseWrite: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('@/lib/ip-hash', () => ({ hashIp: vi.fn().mockReturnValue('h') }));
vi.mock('@/lib/rate-limit/daily-cap', () => ({ checkDailyCap: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock('@/lib/capture/ingest-cooldown', () => ({
  checkIngestCooldown: vi.fn().mockReturnValue({ allowed: true }),
  recordIngestStart: vi.fn(),
}));

const { runCourseIngest } = vi.hoisted(() => ({ runCourseIngest: vi.fn() }));
vi.mock('@/lib/capture/run-course-ingest', () => ({ runCourseIngest }));

import { POST } from '../route';
import { authorizeCourseWrite } from '@/lib/sandbox/access';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap } from '@/lib/rate-limit/daily-cap';
import { checkIngestCooldown, recordIngestStart } from '@/lib/capture/ingest-cooldown';

const authMock = authorizeCourseWrite as unknown as ReturnType<typeof vi.fn>;
const rateMock = checkIpRateLimit as unknown as ReturnType<typeof vi.fn>;
const capMock = checkDailyCap as unknown as ReturnType<typeof vi.fn>;
const cooldownMock = checkIngestCooldown as unknown as ReturnType<typeof vi.fn>;
const recordMock = recordIngestStart as unknown as ReturnType<typeof vi.fn>;

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

  it('429s when the IP rate limit is exceeded', async () => {
    rateMock.mockResolvedValue({ allowed: false });
    const res = await call({});
    expect(res.status).toBe(429);
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

  it('404s when the course does not exist', async () => {
    runCourseIngest.mockResolvedValue(null);
    const res = await call({});
    expect(res.status).toBe(404);
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

  it('429s with a cooldown message when the same course was ingested recently', async () => {
    cooldownMock.mockReturnValue({ allowed: false, retryAfterSeconds: 42 });
    const res = await call({});
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toBe('Reading already started a moment ago — try again in 42 seconds');
    expect(runCourseIngest).not.toHaveBeenCalled();
  });

  it('checks the cooldown using the canonical course code', async () => {
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

  it('records the cooldown start (canonical code) right before calling runCourseIngest', async () => {
    await call({});
    expect(recordMock).toHaveBeenCalledWith('GC 1010');
    expect(runCourseIngest).toHaveBeenCalled();
  });

  it('does not record the cooldown when refused for another reason (IP rate limit)', async () => {
    rateMock.mockResolvedValue({ allowed: false });
    await call({});
    expect(recordMock).not.toHaveBeenCalled();
  });

  // ── F4 (security review 2026-10-07): canonicalize the path code ────────

  describe('canonicalizes the path course code before use', () => {
    it('GC%204900AP canonicalizes to GC 4900ap before calling runCourseIngest', async () => {
      const res = await POST(reqFor('GC%204900AP', {}), { params: Promise.resolve({ code: 'GC%204900AP' }) });
      expect(res.status).toBe(200);
      expect(runCourseIngest).toHaveBeenCalledWith('GC 4900ap', { mode: 'hybrid' });
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
      expect(runCourseIngest).not.toHaveBeenCalled();
    });

    it('the cooldown is keyed by the canonical code too', async () => {
      await POST(reqFor('GC%204900AP', {}), { params: Promise.resolve({ code: 'GC%204900AP' }) });
      expect(cooldownMock).toHaveBeenCalledWith('GC 4900ap');
      expect(recordMock).toHaveBeenCalledWith('GC 4900ap');
    });
  });
});
