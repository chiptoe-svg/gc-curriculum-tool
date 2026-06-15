import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'valid-slug' }));
const mockGetCourse = vi.fn();
const mockClearProv = vi.fn();
vi.mock('@/lib/db/courses-queries', () => ({
  getCourseByCode: (...a: unknown[]) => mockGetCourse(...a),
  clearCourseCanvasImport: (...a: unknown[]) => mockClearProv(...a),
}));
const mockList = vi.fn();
const mockDelete = vi.fn();
vi.mock('@/lib/db/course-materials-queries', () => ({
  insertMaterial: vi.fn(),
  listMaterialsByCourse: (...a: unknown[]) => mockList(...a),
  deleteMaterial: (...a: unknown[]) => mockDelete(...a),
}));
const mockDeleteByMaterial = vi.fn();
vi.mock('@/lib/capture/vector-store', () => ({
  createVectorStore: () => ({ deleteByMaterial: (...a: unknown[]) => mockDeleteByMaterial(...a) }),
  tenantForCourse: (c: string) => `tenant:${c}`,
}));
const mockDeleteLocal = vi.fn();
vi.mock('@/lib/storage/local-storage', () => ({
  putLocal: vi.fn(), courseSlug: (c: string) => c, safeFilename: (f: string) => f,
  keyFromLocalUrl: (url: string) => (url.startsWith('local:') ? url.slice(6) : null),
  deleteLocal: (...a: unknown[]) => mockDeleteLocal(...a),
}));
vi.mock('@/lib/ip-hash', () => ({ hashIp: () => 'h' }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit: vi.fn() }));
vi.mock('@/lib/rate-limit/daily-cap', () => ({ checkDailyCap: vi.fn(), recordSpend: vi.fn() }));
vi.mock('@/lib/capture/finalize-extraction', () => ({ finalizeExtraction: vi.fn() }));
vi.mock('@/lib/courses/extract-text', () => ({ extractText: vi.fn() }));
vi.mock('@/lib/courses/material-extractor', () => ({ SUPPORTED_MIME_TYPES: [], LEGACY_OFFICE_MIME_TYPES: [] }));

import { DELETE } from '../route';

function req(slug = 'valid-slug') {
  return [
    new Request(`http://h/api/courses/GC%201010/materials?slug=${slug}`, { method: 'DELETE' }),
    { params: Promise.resolve({ code: 'GC 1010' }) },
  ] as const;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockGetCourse.mockResolvedValue({ code: 'GC 1010' });
  mockList.mockResolvedValue([
    { id: 'm1', blobUrl: 'local:key1' },
    { id: 'm2', blobUrl: 'canvas:passthrough' },
  ]);
  mockDeleteByMaterial.mockResolvedValue(undefined);
  mockDeleteLocal.mockResolvedValue(undefined);
  mockDelete.mockResolvedValue(undefined);
  mockClearProv.mockResolvedValue(undefined);
});

describe('DELETE /api/courses/[code]/materials (wipe all)', () => {
  it('rejects an invalid slug', async () => {
    const [r, ctx] = req('bad');
    const res = await DELETE(r, ctx);
    expect(res.status).toBe(401);
  });

  it('404s when the course is missing', async () => {
    mockGetCourse.mockResolvedValue(null);
    const [r, ctx] = req();
    const res = await DELETE(r, ctx);
    expect(res.status).toBe(404);
  });

  it('deletes every material (chunks + row), clears provenance, returns count', async () => {
    const [r, ctx] = req();
    const res = await DELETE(r, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 2 });
    // both materials: vector chunks cleared in the course tenant
    expect(mockDeleteByMaterial).toHaveBeenCalledWith('tenant:GC 1010', 'm1');
    expect(mockDeleteByMaterial).toHaveBeenCalledWith('tenant:GC 1010', 'm2');
    // only the local-stored one triggers a file delete
    expect(mockDeleteLocal).toHaveBeenCalledTimes(1);
    expect(mockDeleteLocal).toHaveBeenCalledWith('key1');
    // rows deleted + provenance cleared
    expect(mockDelete).toHaveBeenCalledTimes(2);
    expect(mockClearProv).toHaveBeenCalledWith('GC 1010');
  });
});
