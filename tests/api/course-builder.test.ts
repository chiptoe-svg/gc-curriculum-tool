import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getCourseByCode, updateBuilderStatus } = vi.hoisted(() => ({
  getCourseByCode: vi.fn(),
  updateBuilderStatus: vi.fn(),
}));
const { listMaterialsByCourse } = vi.hoisted(() => ({ listMaterialsByCourse: vi.fn() }));
const { getCourseKud, listKudRunsForCourse, resetKudApproval } = vi.hoisted(() => ({
  getCourseKud: vi.fn(),
  listKudRunsForCourse: vi.fn(),
  resetKudApproval: vi.fn(),
}));

vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode, updateBuilderStatus }));
vi.mock('@/lib/db/course-materials-queries', () => ({ listMaterialsByCourse }));
vi.mock('@/lib/db/course-kud-queries', () => ({ getCourseKud, listKudRunsForCourse, resetKudApproval }));
vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'valid-slug' }));
vi.mock('@/lib/db/client', () => ({
  db: { update: () => ({ set: () => ({ where: vi.fn().mockResolvedValue(undefined) }) }) },
}));
vi.mock('@/lib/db/schema', () => ({ courses: {} }));

import { GET } from '@/app/api/courses/[code]/builder/route';
import { PUT } from '@/app/api/courses/[code]/profile/route';

const ctx = { params: Promise.resolve({ code: 'GC%203460' }) };

const fakeCourse = {
  code: 'GC 3460',
  title: 'Ink and Substrates',
  level: 3,
  track: 'Print',
  description: 'Advanced print science.',
  prerequisites: 'GC 2070',
  syllabusUrl: null,
  learningObjectives: ['Understand ink formulation'],
  majorProjects: ['Brand Color Report'],
  skillsRequired: ['Color theory'],
  lastSyncedAt: new Date(),
  builderStatus: 'profile_complete',
};

beforeEach(() => {
  vi.clearAllMocks();
  listMaterialsByCourse.mockResolvedValue([]);
  getCourseKud.mockResolvedValue(null);
  listKudRunsForCourse.mockResolvedValue([]);
  updateBuilderStatus.mockResolvedValue(undefined);
  resetKudApproval.mockResolvedValue(undefined);
});

describe('GET /api/courses/[code]/builder', () => {
  it('401s on invalid slug', async () => {
    const req = new Request('http://test/api/courses/GC%203460/builder?slug=bad');
    const res = await GET(req, ctx);
    expect(res.status).toBe(401);
  });

  it('404s when course not found', async () => {
    getCourseByCode.mockResolvedValue(null);
    const req = new Request('http://test/api/courses/GC%203460/builder?slug=valid-slug');
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });

  it('returns full builder state with 200', async () => {
    getCourseByCode.mockResolvedValue(fakeCourse);
    const req = new Request('http://test/api/courses/GC%203460/builder?slug=valid-slug');
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.course.code).toBe('GC 3460');
    expect(body.course.builderStatus).toBe('profile_complete');
    expect(body.kud.current).toBeNull();
    expect(body.materials).toEqual([]);
  });
});

describe('PUT /api/courses/[code]/profile', () => {
  function makeReq(body: unknown, slug = 'valid-slug') {
    return new Request(`http://test/api/courses/GC%203460/profile?slug=${slug}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('401s on invalid slug', async () => {
    const res = await PUT(makeReq({}, 'bad'), ctx);
    expect(res.status).toBe(401);
  });

  it('400s on invalid body', async () => {
    getCourseByCode.mockResolvedValue(fakeCourse);
    const res = await PUT(makeReq({ invalid: true }), ctx);
    expect(res.status).toBe(400);
  });

  it('advances status to profile_complete when all fields have content', async () => {
    getCourseByCode.mockResolvedValue(fakeCourse);
    const res = await PUT(makeReq({
      learningObjectives: ['obj1'],
      majorProjects: ['proj1'],
      skillsRequired: ['skill1'],
    }), ctx);
    expect(res.status).toBe(200);
    expect(updateBuilderStatus).toHaveBeenCalledWith('GC 3460', 'profile_complete');
  });

  it('resets approval and clears approved_at when course was approved', async () => {
    getCourseByCode.mockResolvedValue({ ...fakeCourse, builderStatus: 'approved' });
    const res = await PUT(makeReq({
      learningObjectives: ['obj1'],
      majorProjects: ['proj1'],
      skillsRequired: ['skill1'],
    }), ctx);
    expect(res.status).toBe(200);
    expect(resetKudApproval).toHaveBeenCalledWith('GC 3460');
    expect(updateBuilderStatus).toHaveBeenCalledWith('GC 3460', 'profile_complete');
  });
});
