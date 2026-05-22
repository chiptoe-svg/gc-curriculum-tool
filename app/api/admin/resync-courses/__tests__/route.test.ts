import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/sheets/fetchSheet', () => ({
  fetchIndexCourseCodes: vi.fn(),
  fetchCourseTabCsv: vi.fn(),
}));
vi.mock('@/lib/sheets/parseCourseTab', () => ({
  parseCourseTab: vi.fn(),
}));
vi.mock('@/lib/db/courses-queries', () => ({
  upsertCourses: vi.fn(),
  recordSyncResult: vi.fn(),
}));
vi.mock('@/lib/slug', () => ({
  isValidSlug: (s: string) => s === 'valid-slug',
}));

import { POST } from '@/app/api/admin/resync-courses/route';
import { fetchIndexCourseCodes, fetchCourseTabCsv } from '@/lib/sheets/fetchSheet';
import { parseCourseTab } from '@/lib/sheets/parseCourseTab';
import { upsertCourses, recordSyncResult } from '@/lib/db/courses-queries';

const mockFetchCodes = fetchIndexCourseCodes as ReturnType<typeof vi.fn>;
const mockFetchCsv = fetchCourseTabCsv as ReturnType<typeof vi.fn>;
const mockParse = parseCourseTab as ReturnType<typeof vi.fn>;
const mockUpsert = upsertCourses as ReturnType<typeof vi.fn>;
const mockRecord = recordSyncResult as ReturnType<typeof vi.fn>;

const FAKE_PARSED = {
  code: 'GC 3460', title: 'Ink and Substrates', level: 3, track: 'Core',
  description: '', prerequisites: '', syllabusUrl: null,
  learningObjectives: [], majorProjects: [], skillsRequired: [],
};

function makeReq(body: unknown) {
  return new Request('http://x/api/admin/resync-courses', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.GOOGLE_SHEET_ID = 'test-sheet-id';
});

describe('POST /api/admin/resync-courses', () => {
  it('returns 401 for invalid slug', async () => {
    const res = await POST(makeReq({ slug: 'bad' }));
    expect(res.status).toBe(401);
  });

  it('syncs courses and returns count', async () => {
    mockFetchCodes.mockResolvedValue(['GC 3460']);
    mockFetchCsv.mockResolvedValue('csv-content');
    mockParse.mockReturnValue(FAKE_PARSED);
    mockUpsert.mockResolvedValue(1);
    mockRecord.mockResolvedValue(undefined);

    const res = await POST(makeReq({ slug: 'valid-slug' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.synced).toBe(1);
    expect(json.errors).toEqual([]);
    expect(typeof json.lastSyncedAt).toBe('string');
    expect(mockUpsert).toHaveBeenCalledWith([FAKE_PARSED]);
    expect(mockRecord).toHaveBeenCalledWith(1, []);
  });

  it('collects errors per course without aborting the whole sync', async () => {
    mockFetchCodes.mockResolvedValue(['GC 3460', 'GC 9999']);
    mockFetchCsv.mockResolvedValueOnce('good-csv').mockRejectedValueOnce(new Error('404 Not Found'));
    mockParse.mockReturnValue(FAKE_PARSED);
    mockUpsert.mockResolvedValue(1);
    mockRecord.mockResolvedValue(undefined);

    const res = await POST(makeReq({ slug: 'valid-slug' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.synced).toBe(1);
    expect(json.errors).toHaveLength(1);
    expect(json.errors[0]).toContain('GC 9999');
  });

  it('returns 500 if GOOGLE_SHEET_ID is missing', async () => {
    delete process.env.GOOGLE_SHEET_ID;
    const res = await POST(makeReq({ slug: 'valid-slug' }));
    expect(res.status).toBe(500);
  });
});
