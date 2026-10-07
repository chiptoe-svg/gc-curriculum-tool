// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLookupCatalogCourse = vi.fn();
const mockCourseExists = vi.fn();
const mockAdminAuth = vi.fn();

vi.mock('@/lib/auth/admin-auth', () => ({ checkAdminAuth: (...a: unknown[]) => mockAdminAuth(...a) }));
vi.mock('@/lib/db/courses-queries', () => ({ courseExists: (...a: unknown[]) => mockCourseExists(...a) }));
vi.mock('@/lib/curriculum/catalog-lookup', async () => {
  const actual = await vi.importActual<typeof import('@/lib/curriculum/catalog-lookup')>('@/lib/curriculum/catalog-lookup');
  return { ...actual, lookupCatalogCourse: (...a: unknown[]) => mockLookupCatalogCourse(...a) };
});

import { GET } from '../route';

function req(code?: string) {
  const url = code === undefined ? 'http://h/api/admin/access/catalog' : `http://h/api/admin/access/catalog?code=${encodeURIComponent(code)}`;
  return new Request(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockReturnValue(true);
  mockCourseExists.mockResolvedValue(false);
});

describe('GET /api/admin/access/catalog', () => {
  it('401s when the admin second factor fails', async () => {
    mockAdminAuth.mockReturnValue(false);
    const res = await GET(req('ECON 2120'));
    expect(res.status).toBe(401);
    expect(mockLookupCatalogCourse).not.toHaveBeenCalled();
  });

  it('400s when code is missing', async () => {
    const res = await GET(req());
    expect(res.status).toBe(400);
  });

  it('a catalog code returns found:true with the catalog title/description, with no-store', async () => {
    mockLookupCatalogCourse.mockResolvedValue({ code: 'ECON 2120', title: 'Principles of Macroeconomics', description: 'd', credits: '3' });
    const res = await GET(req('econ 2120'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const json = await res.json();
    expect(json).toEqual({ found: true, code: 'ECON 2120', title: 'Principles of Macroeconomics', description: 'd', onCourseList: false, baseCode: null, baseTitle: null });
  });

  it('a section code with no exact row falls back to the base code (found:false, baseCode/baseTitle set)', async () => {
    mockLookupCatalogCourse
      .mockResolvedValueOnce(null) // exact lookup for "GC 4900ap"
      .mockResolvedValueOnce({ code: 'GC 4900', title: 'Special Topics', description: null, credits: '3' }); // base lookup for "GC 4900"
    const res = await GET(req('GC 4900ap'));
    const json = await res.json();
    expect(json).toMatchObject({ found: false, code: 'GC 4900ap', title: null, baseCode: 'GC 4900', baseTitle: 'Special Topics' });
    expect(mockLookupCatalogCourse).toHaveBeenCalledWith('GC 4900ap');
    expect(mockLookupCatalogCourse).toHaveBeenCalledWith('GC 4900');
  });

  it('a genuinely unknown code returns found:false with no base', async () => {
    mockLookupCatalogCourse.mockResolvedValue(null);
    const res = await GET(req('ZZZZ 9999'));
    const json = await res.json();
    expect(json).toEqual({ found: false, code: 'ZZZZ 9999', title: null, description: null, onCourseList: false, baseCode: null, baseTitle: null });
  });

  it('reports onCourseList from the live roster', async () => {
    mockLookupCatalogCourse.mockResolvedValue({ code: 'GC 3730', title: 'Account Management', description: 'd', credits: '3' });
    mockCourseExists.mockResolvedValue(true);
    const res = await GET(req('GC 3730'));
    const json = await res.json();
    expect(json.onCourseList).toBe(true);
  });
});
