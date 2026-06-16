/**
 * Task 8: canvas-import stamps sourceCode on every insertMaterial call,
 * and routes paired-code provenance to setPairedCanvasProvenance instead
 * of updateCourseCanvasImport when a sourceCode is supplied.
 *
 * Approach: mock-route — we mock all external dependencies and import the
 * actual route handler so the full runImport() logic executes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Auth ─────────────────────────────────────────────────────────────────
vi.mock('@/lib/slug', () => ({
  isValidSlug: (s: string) => s === 'good',
}));

// ─── IP hash (doesn't matter for these assertions) ────────────────────────
vi.mock('@/lib/ip-hash', () => ({
  hashIp: () => 'testhash',
}));

// ─── Canvas URL parser ────────────────────────────────────────────────────
vi.mock('@/lib/canvas/parseCanvasUrl', () => ({
  parseCanvasUrl: () => '99999',
}));

// ─── Canvas fetcher — ONE assignment, no files, no syllabus, no modules ──
vi.mock('@/lib/canvas/fetchCanvasCourse', () => ({
  fetchCanvasCourse: async () => ({
    course: { id: '99999', name: 'Test Canvas Course', syllabusHtml: '' },
    assignments: [
      {
        id: 'a1',
        name: 'Project 1',
        descriptionHtml: '<p>Do the project</p>',
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
  }),
  fetchCanvasFileMeta: async () => null,
}));

// ─── HTML → text (passthrough) ───────────────────────────────────────────
vi.mock('@/lib/canvas/htmlToText', () => ({
  htmlToText: (h: string) => h.replace(/<[^>]+>/g, '').trim(),
}));

// ─── courses-queries ─────────────────────────────────────────────────────
const updateCourseCanvasImport = vi.fn(async (_c: string, _n: string, _d: Date) => {});
vi.mock('@/lib/db/courses-queries', () => ({
  getCourseByCode: async (code: string) => {
    if (code === 'GC 3460' || code === 'GC 3461') {
      return { courseCode: code, learningObjectives: [] };
    }
    return null;
  },
  updateCourseCanvasImport: (c: string, n: string, d: Date) => updateCourseCanvasImport(c, n, d),
}));

// ─── course-materials-queries ────────────────────────────────────────────
const insertMaterial = vi.fn(async (input: Record<string, unknown>) => ({
  id: 'mat-1',
  ...input,
}));
const findMaterialByFileName = vi.fn(async (_code: string, _name: string, _sourceCode?: string | null) => null);
const updateMaterialMetadata = vi.fn(async (_input: unknown) => {});
const updateExtractionResult = vi.fn(async (_input: unknown) => {});

vi.mock('@/lib/db/course-materials-queries', () => ({
  insertMaterial: (input: Record<string, unknown>) => insertMaterial(input),
  findMaterialByFileName: (code: string, name: string, sourceCode?: string | null) => findMaterialByFileName(code, name, sourceCode),
  updateMaterialMetadata: (input: unknown) => updateMaterialMetadata(input),
  updateExtractionResult: (input: unknown) => updateExtractionResult(input),
  shouldDigestByDefault: () => false,
}));

// ─── course-codes-queries ────────────────────────────────────────────────
const setPairedCanvasProvenance = vi.fn(async (_code: string, _name: string | null, _d: Date) => {});
vi.mock('@/lib/db/course-codes-queries', () => ({
  setPairedCanvasProvenance: (code: string, name: string | null, d: Date) =>
    setPairedCanvasProvenance(code, name, d),
}));

// ─── ingest-queue (no-op enqueue) ────────────────────────────────────────
vi.mock('@/lib/capture/ingest-queue', () => ({
  enqueue: async () => {},
}));

// ─── extract-text (not needed — no file attachments in this test) ─────────
vi.mock('@/lib/courses/extract-text', () => ({
  extractText: async () => ({ status: 'ok', text: '' }),
  SUPPORTED_MIME_TYPES: [],
}));
vi.mock('@/lib/courses/legacy-converter', () => ({
  isLegacyOfficeMime: () => false,
}));

// ─── Route import (AFTER all mocks) ──────────────────────────────────────
import { POST } from '@/app/api/courses/[code]/canvas-import/route';

// ─── Helpers ──────────────────────────────────────────────────────────────
function makeRequest(code: string, body: Record<string, unknown>) {
  return new Request(`http://x/api/courses/${encodeURIComponent(code)}/canvas-import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const ctx = (code: string) => ({ params: Promise.resolve({ code }) });

const baseBody = {
  slug: 'good',
  canvasUrl: 'https://clemson.instructure.com/courses/99999',
  canvasToken: 'tok',
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: findMaterialByFileName returns null (insert path)
  findMaterialByFileName.mockResolvedValue(null);
});

// ─── Tests ────────────────────────────────────────────────────────────────

describe('canvas-import: sourceCode threading', () => {
  it('with sourceCode — every insertMaterial call carries sourceCode and setPairedCanvasProvenance is called', async () => {
    const res = await POST(makeRequest('GC 3460', { ...baseBody, sourceCode: 'GC 3461' }), ctx('GC 3460'));
    expect(res.status).toBe(200);

    // insertMaterial must have been called at least once
    expect(insertMaterial).toHaveBeenCalled();

    // Every call carries sourceCode: 'GC 3461'
    for (const call of insertMaterial.mock.calls) {
      expect(call[0]).toMatchObject({ sourceCode: 'GC 3461' });
    }

    // findMaterialByFileName must be called with sourceCode as the 3rd arg
    // so the upsert lookup is source-scoped (never collides with lecture rows).
    expect(findMaterialByFileName).toHaveBeenCalled();
    for (const call of findMaterialByFileName.mock.calls) {
      // 1st arg: primary code, 2nd: fileName, 3rd: sourceCode 'GC 3461'
      expect(call[0]).toBe('GC 3460');
      expect(call[2]).toBe('GC 3461');
    }

    // Paired-code provenance written to the paired row
    expect(setPairedCanvasProvenance).toHaveBeenCalledWith(
      'GC 3461',
      'Test Canvas Course',
      expect.any(Date),
    );

    // Primary updateCourseCanvasImport should NOT have been called when
    // sourceCode differs from primary code
    expect(updateCourseCanvasImport).not.toHaveBeenCalled();
  });

  it('without sourceCode — insertMaterial has no sourceCode (or null) and updateCourseCanvasImport is called, NOT setPairedCanvasProvenance', async () => {
    const res = await POST(makeRequest('GC 3460', { ...baseBody }), ctx('GC 3460'));
    expect(res.status).toBe(200);

    expect(insertMaterial).toHaveBeenCalled();

    // No sourceCode stamped (null or undefined/absent)
    for (const call of insertMaterial.mock.calls) {
      const arg = call[0] as Record<string, unknown>;
      const sc = arg['sourceCode'];
      expect(sc == null).toBe(true); // null or undefined both pass
    }

    // findMaterialByFileName must be called with null (or undefined) as the
    // 3rd arg — so it matches only null-source (primary) rows.
    expect(findMaterialByFileName).toHaveBeenCalled();
    for (const call of findMaterialByFileName.mock.calls) {
      expect(call[0]).toBe('GC 3460');
      expect(call[2] == null).toBe(true); // null or undefined both pass
    }

    // Primary provenance written
    expect(updateCourseCanvasImport).toHaveBeenCalledWith(
      'GC 3460',
      'Test Canvas Course',
      expect.any(Date),
    );

    // Paired provenance NOT called
    expect(setPairedCanvasProvenance).not.toHaveBeenCalled();
  });
});
