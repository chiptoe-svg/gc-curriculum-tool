import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/slug', () => ({ isValidSlug: () => true }));
vi.mock('@/lib/ip-hash', () => ({ hashIp: () => 'h' }));
vi.mock('@/lib/db/courses-queries', () => ({
  getCourseByCode: vi.fn(async () => ({ code: 'PKSC 2200' })),
  updateCourseCanvasImport: vi.fn(),
}));
vi.mock('@/lib/db/course-codes-queries', () => ({ setPairedCanvasProvenance: vi.fn() }));
vi.mock('@/lib/db/course-materials-queries', () => ({
  insertMaterial: vi.fn(async (m: { fileName: string }) => ({ id: `id-${m.fileName}` })),
  findMaterialByFileName: vi.fn(async () => null),
  updateMaterialMetadata: vi.fn(),
  updateExtractionResult: vi.fn(),
  updateMaterialTier: vi.fn(async () => undefined),
}));
vi.mock('@/lib/capture/material-tier', () => ({ classifyManifestItem: vi.fn(async () => 'core') }));
vi.mock('@/lib/capture/size-probe', () => ({ probeSize: vi.fn(async () => ({ sizeBytes: 3 })) }));
vi.mock('@/lib/storage/local-storage', () => ({
  putLocal: vi.fn(async () => ({ url: 'local://x' })),
  courseSlug: () => 'pksc-2200',
  safeFilename: (s: string) => s,
}));
vi.mock('@/lib/canvas/fetchCanvasCourse', () => ({ fetchCanvasCourse: vi.fn(), fetchCanvasFileMeta: vi.fn() }));

import { runListImport } from '../list-import';
import { fetchCanvasCourse, fetchCanvasFileMeta } from '@/lib/canvas/fetchCanvasCourse';
import { insertMaterial } from '@/lib/db/course-materials-queries';

const data = {
  course: { id: '1', name: 'PKSC 2200', syllabusHtml: '' },
  assignments: [],
  modules: [{ id: '10', name: 'Course Information', published: true, items: [
    { title: 'PKSC 2200 Syllabi', type: 'File', externalUrl: null, htmlUrl: null, published: true, fileId: '901' },
    { title: 'Locked handout', type: 'File', externalUrl: null, htmlUrl: null, published: true, fileId: '902' },
  ] }],
  pages: [], discussions: [], quizzes: [],
};

const call = () => runListImport(
  new Request('http://x', { method: 'POST', body: JSON.stringify({ slug: 's', canvasUrl: 'https://clemson.instructure.com/courses/1', canvasToken: 't' }) }),
  Promise.resolve({ code: 'PKSC 2200' }),
);

beforeEach(() => {
  vi.mocked(fetchCanvasCourse).mockResolvedValue(data as never);
  vi.mocked(fetchCanvasFileMeta).mockImplementation(async (_b, id) =>
    id === '901' ? { id: '901', displayName: 'PKSC 2200 Syllabi - Spring 2026.pdf', url: 'https://files.test/901', mimeType: 'application/pdf', sizeBytes: 3 } as never : null);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('pdf', { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

/** The live (list-mode) import, PKSC 2200 2026-10-28: the syllabus was a file
 *  in a module, which the import never downloaded. */
describe('list-mode Canvas import — module files', () => {
  it('downloads a file placed directly in a module', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(fetchCanvasFileMeta).toHaveBeenCalledWith(expect.anything(), '901', 't');
    expect(insertMaterial).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'Canvas File: PKSC 2200 Syllabi - Spring 2026.pdf' }));
  });

  it('reports a file Canvas would not describe, by its module title', async () => {
    const json = await (await call()).json();
    expect(json.manifest.skipped).toContainEqual(expect.objectContaining({ fileName: 'Locked handout' }));
  });
});
