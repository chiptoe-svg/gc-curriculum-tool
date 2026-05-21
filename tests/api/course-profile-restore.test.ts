import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getRunById, upsertCourseProfile } = vi.hoisted(() => ({
  getRunById: vi.fn(),
  upsertCourseProfile: vi.fn(),
}));
vi.mock('@/lib/db/course-profile-queries', () => ({ getRunById, upsertCourseProfile }));
vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'valid-slug' }));

import { POST } from '@/app/api/courses/[code]/profile/restore/[runId]/route';

function makeReq(slug = 'valid-slug') {
  return new Request(`http://test/api/courses/GC%201010/profile/restore/run-1?slug=${slug}`, {
    method: 'POST',
  });
}

const fakeRun = {
  id: 'run-1',
  courseCode: 'GC 1010',
  result: {
    summary: 'Old profile.',
    learningObjectives: ['obj1'],
    skills: ['skill1'],
    competencies: [],
    catalogDivergence: { reinforced: [], additions: [], gaps: [] },
  },
  materialCount: 2,
  model: 'gpt-5.4-mini',
  costUsdCents: 25,
  createdAt: new Date('2026-05-20T10:00:00Z'),
};

const ctx = {
  params: Promise.resolve({ code: 'GC%201010', runId: 'run-1' }),
};

beforeEach(() => {
  vi.clearAllMocks();
  upsertCourseProfile.mockResolvedValue(undefined);
});

describe('POST /api/courses/[code]/profile/restore/[runId]', () => {
  it('401s on invalid slug', async () => {
    const res = await POST(makeReq('bad'), ctx);
    expect(res.status).toBe(401);
    expect(getRunById).not.toHaveBeenCalled();
  });

  it('404s when run not found', async () => {
    getRunById.mockResolvedValue(null);
    const res = await POST(makeReq(), ctx);
    expect(res.status).toBe(404);
  });

  it('403s when run.courseCode does not match the URL code', async () => {
    getRunById.mockResolvedValue({ ...fakeRun, courseCode: 'GC 9999' });
    const res = await POST(makeReq(), ctx);
    expect(res.status).toBe(403);
  });

  it('restores the profile and returns 200', async () => {
    getRunById.mockResolvedValue(fakeRun);
    const res = await POST(makeReq(), ctx);
    expect(res.status).toBe(200);
    expect(upsertCourseProfile).toHaveBeenCalledWith({
      courseCode: 'GC 1010',
      result: fakeRun.result,
      runId: 'run-1',
    });
  });

  it('500s when upsertCourseProfile throws', async () => {
    getRunById.mockResolvedValue(fakeRun);
    upsertCourseProfile.mockRejectedValueOnce(new Error('db error'));
    const res = await POST(makeReq(), ctx);
    expect(res.status).toBe(500);
  });
});
