import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  isValidSlug,
  getCourseByCode,
  put,
  del,
  insertMaterial,
  updateExtractionResult,
  getMaterialById,
  deleteMaterial,
  listMaterialsByCourse,
  extractText,
  checkIpRateLimit,
  checkDailyCap,
  recordSpend,
  hashIp,
} = vi.hoisted(() => ({
  isValidSlug: vi.fn(),
  getCourseByCode: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  insertMaterial: vi.fn(),
  updateExtractionResult: vi.fn(),
  getMaterialById: vi.fn(),
  deleteMaterial: vi.fn(),
  listMaterialsByCourse: vi.fn(),
  extractText: vi.fn(),
  checkIpRateLimit: vi.fn(),
  checkDailyCap: vi.fn(),
  recordSpend: vi.fn(),
  hashIp: vi.fn(),
}));

vi.mock('@/lib/slug', () => ({ isValidSlug }));
vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode }));
vi.mock('@vercel/blob', () => ({ put, del }));
vi.mock('@/lib/db/course-materials-queries', () => ({
  insertMaterial,
  updateExtractionResult,
  getMaterialById,
  deleteMaterial,
  listMaterialsByCourse,
}));
vi.mock('@/lib/courses/extract-text', () => ({ extractText }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit }));
vi.mock('@/lib/rate-limit/daily-cap', () => ({ checkDailyCap, recordSpend }));
vi.mock('@/lib/ip-hash', () => ({ hashIp }));

import { POST } from '@/app/api/courses/[code]/materials/route';
import { DELETE } from '@/app/api/courses/[code]/materials/[id]/route';

const SLUG = 'valid-slug-12345';
const CODE = 'GC 3460';

function makeUploadReq(overrides: {
  slug?: string;
  code?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  body?: Uint8Array;
} = {}): [Request, { params: Promise<{ code: string }> }] {
  const {
    slug = SLUG,
    fileName = 'rubric.pdf',
    mimeType = 'application/pdf',
    sizeBytes = 100_000,
    body = new Uint8Array(100),
  } = overrides;
  const file = new File([body.buffer as ArrayBuffer], fileName, { type: mimeType });
  const form = new FormData();
  form.set('slug', slug);
  form.set('file', file);
  const req = new Request('http://test/api/courses/GC%203460/materials', {
    method: 'POST',
    body: form,
  });
  // Override Content-Length header for size checks by adding it to the file's size
  Object.defineProperty(file, 'size', { value: sizeBytes });
  return [req, { params: Promise.resolve({ code: overrides.code ?? CODE }) }];
}

function makeDeleteReq(slug: string, materialId: string): [Request, { params: Promise<{ code: string; id: string }> }] {
  const req = new Request(`http://test/api/courses/GC%203460/materials/${materialId}?slug=${encodeURIComponent(slug)}`, {
    method: 'DELETE',
  });
  return [req, { params: Promise.resolve({ code: CODE, id: materialId }) }];
}

beforeEach(() => {
  vi.clearAllMocks();
  isValidSlug.mockImplementation((s: string) => s === SLUG);
  getCourseByCode.mockResolvedValue({ code: CODE, title: 'Digital Publishing' });
  put.mockResolvedValue({ url: 'https://blob.vercel-storage.com/rubric.pdf' });
  insertMaterial.mockResolvedValue({ id: 'mat-1', courseCode: CODE, fileName: 'rubric.pdf', blobUrl: 'https://blob.vercel-storage.com/rubric.pdf', extractionStatus: 'pending' });
  updateExtractionResult.mockResolvedValue(undefined);
  checkIpRateLimit.mockResolvedValue({ allowed: true, remaining: 9 });
  checkDailyCap.mockResolvedValue({ ok: true, spentCents: 0 });
  recordSpend.mockResolvedValue(undefined);
  hashIp.mockReturnValue('abc123hash');
  extractText.mockResolvedValue({ method: 'text', status: 'ok', text: 'Rubric content here.' });
});

describe('POST /api/courses/[code]/materials', () => {
  it('returns 401 on invalid slug', async () => {
    const [req, ctx] = makeUploadReq({ slug: 'wrong' });
    const res = await POST(req, ctx);
    expect(res.status).toBe(401);
  });

  it('returns 404 when course not found', async () => {
    getCourseByCode.mockResolvedValue(null);
    const [req, ctx] = makeUploadReq();
    const res = await POST(req, ctx);
    expect(res.status).toBe(404);
  });

  it('returns 429 when IP rate-limited', async () => {
    checkIpRateLimit.mockResolvedValue({ allowed: false, remaining: 0 });
    const [req, ctx] = makeUploadReq();
    const res = await POST(req, ctx);
    expect(res.status).toBe(429);
  });

  it('returns 400 on unsupported MIME type', async () => {
    const [req, ctx] = makeUploadReq({ mimeType: 'image/jpeg' });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/mime/i);
  });

  it('returns 400 when no file is attached', async () => {
    // Build a form without a file field.
    const form = new FormData();
    form.set('slug', SLUG);
    const req = new Request('http://test/api/courses/GC%203460/materials', { method: 'POST', body: form });
    const res = await POST(req, { params: Promise.resolve({ code: CODE }) });
    expect(res.status).toBe(400);
  });

  it('uploads to Blob, inserts row, runs extraction, returns 200 with status', async () => {
    const [req, ctx] = makeUploadReq();
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe('mat-1');
    expect(json.extractionStatus).toBe('ok');
    expect(put).toHaveBeenCalledOnce();
    expect(insertMaterial).toHaveBeenCalledOnce();
    expect(extractText).toHaveBeenCalledOnce();
    expect(updateExtractionResult).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'mat-1', extractionStatus: 'ok' }),
    );
  });

  it('records vision spend when extraction uses vision', async () => {
    extractText.mockResolvedValue({ method: 'vision', status: 'ok', text: 'Transcribed.', visionCostUsdCents: 30 });
    const [req, ctx] = makeUploadReq();
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    expect(recordSpend).toHaveBeenCalledWith(30);
  });

  it('returns extractionStatus=failed without throwing when extraction fails', async () => {
    extractText.mockResolvedValue({ status: 'failed' });
    const [req, ctx] = makeUploadReq();
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.extractionStatus).toBe('failed');
  });
});

describe('DELETE /api/courses/[code]/materials/[id]', () => {
  beforeEach(() => {
    getMaterialById.mockResolvedValue({
      id: 'mat-1',
      courseCode: CODE,
      blobUrl: 'https://blob.vercel-storage.com/rubric.pdf',
    });
    del.mockResolvedValue(undefined);
    deleteMaterial.mockResolvedValue(undefined);
  });

  it('returns 401 on invalid slug', async () => {
    const [req, ctx] = makeDeleteReq('wrong', 'mat-1');
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(401);
  });

  it('returns 404 when material not found', async () => {
    getMaterialById.mockResolvedValue(null);
    const [req, ctx] = makeDeleteReq(SLUG, 'mat-1');
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(404);
  });

  it('returns 403 when material belongs to a different course', async () => {
    getMaterialById.mockResolvedValue({ id: 'mat-1', courseCode: 'GC 9999', blobUrl: 'https://blob.vercel-storage.com/x.pdf' });
    const [req, ctx] = makeDeleteReq(SLUG, 'mat-1');
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(403);
  });

  it('deletes Blob object + row and returns 200', async () => {
    const [req, ctx] = makeDeleteReq(SLUG, 'mat-1');
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(200);
    expect(del).toHaveBeenCalledWith('https://blob.vercel-storage.com/rubric.pdf');
    expect(deleteMaterial).toHaveBeenCalledWith('mat-1');
  });
});
