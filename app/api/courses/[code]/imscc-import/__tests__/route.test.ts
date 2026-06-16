import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'valid-slug' }));
vi.mock('@/lib/ip-hash', () => ({ hashIp: () => 'test-hash' }));
vi.mock('@/lib/db/courses-queries', () => ({
  getCourseByCode: vi.fn(),
  updateCourseCanvasImport: vi.fn(),
}));
vi.mock('@/lib/db/course-materials-queries', () => ({
  insertMaterial: vi.fn(),
  findMaterialByFileName: vi.fn(),
  updateMaterialMetadata: vi.fn(),
  updateExtractionResult: vi.fn(),
}));
const mockEnqueue = vi.fn();
vi.mock('@/lib/capture/ingest-queue', () => ({
  enqueue: (...args: unknown[]) => mockEnqueue(...args),
}));
vi.mock('@/lib/canvas/htmlToText', () => ({
  htmlToText: (s: string) => s.replace(/<[^>]+>/g, '').trim(),
}));
// Mock parseImscc so the route doesn't need to write a temp file and unzip.
// The real parseImscc has its own unit tests; here we just verify the route
// wires its output into the upsert loop correctly.
const mockParseImscc = vi.fn();
vi.mock('@/lib/canvas/parseImscc', () => ({
  parseImscc: (...args: unknown[]) => mockParseImscc(...args),
}));
// Mock the Docling/text extractor so the PDF "extracts" to text without
// hitting a real Docling server.
vi.mock('@/lib/courses/extract-text', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/courses/extract-text')>();
  return {
    ...orig,
    extractText: vi.fn().mockResolvedValue({ status: 'ok', text: 'Extracted PDF text content.' }),
  };
});
const mockResolveScoped = vi.fn();
vi.mock('@/lib/sandbox/access', () => ({ resolveScopedSession: (...a: unknown[]) => mockResolveScoped(...a) }));

import { POST } from '@/app/api/courses/[code]/imscc-import/route';
import { getCourseByCode } from '@/lib/db/courses-queries';
import {
  insertMaterial,
  findMaterialByFileName,
  updateMaterialMetadata,
  updateExtractionResult,
} from '@/lib/db/course-materials-queries';
import { extractText } from '@/lib/courses/extract-text';

const mockGetCourse = getCourseByCode as ReturnType<typeof vi.fn>;
const mockInsert = insertMaterial as ReturnType<typeof vi.fn>;
const mockFindByName = findMaterialByFileName as ReturnType<typeof vi.fn>;
const mockUpdateMeta = updateMaterialMetadata as ReturnType<typeof vi.fn>;
const mockUpdateExtraction = updateExtractionResult as ReturnType<typeof vi.fn>;
const mockExtractText = extractText as ReturnType<typeof vi.fn>;

const FAKE_COURSE = {
  code: 'GC 1010', title: 'Introduction to GC', level: 1, track: 'Core',
  description: '', prerequisites: '', syllabusUrl: null,
  learningObjectives: [], majorProjects: [], skillsRequired: [],
  builderStatus: 'draft', lastSyncedAt: new Date(),
};

// Canonical parse result from sample.imscc — mirrors what the real
// parseImscc produces from tests/fixtures/sample.imscc (syllabus,
// one assignment, one wiki page, one quiz, and a PDF web resource).
const SAMPLE_PARSE_RESULT = {
  data: {
    course: { id: 'g-test', name: 'Sample IMSCC Course', syllabusHtml: '<p>Course goals and policies.</p>' },
    assignments: [{ id: 'r_asg', name: 'Project 1', descriptionHtml: '<p>Build a thing. Worth 100 points.</p>', pointsPossible: null, rubric: [], rubricTitle: null, published: true }],
    modules: [{ id: 'm1', name: 'Module One', items: [{ title: 'Welcome', type: '', externalUrl: null, htmlUrl: null, published: true }], published: true }],
    pages: [{ url: 'wiki_content/welcome.html', title: 'Welcome', bodyHtml: '<h2>Welcome</h2><p>Read chapter 1.</p>', published: true }],
    discussions: [],
    quizzes: [{ id: 'r_quiz', title: 'Quiz 1', descriptionHtml: '', questionCount: 2, pointsPossible: null, questions: [], source: 'qti', published: true }],
  },
  // reading.pdf is an allowed extension; diagram.png is already filtered
  // by parseImscc (png not in ALLOWED_EXTS) and never reaches the route —
  // it shows up in `skipped` instead.
  files: [
    { name: 'reading.pdf', bytes: Buffer.from('%PDF-1.4 fake pdf content'), mimeType: 'application/pdf' },
  ],
  skipped: [
    { name: 'diagram.png', reason: 'unsupported' as const, sizeBytes: 1024 },
  ],
};

