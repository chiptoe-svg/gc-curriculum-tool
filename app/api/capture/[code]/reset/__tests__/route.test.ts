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

function req(body: unknown, slug = 's') {
  return new Request(`http://x/api/capture/GC%201010/reset?slug=${slug}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
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

  it('passes scope and includeSnapshots through', async () => {
    await call({ scope: 'materials', includeSnapshots: true });
    expect(runCourseReset).toHaveBeenCalledWith('GC 1010', { scope: 'materials', includeSnapshots: true });
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
});
