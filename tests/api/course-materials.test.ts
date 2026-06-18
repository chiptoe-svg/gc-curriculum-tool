import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  isValidSlug,
  getCourseByCode,
  putLocal,
  deleteLocal,
  keyFromLocalUrl,
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
  enqueue,
  setMaterialIgnored,
  setMaterialUseDigest,
  updateFerpaRisk,
  setMaterialIgnoredItems,
  updateMaterialTier,
} = vi.hoisted(() => ({
  isValidSlug: vi.fn(),
  getCourseByCode: vi.fn(),
  putLocal: vi.fn(),
  deleteLocal: vi.fn(),
  keyFromLocalUrl: vi.fn(),
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
  enqueue: vi.fn(),
  setMaterialIgnored: vi.fn(),
  setMaterialUseDigest: vi.fn(),
  updateFerpaRisk: vi.fn(),
  setMaterialIgnoredItems: vi.fn(),
  updateMaterialTier: vi.fn(),
}));

vi.mock('@/lib/slug', () => ({ isValidSlug }));
vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode }));
vi.mock('@/lib/storage/local-storage', () => ({
  putLocal,
  deleteLocal,
  keyFromLocalUrl,
  courseSlug: (s: string) => s.toLowerCase().replace(/\s+/g, '-'),
  safeFilename: (s: string) => s,
}));
vi.mock('@/lib/db/course-materials-queries', () => ({
  insertMaterial,
  updateExtractionResult,
  getMaterialById,
  deleteMaterial,
  listMaterialsByCourse,
  setMaterialIgnored,
  setMaterialUseDigest,
  updateFerpaRisk,
  setMaterialIgnoredItems,
  updateMaterialTier,
}));
vi.mock('@/lib/courses/extract-text', () => ({ extractText }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit }));
vi.mock('@/lib/rate-limit/daily-cap', () => ({ checkDailyCap, recordSpend }));
vi.mock('@/lib/ip-hash', () => ({ hashIp }));
vi.mock('@/lib/capture/ingest-queue', () => ({ enqueue: vi.fn().mockResolvedValue(undefined) }));

import { POST } from '@/app/api/courses/[code]/materials/route';
import { DELETE, PATCH } from '@/app/api/courses/[code]/materials/[id]/route';

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
  // The materials route self-enforces Basic Auth (the bare /materials path is
  // excluded from the middleware matcher). These tests exercise slug / course /
  // rate-limit logic, not the Basic-Auth gate, so neutralize the ambient env
  // var (.env.local sets FACULTY_BASIC_AUTH) to keep the gate a no-op here. The
  // two dedicated gate tests set + restore it themselves.
  delete process.env.FACULTY_BASIC_AUTH;
  // Likewise neutralize v2 ingestion: with it on, the route's (current,
  // pre-Phase-A) synchronous finalizeExtraction runs the real v2 pipeline and
  // reaches DB helpers this test only partially mocks. This test covers the
  // route's store/insert/auth logic, not indexing. (Phase A removes the
  // synchronous call entirely.)
  delete process.env.COURSECAPTURE_V2_INGESTION;
  isValidSlug.mockImplementation((s: string) => s === SLUG);
  getCourseByCode.mockResolvedValue({ code: CODE, title: 'Digital Publishing' });
  putLocal.mockResolvedValue({ url: '/api/storage/materials/gc-3460/rubric.pdf', key: 'gc-3460/rubric.pdf' });
  keyFromLocalUrl.mockImplementation((u: string) => u.replace('/api/storage/materials/', ''));
  insertMaterial.mockResolvedValue({ id: 'mat-1', courseCode: CODE, fileName: 'rubric.pdf', blobUrl: '/api/storage/materials/gc-3460/rubric.pdf', extractionStatus: 'pending' });
  updateExtractionResult.mockResolvedValue(undefined);
  checkIpRateLimit.mockResolvedValue({ allowed: true, remaining: 9 });
  checkDailyCap.mockResolvedValue({ ok: true, spentCents: 0 });
  recordSpend.mockResolvedValue(undefined);
  hashIp.mockReturnValue('abc123hash');
  extractText.mockResolvedValue({ method: 'text', status: 'ok', text: 'Rubric content here.' });
  enqueue.mockResolvedValue(undefined);
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
    // image/jpeg is now allowed (PNG/JPG supported via the local Docling
    // pipeline). Use a genuinely unsupported MIME to exercise the
    // rejection path.
    const [req, ctx] = makeUploadReq({ mimeType: 'application/zip' });
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

  it('stores locally, inserts row, enqueues, returns 200 with queued status', async () => {
    const [req, ctx] = makeUploadReq();
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe('mat-1');
    expect(json.indexingStatus).toBe('queued');
    expect(putLocal).toHaveBeenCalledOnce();
    expect(insertMaterial).toHaveBeenCalledOnce();
    expect(extractText).not.toHaveBeenCalled(); // extraction moved to the worker
  });

  // The bare /materials path is excluded from the middleware matcher (the
  // Node-runtime body-replay 500), so the route MUST self-enforce Basic Auth.
  it('returns 401 when FACULTY_BASIC_AUTH is set and no Authorization header (route self-enforces)', async () => {
    const prev = process.env.FACULTY_BASIC_AUTH;
    process.env.FACULTY_BASIC_AUTH = 'faculty:secret';
    try {
      const [req, ctx] = makeUploadReq();
      const res = await POST(req, ctx);
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toMatch(/Basic/i);
    } finally {
      if (prev === undefined) delete process.env.FACULTY_BASIC_AUTH;
      else process.env.FACULTY_BASIC_AUTH = prev;
    }
  });

  it('passes the Basic-Auth gate with a correct Authorization header', async () => {
    const prev = process.env.FACULTY_BASIC_AUTH;
    process.env.FACULTY_BASIC_AUTH = 'faculty:secret';
    try {
      const [base] = makeUploadReq();
      const form = await base.formData();
      const req = new Request('http://test/api/courses/GC%203460/materials', {
        method: 'POST',
        body: form,
        headers: { authorization: `Basic ${Buffer.from('faculty:secret').toString('base64')}` },
      });
      const res = await POST(req, { params: Promise.resolve({ code: CODE }) });
      expect(res.status).toBe(200);
    } finally {
      if (prev === undefined) delete process.env.FACULTY_BASIC_AUTH;
      else process.env.FACULTY_BASIC_AUTH = prev;
    }
  });
});

