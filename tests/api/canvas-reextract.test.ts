import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist all mocks before any imports ────────────────────────────────────────

const {
  isValidSlug,
  getCourseByCode,
  updateMaterialMetadata,
  updateExtractionResult,
  fetchCanvasFileMeta,
  enqueue,
  extractText,
  dbSelect,
} = vi.hoisted(() => ({
  isValidSlug: vi.fn(),
  getCourseByCode: vi.fn(),
  updateMaterialMetadata: vi.fn(),
  updateExtractionResult: vi.fn(),
  fetchCanvasFileMeta: vi.fn(),
  enqueue: vi.fn(),
  extractText: vi.fn(),
  dbSelect: vi.fn(),
}));

vi.mock('@/lib/slug', () => ({ isValidSlug }));
vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode }));
vi.mock('@/lib/db/course-materials-queries', () => ({
  updateMaterialMetadata,
  updateExtractionResult,
}));
vi.mock('@/lib/canvas/fetchCanvasCourse', () => ({ fetchCanvasFileMeta }));
vi.mock('@/lib/capture/ingest-queue', () => ({ enqueue }));
vi.mock('@/lib/courses/extract-text', () => ({
  extractText,
  SUPPORTED_MIME_TYPES: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'text/html',
    'text/plain',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/svg+xml',
  ],
}));

// db is used via drizzle chaining: db.select(...).from(...).where(...).
// We stub it so each call to db.select() returns the mock's next value.
let dbSelectCallCount = 0;
const dbSelectResults: unknown[][] = [];

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          const result = dbSelectResults[dbSelectCallCount++] ?? [];
          return Promise.resolve(result);
        }),
      })),
    })),
  },
}));

// ── Import under test ──────────────────────────────────────────────────────────

import { POST } from '@/app/api/courses/[code]/canvas-reextract/route';

// ── Helpers ────────────────────────────────────────────────────────────────────

const SLUG = 'valid-slug-99999';
const CODE = 'GC 3460';
const CANVAS_BASE = 'https://clemson.instructure.com';

const fakeCourse = { code: CODE, title: 'Test Course' };

// Source rows that contain a /files/<ID> reference in extractedText.
const fakeSourceRows = [
  {
    fileName: 'Canvas: Syllabus',
    extractedText: `See /files/7001/ for the syllabus attachment.`,
    blobUrl: `${CANVAS_BASE}/courses/12345`,
  },
];

