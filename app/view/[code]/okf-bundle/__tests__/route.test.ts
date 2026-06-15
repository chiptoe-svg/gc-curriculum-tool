import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetCourse = vi.fn();
const mockGetSnapshot = vi.fn();
const mockGetMessages = vi.fn();
const mockListMaterials = vi.fn();
vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode: (...a: unknown[]) => mockGetCourse(...a) }));
vi.mock('@/lib/db/capture-snapshots-queries', () => ({ getLatestSnapshotByCourse: (...a: unknown[]) => mockGetSnapshot(...a) }));
vi.mock('@/lib/db/capture-messages-queries', () => ({ getSessionMessages: (...a: unknown[]) => mockGetMessages(...a) }));
vi.mock('@/lib/db/course-materials-queries', () => ({ listMaterialsByCourse: (...a: unknown[]) => mockListMaterials(...a) }));

const mockReadable = vi.fn();
vi.mock('@/lib/sandbox/access', () => ({ isCourseReadableBy: (...a: unknown[]) => mockReadable(...a) }));

import { GET } from '../route';

function req(code = 'GC 2400') {
  return [
    new Request(`http://host/view/${encodeURIComponent(code)}/okf-bundle`),
    { params: Promise.resolve({ code: encodeURIComponent(code) }) },
  ] as const;
}

const VISIBLE_COURSE = { code: 'GC 2400', title: 'Intro', prefix: 'GC', level: 2400, track: null, buildsToCareer: false, catalogUrl: null, scope: 'gc', status: 'offered' };
const SANDBOX_COURSE = { ...VISIBLE_COURSE, status: 'sandbox' };
const SNAPSHOT = { id: 'snap-1', createdAt: new Date('2026-06-15T00:00:00.000Z'), instructorName: 'Dr. X', transcriptSessionId: 'sess-1', profile: { scale_version: 'v1', overview: 'A course.', competencies: [], revised_objectives_draft: [], incoming_expectations: [] } };

beforeEach(() => {
  vi.resetAllMocks();
  mockGetCourse.mockResolvedValue(VISIBLE_COURSE);
  mockGetSnapshot.mockResolvedValue(SNAPSHOT);
  mockGetMessages.mockResolvedValue([{ role: 'user', content: 'Hi from Dr. X' }]);
  mockListMaterials.mockResolvedValue([]);
  mockReadable.mockResolvedValue(true);
});

describe('GET /view/[code]/okf-bundle', () => {
  it('returns a zip for a visible course with a snapshot', async () => {
    const [r, ctx] = req();
    const res = await GET(r, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toContain('gc-2400-okf-bundle.zip');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('404s when no snapshot exists', async () => {
    mockGetSnapshot.mockResolvedValue(null);
    const [r, ctx] = req();
    expect((await GET(r, ctx)).status).toBe(404);
  });

  it('404s when the course is not readable (no scoped session)', async () => {
    mockGetCourse.mockResolvedValue(SANDBOX_COURSE);
    mockReadable.mockResolvedValue(false);
    const [r, ctx] = req();
    expect((await GET(r, ctx)).status).toBe(404);
  });

  it('200s for a sandbox course with a bound scoped session', async () => {
    mockGetCourse.mockResolvedValue(SANDBOX_COURSE);
    mockReadable.mockResolvedValue(true);
    const [r, ctx] = req();
    const res = await GET(r, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
  });
});