describe('DELETE /api/courses/[code]/materials/[id]', () => {
  beforeEach(() => {
    getMaterialById.mockResolvedValue({
      id: 'mat-1',
      courseCode: CODE,
      blobUrl: '/api/storage/materials/gc-3460/rubric.pdf',
    });
    deleteLocal.mockResolvedValue(undefined);
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
    getMaterialById.mockResolvedValue({ id: 'mat-1', courseCode: 'GC 9999', blobUrl: '/api/storage/materials/gc-9999/x.pdf' });
    const [req, ctx] = makeDeleteReq(SLUG, 'mat-1');
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(403);
  });

  it('deletes the local file + row and returns 200', async () => {
    const [req, ctx] = makeDeleteReq(SLUG, 'mat-1');
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(200);
    expect(deleteLocal).toHaveBeenCalledWith('gc-3460/rubric.pdf');
    expect(deleteMaterial).toHaveBeenCalledWith('mat-1');
  });
});

// ---------------------------------------------------------------------------
// Helpers for PATCH tests
// ---------------------------------------------------------------------------

function makePatchReq(
  body: Record<string, unknown>,
  materialId = 'mat-1',
): [Request, { params: Promise<{ code: string; id: string }> }] {
  const req = new Request(
    `http://test/api/courses/GC%203460/materials/${materialId}?slug=${encodeURIComponent(SLUG)}`,
    { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } },
  );
  return [req, { params: Promise.resolve({ code: CODE, id: materialId }) }];
}

describe('PATCH /api/courses/[code]/materials/[id]', () => {
  beforeEach(() => {
    getMaterialById.mockResolvedValue({ id: 'mat-1', courseCode: CODE });
    setMaterialIgnored.mockResolvedValue(true);
    setMaterialUseDigest.mockResolvedValue(true);
    updateFerpaRisk.mockResolvedValue(undefined);
    setMaterialIgnoredItems.mockResolvedValue(true);
    updateMaterialTier.mockResolvedValue(undefined);
  });

  it('returns 401 on invalid slug', async () => {
    const req = new Request(
      'http://test/api/courses/GC%203460/materials/mat-1?slug=wrong',
      { method: 'PATCH', body: JSON.stringify({ tier: 'high' }), headers: { 'content-type': 'application/json' } },
    );
    const res = await PATCH(req, { params: Promise.resolve({ code: CODE, id: 'mat-1' }) });
    expect(res.status).toBe(401);
  });

  it('returns 404 when material not found', async () => {
    getMaterialById.mockResolvedValue(null);
    const [req, ctx] = makePatchReq({ tier: 'high' });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(404);
  });

  it('returns 400 when body has no recognised field', async () => {
    const [req, ctx] = makePatchReq({ unknown: true });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/tier/);
  });

  it('returns 400 for an invalid tier value', async () => {
    const [req, ctx] = makePatchReq({ tier: 'bogus' });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/tier/i);
  });

  it('accepts tier:"background" → 200 and calls updateMaterialTier', async () => {
    const [req, ctx] = makePatchReq({ tier: 'background' });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(updateMaterialTier).toHaveBeenCalledWith('mat-1', 'background');
  });

  it('accepts tier:"high" → 200 and calls updateMaterialTier', async () => {
    const [req, ctx] = makePatchReq({ tier: 'high' });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(200);
    expect(updateMaterialTier).toHaveBeenCalledWith('mat-1', 'high');
  });

  it('accepts tier:"middle" → 200 and calls updateMaterialTier', async () => {
    const [req, ctx] = makePatchReq({ tier: 'middle' });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(200);
    expect(updateMaterialTier).toHaveBeenCalledWith('mat-1', 'middle');
  });

  it('tier-only body is sufficient (presence guard passes)', async () => {
    const [req, ctx] = makePatchReq({ tier: 'high' });
    const res = await PATCH(req, ctx);
    // Must not hit the "at least one of" 400
    expect(res.status).toBe(200);
    expect(setMaterialIgnored).not.toHaveBeenCalled();
  });

  it('still accepts ignored:true as before', async () => {
    const [req, ctx] = makePatchReq({ ignored: true });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(200);
    expect(setMaterialIgnored).toHaveBeenCalledWith('mat-1', true);
  });

  it('still accepts ferpaRisk and tier together', async () => {
    const [req, ctx] = makePatchReq({ ferpaRisk: 'low', tier: 'middle' });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(200);
    expect(updateFerpaRisk).toHaveBeenCalledWith({ id: 'mat-1', risk: 'low' });
    expect(updateMaterialTier).toHaveBeenCalledWith('mat-1', 'middle');
  });
});
