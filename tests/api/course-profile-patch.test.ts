import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/course-profile-queries', () => ({
  updateProfileFromEdit: vi.fn(),
}));

vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'valid-slug-12345' }));

import { PATCH } from '@/app/api/courses/[code]/profile/route';
import * as courseProfileQueries from '@/lib/db/course-profile-queries';

const updateProfileFromEdit = vi.mocked(courseProfileQueries.updateProfileFromEdit);

beforeEach(() => {
  vi.clearAllMocks();
  updateProfileFromEdit.mockResolvedValue(undefined);
});

function makeReq(body: unknown, slug = 'valid-slug-12345'): Request {
  return new Request(`http://test/api/courses/GC%201010/profile?slug=${slug}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  summary: 'A course about printing.',
  learningObjectives: ['Understand color theory'],
  skills: ['RIP software'],
  competencies: [
    {
      name: 'Color Management',
      description: 'Ability to manage color profiles',
      level: 'developed',
      evidence: [{ fileName: 'rubric.pdf', quote: 'Students will profile a press.' }],
    },
  ],
};

describe('PATCH /api/courses/[code]/profile', () => {
  it('401s on missing or invalid slug', async () => {
    const res = await PATCH(
      makeReq(validBody, 'wrong'),
      { params: Promise.resolve({ code: 'GC%201010' }) }
    );
    expect(res.status).toBe(401);
    expect(updateProfileFromEdit).not.toHaveBeenCalled();
  });

  it('400s on invalid JSON body', async () => {
    const req = new Request('http://test/api/courses/GC%201010/profile?slug=valid-slug-12345', {
      method: 'PATCH',
      body: 'not-json',
    });
    const res = await PATCH(req, { params: Promise.resolve({ code: 'GC%201010' }) });
    expect(res.status).toBe(400);
  });

  it('400s when required fields are missing', async () => {
    const res = await PATCH(
      makeReq({ summary: 'hi' }),
      { params: Promise.resolve({ code: 'GC%201010' }) }
    );
    expect(res.status).toBe(400);
  });

  it('persists profile with manuallyEdited=true and returns 200', async () => {
    const res = await PATCH(
      makeReq(validBody),
      { params: Promise.resolve({ code: 'GC%201010' }) }
    );
    expect(res.status).toBe(200);
    expect(updateProfileFromEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        courseCode: 'GC 1010',
        summary: 'A course about printing.',
        learningObjectives: ['Understand color theory'],
        skills: ['RIP software'],
      })
    );
  });

  it('URL-decodes the course code before persisting', async () => {
    const res = await PATCH(
      makeReq(validBody),
      { params: Promise.resolve({ code: 'GC%204060ap' }) }
    );
    expect(res.status).toBe(200);
    expect(updateProfileFromEdit).toHaveBeenCalledWith(
      expect.objectContaining({ courseCode: 'GC 4060ap' })
    );
  });

  it('500s when updateProfileFromEdit throws', async () => {
    updateProfileFromEdit.mockRejectedValueOnce(new Error('db down'));
    const res = await PATCH(
      makeReq(validBody),
      { params: Promise.resolve({ code: 'GC%201010' }) }
    );
    expect(res.status).toBe(500);
  });
});
