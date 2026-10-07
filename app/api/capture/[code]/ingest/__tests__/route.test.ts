import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/sandbox/access', () => ({ authorizeCourseWrite: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('@/lib/ip-hash', () => ({ hashIp: vi.fn().mockReturnValue('h') }));

const { runCourseIngest } = vi.hoisted(() => ({ runCourseIngest: vi.fn() }));
vi.mock('@/lib/capture/run-course-ingest', () => ({ runCourseIngest }));

import { POST } from '../route';
import { authorizeCourseWrite } from '@/lib/sandbox/access';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';

const authMock = authorizeCourseWrite as unknown as ReturnType<typeof vi.fn>;
const rateMock = checkIpRateLimit as unknown as ReturnType<typeof vi.fn>;

function req(body: unknown, slug = 's') {
  return new Request(`http://x/api/capture/GC%201010/ingest?slug=${slug}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function call(body: unknown, slug = 's') {
  return POST(req(body, slug), { params: Promise.resolve({ code: 'GC%201010' }) });
}

describe('POST /api/capture/[code]/ingest', () => {
  beforeEach(() => {
    authMock.mockReset().mockResolvedValue(true);
    rateMock.mockReset().mockResolvedValue({ allowed: true });
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
});
