// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAdminAuth = vi.fn();
const mockCourseExists = vi.fn();
const mockCreateCourse = vi.fn();
const mockUpdateCourseClassification = vi.fn();
const mockLookupCatalogCourse = vi.fn();

vi.mock('@/lib/auth/admin-auth', () => ({ checkAdminAuth: (...a: unknown[]) => mockAdminAuth(...a) }));
vi.mock('@/lib/db/courses-queries', () => ({
  courseExists: (...a: unknown[]) => mockCourseExists(...a),
  createCourse: (...a: unknown[]) => mockCreateCourse(...a),
  updateCourseClassification: (...a: unknown[]) => mockUpdateCourseClassification(...a),
}));
vi.mock('@/lib/curriculum/catalog-lookup', async () => {
  const actual = await vi.importActual<typeof import('@/lib/curriculum/catalog-lookup')>('@/lib/curriculum/catalog-lookup');
  return { ...actual, lookupCatalogCourse: (...a: unknown[]) => mockLookupCatalogCourse(...a) };
});

import { POST } from '../route';

function req(body: Record<string, unknown>, contentType = 'application/json') {
  return new Request('http://h/api/admin/access/courses', { method: 'POST', headers: { 'content-type': contentType }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockReturnValue(true);
  mockCourseExists.mockResolvedValue(false);
  mockLookupCatalogCourse.mockResolvedValue(null);
  mockCreateCourse.mockResolvedValue(undefined);
  mockUpdateCourseClassification.mockResolvedValue(true);
});

describe('POST /api/admin/access/courses', () => {
  it('415s a non-JSON content-type, before even checking auth (fix round 1 protection, applied here too)', async () => {
    const res = await POST(req({ code: 'ENTR 4080', title: 'Family Business' }, 'text/plain'));
    expect(res.status).toBe(415);
    expect(mockAdminAuth).not.toHaveBeenCalled();
    expect(mockCreateCourse).not.toHaveBeenCalled();
  });

  it('401s when the admin second factor fails, and never creates', async () => {
    mockAdminAuth.mockReturnValue(false);
    const res = await POST(req({ code: 'ENTR 4080', title: 'Family Business' }));
    expect(res.status).toBe(401);
    expect(mockCreateCourse).not.toHaveBeenCalled();
  });

  it('400s when code is missing', async () => {
    const res = await POST(req({ title: 'Family Business' }));
    expect(res.status).toBe(400);
    expect(mockCreateCourse).not.toHaveBeenCalled();
  });

  it('409s when the code is already on the course list', async () => {
    mockCourseExists.mockResolvedValue(true);
    const res = await POST(req({ code: 'GC 3730', title: 'Account Management' }));
    expect(res.status).toBe(409);
    expect(mockCreateCourse).not.toHaveBeenCalled();
  });

  it('uses the catalog title even if a different one is supplied, for a catalog code', async () => {
    mockLookupCatalogCourse.mockResolvedValue({ code: 'ECON 2120', title: 'Principles of Macroeconomics', description: 'd', credits: '3' });
    const res = await POST(req({ code: 'econ 2120', title: 'My Own Title' }));
    expect(res.status).toBe(200);
    expect(mockCreateCourse).toHaveBeenCalledWith(expect.objectContaining({ code: 'ECON 2120', title: 'Principles of Macroeconomics' }));
  });

  it('requires a title for a non-catalog (section or unknown) code', async () => {
    const res = await POST(req({ code: 'ENTR 4080' }));
    expect(res.status).toBe(400);
    expect(mockCreateCourse).not.toHaveBeenCalled();
  });

  it('400s on a control character in a supplied title', async () => {
    const res = await POST(req({ code: 'ENTR 4080', title: 'A\u0000B' }));
    expect(res.status).toBe(400);
    expect(mockCreateCourse).not.toHaveBeenCalled();
  });

  it('creates a non-catalog code with the supplied title, default category other, level from the code', async () => {
    const res = await POST(req({ code: 'ENTR 4080', title: 'Family Business' }));
    expect(res.status).toBe(200);
    expect(mockCreateCourse).toHaveBeenCalledWith(expect.objectContaining({ code: 'ENTR 4080', title: 'Family Business', level: 4 }));
    expect(mockUpdateCourseClassification).not.toHaveBeenCalled(); // 'other' is the DB default; no extra write needed
    const json = await res.json() as { code: string; title: string; category: string };
    expect(json).toMatchObject({ code: 'ENTR 4080', title: 'Family Business', category: 'other' });
  });

  it('sets a non-default category via updateCourseClassification', async () => {
    const res = await POST(req({ code: 'ENTR 4080', title: 'Family Business', category: 'major_req' }));
    expect(res.status).toBe(200);
    expect(mockUpdateCourseClassification).toHaveBeenCalledWith('ENTR 4080', { category: 'major_req' });
  });

  it('400s on an unknown category', async () => {
    const res = await POST(req({ code: 'ENTR 4080', title: 'Family Business', category: 'nonsense' }));
    expect(res.status).toBe(400);
    expect(mockCreateCourse).not.toHaveBeenCalled();
  });

  it('400s on every malformed code shape the review demonstrated creating a row (fix round 2, N2)', async () => {
    for (const code of ['*', 'GC 1010/../ADMIN', 'AB\u00001234', '<SCRIPT>ALERT(1)</SCRIPT>', 'Q'.repeat(10000), '%E0%A4%A']) {
      const res = await POST(req({ code, title: 'Whatever' }));
      expect(res.status).toBe(400);
    }
    expect(mockCreateCourse).not.toHaveBeenCalled();
  });

  it('canonicalizes a section suffix to lower-case, matching the live data convention (fix round 2, N3)', async () => {
    const res = await POST(req({ code: 'gc 4900AP', title: 'Special Topics' }));
    expect(res.status).toBe(200);
    expect(mockCourseExists).toHaveBeenCalledWith('GC 4900ap');
    expect(mockCreateCourse).toHaveBeenCalledWith(expect.objectContaining({ code: 'GC 4900ap' }));
  });

  it('detects a case-variant duplicate of an existing section code as already on the list (fix round 2, N3)', async () => {
    // courseExists is mocked exact-match like real PG `=`; the duplicate is
    // only caught because the route canonicalizes BEFORE calling it.
    mockCourseExists.mockImplementation(async (code: string) => code === 'GC 4900ap');
    const res = await POST(req({ code: 'GC 4900AP', title: 'Special Topics' }));
    expect(res.status).toBe(409);
    expect(mockCreateCourse).not.toHaveBeenCalled();
  });
});