function makeReq(file: File, extra: Record<string, string> = {}, code = 'GC 1010') {
  const form = new FormData();
  form.append('file', file);
  form.append('slug', 'valid-slug');
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return [
    new Request('http://host/api/courses/GC%201010/imscc-import', { method: 'POST', body: form }),
    { params: Promise.resolve({ code }) },
  ] as const;
}

function makeSampleFile() {
  const bytes = readFileSync('tests/fixtures/sample.imscc');
  return new File([bytes], 'sample.imscc', { type: 'application/zip' });
}

beforeEach(() => {
  vi.resetAllMocks();
  // imscc-import self-enforces Basic Auth (matcher-excluded). This suite tests
  // import/queue logic, not the gate; .env.local sets FACULTY_BASIC_AUTH, so
  // neutralize it to keep the gate a no-op here.
  delete process.env.FACULTY_BASIC_AUTH;
  mockParseImscc.mockResolvedValue(SAMPLE_PARSE_RESULT);
  mockInsert.mockResolvedValue({ id: 'mat-1' });
  mockEnqueue.mockResolvedValue(undefined);
  mockUpdateExtraction.mockResolvedValue(undefined);
  mockUpdateMeta.mockResolvedValue(undefined);
  // Default to "no existing row" — the upsert path takes the INSERT branch.
  mockFindByName.mockResolvedValue(null);
  // extractText mock is reset by vi.resetAllMocks(); restore the default
  // return value so the PDF file extraction path succeeds in each test.
  mockExtractText.mockResolvedValue({ status: 'ok', text: 'Extracted PDF text content.' });
  // Default to no scoped session — existing slug-based tests are unaffected.
  mockResolveScoped.mockResolvedValue(null);
});

