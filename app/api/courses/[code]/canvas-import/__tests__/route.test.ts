import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'valid-slug' }));
vi.mock('@/lib/ip-hash', () => ({ hashIp: () => 'test-hash' }));
vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode: vi.fn() }));
vi.mock('@/lib/db/course-materials-queries', () => ({
  insertMaterial: vi.fn(),
  updateExtractionResult: vi.fn(),
}));
vi.mock('@/lib/canvas/fetchCanvasCourse', () => ({
  fetchCanvasCourse: vi.fn(),
}));
vi.mock('@/lib/canvas/htmlToText', () => ({
  htmlToText: (s: string) => s.replace(/<[^>]+>/g, '').trim(),
}));

import { POST } from '@/app/api/courses/[code]/canvas-import/route';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { insertMaterial, updateExtractionResult } from '@/lib/db/course-materials-queries';
import { fetchCanvasCourse } from '@/lib/canvas/fetchCanvasCourse';

const mockGetCourse = getCourseByCode as ReturnType<typeof vi.fn>;
const mockInsert = insertMaterial as ReturnType<typeof vi.fn>;
const mockUpdate = updateExtractionResult as ReturnType<typeof vi.fn>;
const mockFetch = fetchCanvasCourse as ReturnType<typeof vi.fn>;

const FAKE_COURSE = {
  code: 'GC 3460', title: 'Ink and Substrates', level: 3, track: 'Core',
  description: '', prerequisites: '', syllabusUrl: null,
  learningObjectives: [], majorProjects: [], skillsRequired: [],
  builderStatus: 'draft', lastSyncedAt: new Date(),
};

const CANVAS_DATA = {
  course: { id: '12345', name: 'Ink and Substrates', syllabusHtml: '<p>Course syllabus content here.</p>' },
  assignments: [
    { id: '1', name: 'Substrate Analysis', descriptionHtml: '<p>Analyze substrates.</p>', pointsPossible: 100 },
  ],
  modules: [
    { id: '1', name: 'Week 1', items: [{ title: 'Intro', type: 'Page' }] },
  ],
};

function makeReq(body: unknown, code = 'GC 3460') {
  return [
    new Request('http://x/api/courses/GC%203460/canvas-import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ code }) },
  ] as const;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockInsert.mockResolvedValue({ id: 'mat-1' });
  mockUpdate.mockResolvedValue(undefined);
});

describe('POST /api/courses/[code]/canvas-import', () => {
  it('returns 401 for invalid slug', async () => {
    const [req, ctx] = makeReq({ slug: 'bad', canvasUrl: 'https://clemson.instructure.com/courses/12345', canvasToken: 'tok' });
    const res = await POST(req, ctx);
    expect(res.status).toBe(401);
  });

  it('returns 400 for missing canvasUrl', async () => {
    mockGetCourse.mockResolvedValue(FAKE_COURSE);
    const [req, ctx] = makeReq({ slug: 'valid-slug', canvasUrl: '', canvasToken: 'tok' });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
  });

  it('returns 400 for unparseable Canvas URL', async () => {
    mockGetCourse.mockResolvedValue(FAKE_COURSE);
    const [req, ctx] = makeReq({ slug: 'valid-slug', canvasUrl: 'https://clemson.instructure.com/not-a-course', canvasToken: 'tok' });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown course code', async () => {
    mockGetCourse.mockResolvedValue(null);
    const [req, ctx] = makeReq({ slug: 'valid-slug', canvasUrl: 'https://clemson.instructure.com/courses/12345', canvasToken: 'tok' });
    const res = await POST(req, ctx);
    expect(res.status).toBe(404);
  });

  it('inserts materials and returns imported list', async () => {
    mockGetCourse.mockResolvedValue(FAKE_COURSE);
    mockFetch.mockResolvedValue(CANVAS_DATA);
    mockInsert
      .mockResolvedValueOnce({ id: 'mat-1' })
      .mockResolvedValueOnce({ id: 'mat-2' })
      .mockResolvedValueOnce({ id: 'mat-3' });

    const [req, ctx] = makeReq({ slug: 'valid-slug', canvasUrl: 'https://clemson.instructure.com/courses/12345', canvasToken: 'tok' });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.imported).toBeGreaterThanOrEqual(1);
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'Canvas: Syllabus' }));
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ extractionStatus: 'ok' }));
  });
});
