import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/admin-auth', () => ({ checkAdminAuth: () => true }));

const { runCourseReset } = vi.hoisted(() => ({ runCourseReset: vi.fn() }));
vi.mock('@/lib/capture/run-course-reset', () => ({ runCourseReset }));

import { POST } from '../route';

function req(body: unknown) {
  return new Request('http://x/api/admin/v2-reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/v2-reset delegates to runCourseReset', () => {
  beforeEach(() => {
    runCourseReset.mockReset().mockResolvedValue({ courseCode: 'GC 1010', scope: 'session' });
  });

  it('requires courseCode', async () => {
    const res = await POST(req({ slug: 's' }));
    expect(res.status).toBe(400);
    expect(runCourseReset).not.toHaveBeenCalled();
  });

  it('defaults scope to session', async () => {
    await POST(req({ courseCode: 'GC 1010', slug: 's' }));
    expect(runCourseReset).toHaveBeenCalledWith('GC 1010', { scope: 'session', includeSnapshots: false });
  });

  it('passes scope=everything and includeSnapshots through (operator-only, destructive)', async () => {
    await POST(req({ courseCode: 'GC 1010', slug: 's', scope: 'everything', includeSnapshots: true }));
    expect(runCourseReset).toHaveBeenCalledWith('GC 1010', { scope: 'everything', includeSnapshots: true });
  });

  it('returns the reset result', async () => {
    runCourseReset.mockResolvedValue({ courseCode: 'GC 1010', scope: 'session', workingDraftDeleted: 1 });
    const res = await POST(req({ courseCode: 'GC 1010', slug: 's' }));
    const json = await res.json();
    expect(json.workingDraftDeleted).toBe(1);
  });
});