function makeReq(overrides: { slug?: string; canvasToken?: string } = {}): [Request, { params: Promise<{ code: string }> }] {
  const body = JSON.stringify({
    slug: overrides.slug ?? SLUG,
    canvasToken: overrides.canvasToken ?? 'test-canvas-token',
  });
  return [
    new Request(`http://test/api/courses/${encodeURIComponent(CODE)}/canvas-reextract`, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ code: CODE }) },
  ];
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('POST /api/courses/[code]/canvas-reextract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbSelectCallCount = 0;
    dbSelectResults.length = 0;

    isValidSlug.mockImplementation((s: string) => s === SLUG);
    getCourseByCode.mockResolvedValue(fakeCourse);
    updateMaterialMetadata.mockResolvedValue(undefined);
    updateExtractionResult.mockResolvedValue(undefined);
    enqueue.mockResolvedValue(undefined);
  });

  // ── Auth / validation ─────────────────────────────────────────────────────

  it('returns 401 when slug is invalid', async () => {
    isValidSlug.mockReturnValue(false);
    const [req, ctx] = makeReq({ slug: 'bad' });
    const res = await POST(req, ctx);
    expect(res.status).toBe(401);
  });

  it('returns 400 when canvasToken is missing', async () => {
    const body = JSON.stringify({ slug: SLUG });
    const req = new Request('http://test/', { method: 'POST', body, headers: { 'content-type': 'application/json' } });
    const res = await POST(req, { params: Promise.resolve({ code: CODE }) });
    expect(res.status).toBe(400);
  });

  it('returns 404 when course not found', async () => {
    getCourseByCode.mockResolvedValue(null);
    // DB select returns empty to avoid hitting blobUrl parse before the 404
    dbSelectResults.push([]);
    const [req, ctx] = makeReq();
    const res = await POST(req, ctx);
    expect(res.status).toBe(404);
  });

  it('returns 400 when no Canvas:* source rows exist', async () => {
    // First DB call (source rows) returns nothing.
    dbSelectResults.push([]);
    const [req, ctx] = makeReq();
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/no 'canvas:\*' rows/i);
  });

  // ── CORE BEHAVIOR CHANGE — legacy Office is now extracted, not skipped ────

  it('calls extractText for a legacy .doc file (application/msword) instead of skipping it', async () => {
    // Source row: contains file ID 7001.
    dbSelectResults.push(fakeSourceRows);
    // Existing file rows: one matching row for the .doc.
    dbSelectResults.push([
      { id: 'row-doc-1', fileName: 'Canvas File: lecture-notes.doc' },
    ]);

    // Canvas API returns a .doc file with legacy MIME.
    fetchCanvasFileMeta.mockResolvedValue({
      id: '7001',
      displayName: 'lecture-notes.doc',
      url: `${CANVAS_BASE}/files/7001/download?token=abc`,
      mimeType: 'application/msword',
      sizeBytes: 300_000,
    });

    // extractText succeeds.
    extractText.mockResolvedValue({
      status: 'ok',
      text: 'Legacy doc content here.',
      method: 'libreoffice',
      pageCount: 2,
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Buffer.alloc(300_000).buffer,
    } as unknown as Response);

    const [req, ctx] = makeReq();
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);

    const json = await res.json();

    // extractText MUST have been called (not skipped).
    expect(extractText).toHaveBeenCalledOnce();
    expect(extractText).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: 'application/msword' }),
    );

    // The row must appear as 'updated', NOT 'skipped'.
    expect(json.updated).toBe(1);
    expect(json.skipped).toBe(0);
    const result = json.results.find((r: { fileName: string }) => r.fileName === 'lecture-notes.doc');
    expect(result).toBeDefined();
    expect(result.status).toBe('updated');
    // Must not contain the old "re-save as modern" reason.
    expect(result.reason ?? '').not.toMatch(/re-save as modern/i);
  });

  it('calls extractText for a legacy .ppt file (application/vnd.ms-powerpoint)', async () => {
    dbSelectResults.push([
      {
        ...fakeSourceRows[0],
        extractedText: 'See /files/7002/ for the slides.',
      },
    ]);
    dbSelectResults.push([
      { id: 'row-ppt-1', fileName: 'Canvas File: week1-slides.ppt' },
    ]);

    fetchCanvasFileMeta.mockResolvedValue({
      id: '7002',
      displayName: 'week1-slides.ppt',
      url: `${CANVAS_BASE}/files/7002/download?token=abc`,
      mimeType: 'application/vnd.ms-powerpoint',
      sizeBytes: 500_000,
    });

    extractText.mockResolvedValue({
      status: 'ok',
      text: 'Slide content.',
      method: 'libreoffice',
      pageCount: 18,
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Buffer.alloc(500_000).buffer,
    } as unknown as Response);

    const [req, ctx] = makeReq();
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(extractText).toHaveBeenCalledOnce();
    expect(json.updated).toBe(1);
    expect(json.skipped).toBe(0);
  });

  // ── Modern files still work ───────────────────────────────────────────────

  it('still extracts a modern PDF successfully', async () => {
    dbSelectResults.push(fakeSourceRows);
    dbSelectResults.push([
      { id: 'row-pdf-1', fileName: 'Canvas File: syllabus.pdf' },
    ]);

    fetchCanvasFileMeta.mockResolvedValue({
      id: '7001',
      displayName: 'syllabus.pdf',
      url: `${CANVAS_BASE}/files/7001/download?token=abc`,
      mimeType: 'application/pdf',
      sizeBytes: 200_000,
    });

    extractText.mockResolvedValue({
      status: 'ok',
      text: 'PDF content here.',
      method: 'docling',
      pageCount: 5,
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Buffer.alloc(200_000).buffer,
    } as unknown as Response);

    const [req, ctx] = makeReq();
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.updated).toBe(1);
    expect(json.skipped).toBe(0);
    expect(extractText).toHaveBeenCalledOnce();
  });

  // ── Truly unsupported types still get skipped ─────────────────────────────

  it('skips a truly-unsupported type (video/mp4) without calling extractText', async () => {
    dbSelectResults.push([
      {
        ...fakeSourceRows[0],
        extractedText: 'See /files/7003/ for the lecture video.',
      },
    ]);
    dbSelectResults.push([
      { id: 'row-video-1', fileName: 'Canvas File: lecture.mp4' },
    ]);

    fetchCanvasFileMeta.mockResolvedValue({
      id: '7003',
      displayName: 'lecture.mp4',
      url: `${CANVAS_BASE}/files/7003/download?token=abc`,
      mimeType: 'video/mp4',
      sizeBytes: 100_000,
    });

    const [req, ctx] = makeReq();
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(extractText).not.toHaveBeenCalled();
    expect(json.updated).toBe(0);
    expect(json.skipped).toBe(1);
    const result = json.results.find((r: { fileName: string }) => r.fileName === 'lecture.mp4');
    expect(result?.reason).toMatch(/unsupported type/i);
    // Must NOT say "re-save as modern" (that phrase is gone entirely).
    expect(result?.reason ?? '').not.toMatch(/re-save as modern/i);
  });

  // ── Size guard still fires ────────────────────────────────────────────────

  it('skips a file that exceeds the 5 MB size limit', async () => {
    dbSelectResults.push(fakeSourceRows);
    dbSelectResults.push([
      { id: 'row-big-1', fileName: 'Canvas File: huge.pdf' },
    ]);

    fetchCanvasFileMeta.mockResolvedValue({
      id: '7001',
      displayName: 'huge.pdf',
      url: `${CANVAS_BASE}/files/7001/download?token=abc`,
      mimeType: 'application/pdf',
      sizeBytes: 10 * 1024 * 1024, // 10 MB
    });

    const [req, ctx] = makeReq();
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(extractText).not.toHaveBeenCalled();
    expect(json.skipped).toBe(1);
    const result = json.results.find((r: { fileName: string }) => r.fileName === 'huge.pdf');
    expect(result?.reason).toMatch(/too large/i);
  });

  // ── Regression: old skip text ("re-save as modern") is gone ──────────────

  it('never emits "re-save as modern" in any result reason', async () => {
    // Mix: a legacy .doc (should now be extracted, not skipped), a .ppt, and an unsupported binary.
    dbSelectResults.push([
      {
        ...fakeSourceRows[0],
        extractedText: 'Ref /files/7001/ /files/7002/ /files/7003/',
      },
    ]);
    dbSelectResults.push([
      { id: 'row-1', fileName: 'Canvas File: notes.doc' },
      { id: 'row-2', fileName: 'Canvas File: slides.ppt' },
      { id: 'row-3', fileName: 'Canvas File: data.bin' },
    ]);

    fetchCanvasFileMeta
      .mockResolvedValueOnce({
        id: '7001',
        displayName: 'notes.doc',
        url: `${CANVAS_BASE}/files/7001/download`,
        mimeType: 'application/msword',
        sizeBytes: 100_000,
      })
      .mockResolvedValueOnce({
        id: '7002',
        displayName: 'slides.ppt',
        url: `${CANVAS_BASE}/files/7002/download`,
        mimeType: 'application/vnd.ms-powerpoint',
        sizeBytes: 200_000,
      })
      .mockResolvedValueOnce({
        id: '7003',
        displayName: 'data.bin',
        url: `${CANVAS_BASE}/files/7003/download`,
        mimeType: 'application/octet-stream',
        sizeBytes: 50_000,
      });

    extractText.mockResolvedValue({
      status: 'ok',
      text: 'Content.',
      method: 'libreoffice',
      pageCount: 1,
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Buffer.alloc(100_000).buffer,
    } as unknown as Response);

    const [req, ctx] = makeReq();
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();

    // No result should ever say "re-save as modern".
    for (const r of json.results as Array<{ reason?: string }>) {
      expect(r.reason ?? '').not.toMatch(/re-save as modern/i);
    }

    // The two legacy Office files should be updated, not skipped.
    expect(json.updated).toBe(2);
    // The .bin (octet-stream with no known extension fallback) should be skipped.
    expect(json.skipped).toBe(1);
  });
});
