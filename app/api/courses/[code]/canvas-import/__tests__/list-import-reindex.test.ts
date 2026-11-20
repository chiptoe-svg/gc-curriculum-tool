/**
 * 2026-11-20 (GC 4060): a Canvas re-import replaced the text of "Canvas: Assignments" (and Quizzes, Pages,
 * Module List) with the Fall 2026 course, but left indexing_status 'ready', so the Ingest step skipped them
 * (ingestAction skips 'ready') and search kept serving the Spring 2026 passages.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/slug', () => ({ isValidSlug: () => true }));
vi.mock('@/lib/ip-hash', () => ({ hashIp: () => 'h' }));
vi.mock('@/lib/db/courses-queries', () => ({
  getCourseByCode: vi.fn(async () => ({ code: 'GC 4060' })),
  updateCourseCanvasImport: vi.fn(),
}));
vi.mock('@/lib/db/course-codes-queries', () => ({ setPairedCanvasProvenance: vi.fn() }));
vi.mock('@/lib/db/course-materials-queries', () => ({
  insertMaterial: vi.fn(async (m: { fileName: string }) => ({ id: `id-${m.fileName}` })),
  findMaterialByFileName: vi.fn(),
  updateMaterialMetadata: vi.fn(),
  updateExtractionResult: vi.fn(),
  updateMaterialTier: vi.fn(async () => undefined),
  updateIndexingStatus: vi.fn(async () => undefined),
}));
vi.mock('@/lib/capture/syllabus-replace', () => ({ supersedeOlderSyllabi: vi.fn(async () => undefined) }));
vi.mock('@/lib/capture/material-tier', () => ({ classifyManifestItem: vi.fn(async () => 'high') }));
vi.mock('@/lib/capture/size-probe', () => ({ probeSize: vi.fn(async () => ({ sizeBytes: 3 })) }));
vi.mock('@/lib/storage/local-storage', () => ({
  putLocal: vi.fn(async () => ({ url: 'local://x' })),
  courseSlug: () => 'gc-4060',
  safeFilename: (s: string) => s,
}));
vi.mock('@/lib/canvas/fetchCanvasCourse', () => ({ fetchCanvasCourse: vi.fn(), fetchCanvasFileMeta: vi.fn(async () => null) }));
vi.mock('@/lib/canvas/assemble-canvas-materials', () => ({
  assembleCanvasMaterials: vi.fn(() => [{ fileName: 'Canvas: Assignments', text: '## Exam 1 Fall 2026 (50 pts)', mimeType: 'text/html' }]),
}));

import { runListImport } from '../list-import';
import { fetchCanvasCourse } from '@/lib/canvas/fetchCanvasCourse';
import { findMaterialByFileName, updateIndexingStatus } from '@/lib/db/course-materials-queries';

const data = { course: { id: '1', name: 'GC 4060', syllabusHtml: '' }, assignments: [], modules: [], pages: [], discussions: [], quizzes: [] };
const call = () => runListImport(
  new Request('http://x', { method: 'POST', body: JSON.stringify({ slug: 's', canvasUrl: 'https://clemson.instructure.com/courses/1', canvasToken: 't' }) }),
  Promise.resolve({ code: 'GC 4060' }),
);
const existing = (text: string) => ({ id: 'mat-1', fileName: 'Canvas: Assignments', extractedText: text, indexingStatus: 'ready' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchCanvasCourse).mockResolvedValue(data as never);
});
afterEach(() => vi.unstubAllGlobals());

describe('list-mode Canvas re-import of a page bundle', () => {
  it('marks it for re-reading when its text changed', async () => {
    vi.mocked(findMaterialByFileName).mockResolvedValue(existing('## Exam 1 Spring 2026 (50 pts)') as never);
    expect((await call()).status).toBe(200);
    expect(updateIndexingStatus).toHaveBeenCalledWith({ id: 'mat-1', status: 'pending' });
  });

  it('leaves it alone when the text is the same', async () => {
    vi.mocked(findMaterialByFileName).mockResolvedValue(existing('## Exam 1 Fall 2026 (50 pts)') as never);
    expect((await call()).status).toBe(200);
    expect(updateIndexingStatus).not.toHaveBeenCalled();
  });
});
