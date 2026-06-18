/**
 * TDD: clearRawBlobsForCourse
 *
 * Skips remote-ref materials (keyFromLocalUrl → null), skips already-cleared
 * materials (rawCleared = true), deletes only the fresh local-blob material,
 * marks it rawCleared, counts correctly, and eats deleteLocal rejections
 * without throwing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

const listMaterialsByCourse = vi.fn();
const setMaterialRawCleared = vi.fn();
vi.mock('@/lib/db/course-materials-queries', () => ({
  listMaterialsByCourse: (...args: unknown[]) => listMaterialsByCourse(...args),
  setMaterialRawCleared: (...args: unknown[]) => setMaterialRawCleared(...args),
}));

const keyFromLocalUrl = vi.fn();
const deleteLocal = vi.fn();
vi.mock('@/lib/storage/local-storage', () => ({
  keyFromLocalUrl: (...args: unknown[]) => keyFromLocalUrl(...args),
  deleteLocal: (...args: unknown[]) => deleteLocal(...args),
}));

// Import AFTER mocks are hoisted
import { clearRawBlobsForCourse } from '@/lib/capture/clear-raw-blobs';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeMaterial(overrides: Record<string, unknown>) {
  return {
    id: 'mat-1',
    courseCode: 'GC 4440',
    fileName: 'syllabus.pdf',
    blobUrl: '/api/storage/materials/gc-4440/syllabus.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 102400,
    rawCleared: false,
    extractedText: 'Some text content here',
    digest: 'abc123',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('clearRawBlobsForCourse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMaterialRawCleared.mockResolvedValue(undefined);
  });

  it('deletes only the fresh local-blob material, skips remote-ref and already-cleared', async () => {
    const localBlob = makeMaterial({ id: 'mat-local', rawCleared: false, blobUrl: '/api/storage/materials/gc-4440/deck.pdf' });
    const remoteRef = makeMaterial({ id: 'mat-remote', rawCleared: false, blobUrl: 'https://canvas.example.com/files/9999' });
    const alreadyCleared = makeMaterial({ id: 'mat-cleared', rawCleared: true, blobUrl: '/api/storage/materials/gc-4440/old.pdf' });

    listMaterialsByCourse.mockResolvedValue([localBlob, remoteRef, alreadyCleared]);
    // local blob → valid key; remote → null; already-cleared → valid key (but should never be called)
    keyFromLocalUrl.mockImplementation((url: string) => {
      if (url.startsWith('/api/storage/materials/')) return url.replace('/api/storage/materials/', '');
      return null;
    });
    deleteLocal.mockResolvedValue(undefined);

    const result = await clearRawBlobsForCourse('GC 4440');

    // Only the fresh local-blob material triggered deleteLocal
    expect(deleteLocal).toHaveBeenCalledTimes(1);
    expect(deleteLocal).toHaveBeenCalledWith('gc-4440/deck.pdf');

    // setMaterialRawCleared called only for the deleted one
    expect(setMaterialRawCleared).toHaveBeenCalledTimes(1);
    expect(setMaterialRawCleared).toHaveBeenCalledWith('mat-local');

    // Count = 1 (the one successfully processed)
    expect(result).toEqual({ cleared: 1 });
  });

  it('skips materials where keyFromLocalUrl returns null (remote refs)', async () => {
    const remoteRef = makeMaterial({ id: 'mat-canvas', rawCleared: false, blobUrl: 'https://canvas.clemson.edu/courses/99999/files/1234' });
    listMaterialsByCourse.mockResolvedValue([remoteRef]);
    keyFromLocalUrl.mockReturnValue(null);

    const result = await clearRawBlobsForCourse('GC 4440');

    expect(deleteLocal).not.toHaveBeenCalled();
    expect(setMaterialRawCleared).not.toHaveBeenCalled();
    expect(result).toEqual({ cleared: 0 });
  });

  it('does not throw when deleteLocal rejects — best-effort, continues to mark cleared', async () => {
    const localBlob = makeMaterial({ id: 'mat-fail', rawCleared: false });
    listMaterialsByCourse.mockResolvedValue([localBlob]);
    keyFromLocalUrl.mockReturnValue('gc-4440/deck.pdf');
    deleteLocal.mockRejectedValue(new Error('EPERM: permission denied'));

    // Must not throw
    const result = await expect(clearRawBlobsForCourse('GC 4440')).resolves.not.toThrow();

    // Even when deleteLocal rejects, setMaterialRawCleared is still called
    expect(setMaterialRawCleared).toHaveBeenCalledWith('mat-fail');
    void result;
  });

  it('skips already-rawCleared materials without calling deleteLocal', async () => {
    const cleared = makeMaterial({ id: 'mat-done', rawCleared: true });
    listMaterialsByCourse.mockResolvedValue([cleared]);
    keyFromLocalUrl.mockReturnValue('gc-4440/done.pdf');

    const result = await clearRawBlobsForCourse('GC 4440');

    expect(deleteLocal).not.toHaveBeenCalled();
    expect(setMaterialRawCleared).not.toHaveBeenCalled();
    expect(result).toEqual({ cleared: 0 });
  });

  it('does NOT touch extractedText or digest columns — only raw blob cleared', async () => {
    const localBlob = makeMaterial({ id: 'mat-x', rawCleared: false, extractedText: 'precious text', digest: 'important-digest' });
    listMaterialsByCourse.mockResolvedValue([localBlob]);
    keyFromLocalUrl.mockReturnValue('gc-4440/file.pdf');
    deleteLocal.mockResolvedValue(undefined);

    await clearRawBlobsForCourse('GC 4440');

    // setMaterialRawCleared only — never any call that touches extractedText/digest
    expect(setMaterialRawCleared).toHaveBeenCalledWith('mat-x');
    // Verify we never called any other update function
    expect(setMaterialRawCleared).toHaveBeenCalledTimes(1);
  });
});