describe('POST /api/courses/[code]/imscc-import', () => {
  it('returns 401 for invalid slug', async () => {
    const file = makeSampleFile();
    const form = new FormData();
    form.append('file', file);
    form.append('slug', 'bad-slug');
    const req = new Request('http://host/api/courses/GC%201010/imscc-import', { method: 'POST', body: form });
    const res = await POST(req, { params: Promise.resolve({ code: 'GC 1010' }) });
    expect(res.status).toBe(401);
  });

  it('returns 400 when no file is provided', async () => {
    mockGetCourse.mockResolvedValue(FAKE_COURSE);
    const form = new FormData();
    form.append('slug', 'valid-slug');
    const req = new Request('http://host/api/courses/GC%201010/imscc-import', { method: 'POST', body: form });
    const res = await POST(req, { params: Promise.resolve({ code: 'GC 1010' }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/no .imscc file/i);
  });

  it('returns 404 for unknown course code', async () => {
    mockGetCourse.mockResolvedValue(null);
    const [req, ctx] = makeReq(makeSampleFile());
    const res = await POST(req, ctx);
    expect(res.status).toBe(404);
  });

  it('returns 400 when parseImscc throws', async () => {
    mockGetCourse.mockResolvedValue(FAKE_COURSE);
    mockParseImscc.mockRejectedValue(new Error('No imsmanifest.xml — not a Common Cartridge'));
    const badFile = new File([Buffer.from('not a zip')], 'bad.imscc', { type: 'application/zip' });
    const [req, ctx] = makeReq(badFile);
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/imsmanifest/i);
  });

  it('inserts Canvas: Syllabus, Canvas: Assignments, Canvas: Pages, Canvas: Quizzes, and Canvas File: reading.pdf on first import', async () => {
    mockGetCourse.mockResolvedValue(FAKE_COURSE);
    mockInsert.mockResolvedValue({ id: 'mat-1' });

    const [req, ctx] = makeReq(makeSampleFile());
    const res = await POST(req, ctx);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.imported).toBeGreaterThanOrEqual(1);
    expect(json.inserted).toBeGreaterThanOrEqual(1);
    expect(json.updated).toBe(0);

    const insertedFileNames = mockInsert.mock.calls.map((c) => c[0].fileName as string);
    expect(insertedFileNames).toContain('Canvas: Syllabus');
    expect(insertedFileNames).toContain('Canvas: Assignments');
    expect(insertedFileNames).toContain('Canvas: Pages');
    expect(insertedFileNames).toContain('Canvas: Quizzes');
    expect(insertedFileNames).toContain('Canvas File: reading.pdf');

    // PNG is not in the allowed-extension list in parseImscc, so it never
    // appears in files[] and is never inserted.
    const hasAnyPng = insertedFileNames.some((n) => n.endsWith('.png'));
    expect(hasAnyPng).toBe(false);
  });

  it('suppresses Canvas: Syllabus when Sheets catalog has learning objectives', async () => {
    mockGetCourse.mockResolvedValue({
      ...FAKE_COURSE,
      learningObjectives: ['Understand color theory', 'Apply CMYK separations'],
    });
    mockInsert.mockResolvedValue({ id: 'mat-1' });

    const [req, ctx] = makeReq(makeSampleFile());
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);

    const insertedFileNames = mockInsert.mock.calls.map((c) => c[0].fileName as string);
    expect(insertedFileNames).not.toContain('Canvas: Syllabus');
    // Other content (assignments, modules, pages, quizzes, files) still imports.
    expect(insertedFileNames.length).toBeGreaterThan(0);
  });

  it('upserts: existing fileName takes the UPDATE branch, no duplicate INSERT', async () => {
    mockGetCourse.mockResolvedValue(FAKE_COURSE);
    mockFindByName.mockResolvedValue({ id: 'existing-mat-id', fileName: 'Canvas: Syllabus' });

    const [req, ctx] = makeReq(makeSampleFile());
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.inserted).toBe(0);
    expect(json.updated).toBeGreaterThanOrEqual(1);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdateMeta).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'existing-mat-id' }),
    );
    expect(mockUpdateExtraction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'existing-mat-id', extractionStatus: 'ok' }),
    );
    expect(mockEnqueue).toHaveBeenCalledWith('existing-mat-id');
  });

  it('passes sourceCode through to insertMaterial when provided', async () => {
    mockGetCourse.mockResolvedValue(FAKE_COURSE);
    mockInsert.mockResolvedValue({ id: 'mat-1' });

    const [req, ctx] = makeReq(makeSampleFile(), { sourceCode: 'GC 1010L' });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ sourceCode: 'GC 1010L' }),
    );
  });

  it('queues each inserted material for background indexing', async () => {
    mockGetCourse.mockResolvedValue(FAKE_COURSE);
    mockInsert.mockResolvedValue({ id: 'mat-1' });

    const [req, ctx] = makeReq(makeSampleFile());
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);

    expect(mockUpdateExtraction).toHaveBeenCalledWith(
      expect.objectContaining({ extractionStatus: 'ok', extractionMethod: 'text' }),
    );
    expect(mockEnqueue).toHaveBeenCalled();
  });

  it('authorizes via a bound scoped session (no Basic Auth, no slug)', async () => {
    mockGetCourse.mockResolvedValue(FAKE_COURSE);
    mockResolveScoped.mockResolvedValue({ courseCode: 'GC 1010', instructorName: 'Dr. Lee, UGA' });
    // a request with NO slug field
    const form = new FormData();
    form.append('file', makeSampleFile());
    const req = new Request('http://host/api/courses/GC%201010/imscc-import', { method: 'POST', body: form });
    const res = await POST(req, { params: Promise.resolve({ code: 'GC 1010' }) });
    expect(res.status).toBe(200);
  });
});
