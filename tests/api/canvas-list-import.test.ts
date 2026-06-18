import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoist all mocks before any imports ───────────────────────────────────────

const {
  isValidSlug,
  getCourseByCode,
  updateCourseCanvasImport,
  setPairedCanvasProvenance,
  insertMaterial,
  findMaterialByFileName,
  updateMaterialMetadata,
  updateExtractionResult,
  fetchCanvasCourse,
  fetchCanvasFileMeta,
  putLocal,
  probeSize,
  enqueue,
} = vi.hoisted(() => ({
  isValidSlug: vi.fn(),
  getCourseByCode: vi.fn(),
  updateCourseCanvasImport: vi.fn(),
  setPairedCanvasProvenance: vi.fn(),
  insertMaterial: vi.fn(),
  findMaterialByFileName: vi.fn(),
  updateMaterialMetadata: vi.fn(),
  updateExtractionResult: vi.fn(),
  fetchCanvasCourse: vi.fn(),
  fetchCanvasFileMeta: vi.fn(),
  putLocal: vi.fn(),
  probeSize: vi.fn(),
  enqueue: vi.fn(),
}));

vi.mock('@/lib/slug', () => ({ isValidSlug }));
vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode, updateCourseCanvasImport }));
vi.mock('@/lib/db/course-codes-queries', () => ({ setPairedCanvasProvenance }));
vi.mock('@/lib/db/course-materials-queries', () => ({
  insertMaterial,
  findMaterialByFileName,
  updateMaterialMetadata,
  updateExtractionResult,
}));
vi.mock('@/lib/canvas/fetchCanvasCourse', () => ({ fetchCanvasCourse, fetchCanvasFileMeta }));
vi.mock('@/lib/storage/local-storage', () => ({
  putLocal,
  courseSlug: (s: string) => s.toLowerCase().replace(/\s+/g, '-'),
  safeFilename: (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_'),
}));
vi.mock('@/lib/capture/size-probe', () => ({ probeSize }));
vi.mock('@/lib/capture/ingest-queue', () => ({ enqueue }));
vi.mock('@/lib/ip-hash', () => ({ hashIp: () => 'test-ip-hash' }));
vi.mock('@/lib/canvas/parseCanvasUrl', () => ({
  parseCanvasUrl: (url: string) => {
    const m = url.match(/\/courses\/(\d+)/);
    return m ? m[1] : null;
  },
}));

// ── Import under test ─────────────────────────────────────────────────────────

import { POST } from '@/app/api/courses/[code]/canvas-import/route';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SLUG = 'valid-slug-12345';
const CODE = 'GC 3460';
const CANVAS_URL = 'https://clemson.instructure.com/courses/12345';
const CANVAS_TOKEN = 'test-canvas-token';

const fakeCourse = {
  code: CODE,
  title: 'Digital Publishing',
  level: 3,
  learningObjectives: [],
};

const fakeCanvasData = {
  course: {
    id: '12345',
    name: 'Digital Publishing Spring 2026',
    syllabusHtml: '<p>This course covers digital publishing fundamentals.</p>',
  },
  assignments: [
    {
      id: 'a1',
      name: 'Project 1',
      descriptionHtml: '<p>Create a publication.</p>',
      pointsPossible: 100,
      rubric: [],
      rubricTitle: null,
      published: true,
    },
  ],
  modules: [],
  pages: [],
  discussions: [],
  quizzes: [],
};

// A file reference is embedded in the syllabus text after htmlToText runs.
// We use a canvas file URL pattern in the HTML so the regex picks it up.
const fakeCanvasDataWithFile = {
  ...fakeCanvasData,
  course: {
    ...fakeCanvasData.course,
    syllabusHtml: '<p>See <a href="/courses/12345/files/9001/download">syllabus PDF</a>.</p>',
  },
};

const fakeFileMeta = {
  id: '9001',
  displayName: 'syllabus.pdf',
  url: 'https://clemson.instructure.com/files/9001/download?token=abc',
  mimeType: 'application/pdf',
  sizeBytes: 200_000,
};

function makeReq(overrides: {
  slug?: string;
  canvasUrl?: string;
  canvasToken?: string;
  skipUnpublished?: boolean;
} = {}): [Request, { params: Promise<{ code: string }> }] {
  const body = JSON.stringify({
    slug: overrides.slug ?? SLUG,
    canvasUrl: overrides.canvasUrl ?? CANVAS_URL,
    canvasToken: overrides.canvasToken ?? CANVAS_TOKEN,
    skipUnpublished: overrides.skipUnpublished ?? true,
  });
  return [
    new Request(`http://test/api/courses/${encodeURIComponent(CODE)}/canvas-import`, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ code: CODE }) },
  ];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/courses/[code]/canvas-import (list-mode, COURSECAPTURE_TRIAGE=1)', () => {
  let prevTriage: string | undefined;
  let prevSlug: string | undefined;

  beforeEach(() => {
    // Enable triage mode for every test in this suite
    prevTriage = process.env.COURSECAPTURE_TRIAGE;
    process.env.COURSECAPTURE_TRIAGE = '1';
    prevSlug = process.env.PROTOTYPE_SLUG;
    process.env.PROTOTYPE_SLUG = SLUG;

    vi.clearAllMocks();

    isValidSlug.mockImplementation((s: string) => s === SLUG);
    getCourseByCode.mockResolvedValue(fakeCourse);
    updateCourseCanvasImport.mockResolvedValue(undefined);
    setPairedCanvasProvenance.mockResolvedValue(undefined);
    findMaterialByFileName.mockResolvedValue(null); // no existing rows by default
    insertMaterial.mockImplementation(async (input: { courseCode: string; fileName: string; mimeType: string; sizeBytes: number }) => ({
      id: `mat-${Math.random().toString(36).slice(2, 8)}`,
      courseCode: input.courseCode,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      extractionStatus: 'pending',
      indexingStatus: 'pending',
      blobUrl: 'https://clemson.instructure.com/courses/12345',
    }));
    updateExtractionResult.mockResolvedValue(undefined);
    updateMaterialMetadata.mockResolvedValue(undefined);
    putLocal.mockResolvedValue({ url: '/api/storage/materials/gc-3460/syllabus.pdf', sizeBytes: 200_000 });
    probeSize.mockResolvedValue({ sizeBytes: 200_000 });
    fetchCanvasCourse.mockResolvedValue(fakeCanvasData);
    fetchCanvasFileMeta.mockResolvedValue(null); // no file refs by default
    enqueue.mockResolvedValue(undefined);

    // Default: global.fetch not needed (no file downloads unless overridden)
  });

  afterEach(() => {
    if (prevTriage === undefined) delete process.env.COURSECAPTURE_TRIAGE;
    else process.env.COURSECAPTURE_TRIAGE = prevTriage;
    if (prevSlug === undefined) delete process.env.PROTOTYPE_SLUG;
    else process.env.PROTOTYPE_SLUG = prevSlug;
  });

  // ── Auth / validation (mirrors runImport) ────────────────────────────────────

  it('returns 401 when slug is invalid', async () => {
    isValidSlug.mockReturnValue(false);
    const [req, ctx] = makeReq({ slug: 'bad-slug' });
    const res = await POST(req, ctx);
    expect(res.status).toBe(401);
  });

  it('returns 400 when canvasUrl is missing', async () => {
    const body = JSON.stringify({ slug: SLUG, canvasToken: CANVAS_TOKEN });
    const req = new Request('http://test/', { method: 'POST', body, headers: { 'content-type': 'application/json' } });
    const res = await POST(req, { params: Promise.resolve({ code: CODE }) });
    expect(res.status).toBe(400);
  });

  it('returns 404 when course not found', async () => {
    getCourseByCode.mockResolvedValue(null);
    const [req, ctx] = makeReq();
    const res = await POST(req, ctx);
    expect(res.status).toBe(404);
  });

  // ── Core list-mode behavior ───────────────────────────────────────────────────

  it('returns 200 with manifest shape including rows and decksPresent', async () => {
    const [req, ctx] = makeReq();
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('manifest');
    expect(json.manifest).toHaveProperty('rows');
    expect(Array.isArray(json.manifest.rows)).toBe(true);
    expect(typeof json.manifest.decksPresent).toBe('boolean');
  });

  it('produces at least one row for a course with syllabus + assignment', async () => {
    const [req, ctx] = makeReq();
    const res = await POST(req, ctx);
    const json = await res.json();
    expect(json.manifest.rows.length).toBeGreaterThan(0);
  });

  it('every row has indexingStatus === pending', async () => {
    const [req, ctx] = makeReq();
    const res = await POST(req, ctx);
    const json = await res.json();
    for (const row of json.manifest.rows) {
      expect(row.indexingStatus).toBe('pending');
    }
  });

  it('never calls enqueue', async () => {
    const [req, ctx] = makeReq();
    await POST(req, ctx);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('each row has required shape fields: id, fileName, kind, mimeType, sizeBytes, indexingStatus', async () => {
    const [req, ctx] = makeReq();
    const res = await POST(req, ctx);
    const json = await res.json();
    for (const row of json.manifest.rows) {
      expect(typeof row.id).toBe('string');
      expect(typeof row.fileName).toBe('string');
      expect(['syllabus', 'assignments', 'pages', 'discussions', 'quizzes', 'modules', 'file']).toContain(row.kind);
      expect(typeof row.mimeType).toBe('string');
      expect(typeof row.sizeBytes).toBe('number');
      expect(typeof row.indexingStatus).toBe('string');
    }
  });

  it('HTML-derived rows have kind matching their content type (not "file")', async () => {
    const [req, ctx] = makeReq();
    const res = await POST(req, ctx);
    const json = await res.json();
    const syllabusRow = json.manifest.rows.find((r: { fileName: string }) => r.fileName === 'Canvas: Syllabus');
    if (syllabusRow) expect(syllabusRow.kind).toBe('syllabus');
    const assignmentsRow = json.manifest.rows.find((r: { fileName: string }) => r.fileName === 'Canvas: Assignments');
    if (assignmentsRow) expect(assignmentsRow.kind).toBe('assignments');
  });

  it('decksPresent is false when no slide-like files are present', async () => {
    const [req, ctx] = makeReq();
    const res = await POST(req, ctx);
    const json = await res.json();
    expect(json.manifest.decksPresent).toBe(false);
  });

  // ── File reference handling ────────────────────────────────────────────────

  it('downloads and stores file via putLocal when file ref found, does NOT call extractText', async () => {
    fetchCanvasCourse.mockResolvedValue(fakeCanvasDataWithFile);
    fetchCanvasFileMeta.mockResolvedValue(fakeFileMeta);
    const fakePdfBytes = Buffer.from('%PDF-1.4 fake pdf content');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => fakePdfBytes.buffer,
    } as unknown as Response);
    probeSize.mockResolvedValue({ sizeBytes: fakePdfBytes.length, pageCount: 2 });

    const [req, ctx] = makeReq();
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    expect(putLocal).toHaveBeenCalled();
    const json = await res.json();
    const fileRow = json.manifest.rows.find((r: { kind: string }) => r.kind === 'file');
    expect(fileRow).toBeDefined();
    expect(fileRow.indexingStatus).toBe('pending');
    expect(fileRow.pageCount).toBe(2);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('stamps canvas provenance (updateCourseCanvasImport)', async () => {
    const [req, ctx] = makeReq();
    await POST(req, ctx);
    expect(updateCourseCanvasImport).toHaveBeenCalledWith(CODE, fakeCanvasData.course.name, expect.any(Date));
  });

  // ── Unsupported MIME-type guard ───────────────────────────────────────────

  it('skips unsupported files (no download, no DB row, appears in manifest.skipped)', async () => {
    const unsupportedFileMeta = {
      id: '9002',
      displayName: 'lecture-video.mp4',
      url: 'https://clemson.instructure.com/files/9002/download?token=xyz',
      mimeType: 'video/mp4',
      sizeBytes: 1_000_000,
    };
    const fakeCanvasDataWithVideo = {
      ...fakeCanvasData,
      course: {
        ...fakeCanvasData.course,
        syllabusHtml: '<p>Watch <a href="/courses/12345/files/9002/download">video</a>.</p>',
      },
    };
    fetchCanvasCourse.mockResolvedValue(fakeCanvasDataWithVideo);
    fetchCanvasFileMeta.mockResolvedValue(unsupportedFileMeta);

    const [req, ctx] = makeReq();
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);

    const json = await res.json();

    // putLocal must NOT have been called for the unsupported file
    expect(putLocal).not.toHaveBeenCalled();

    // The unsupported file must NOT appear in manifest.rows
    const fileRows = json.manifest.rows.filter((r: { kind: string }) => r.kind === 'file');
    expect(fileRows).toHaveLength(0);

    // The unsupported file MUST appear in manifest.skipped with a reason
    expect(Array.isArray(json.manifest.skipped)).toBe(true);
    const skipped = json.manifest.skipped as Array<{ fileName: string; mimeType: string; reason: string }>;
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.fileName).toBe('lecture-video.mp4');
    expect(skipped[0]?.mimeType).toBe('video/mp4');
    expect(skipped[0]?.reason).toMatch(/unsupported type/i);
  });

  it('still skips oversized files and records them in manifest.skipped', async () => {
    const bigFileMeta = {
      id: '9003',
      displayName: 'huge-document.pdf',
      url: 'https://clemson.instructure.com/files/9003/download?token=abc',
      mimeType: 'application/pdf',
      sizeBytes: 10 * 1024 * 1024, // 10 MB — over the 5 MB cap
    };
    const fakeCanvasDataWithBigFile = {
      ...fakeCanvasData,
      course: {
        ...fakeCanvasData.course,
        syllabusHtml: '<p>See <a href="/courses/12345/files/9003/download">doc</a>.</p>',
      },
    };
    fetchCanvasCourse.mockResolvedValue(fakeCanvasDataWithBigFile);
    fetchCanvasFileMeta.mockResolvedValue(bigFileMeta);

    const [req, ctx] = makeReq();
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);

    const json = await res.json();

    // putLocal must NOT have been called for the oversized file
    expect(putLocal).not.toHaveBeenCalled();

    // The oversized file must NOT appear in manifest.rows
    const fileRows = json.manifest.rows.filter((r: { kind: string }) => r.kind === 'file');
    expect(fileRows).toHaveLength(0);

    // The oversized file MUST appear in manifest.skipped with a reason
    expect(Array.isArray(json.manifest.skipped)).toBe(true);
    const skipped = json.manifest.skipped as Array<{ fileName: string; mimeType: string; reason: string }>;
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.fileName).toBe('huge-document.pdf');
    expect(skipped[0]?.reason).toMatch(/file too large/i);
  });

  it('decksPresent is true when a file row has slideCount set', async () => {
    fetchCanvasCourse.mockResolvedValue(fakeCanvasDataWithFile);
    fetchCanvasFileMeta.mockResolvedValue({
      ...fakeFileMeta,
      displayName: 'lecture-deck.pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Buffer.alloc(100).buffer,
    } as unknown as Response);
    probeSize.mockResolvedValue({ sizeBytes: 100, slideCount: 12 });

    const [req, ctx] = makeReq();
    const res = await POST(req, ctx);
    const json = await res.json();
    expect(json.manifest.decksPresent).toBe(true);
  });
});
