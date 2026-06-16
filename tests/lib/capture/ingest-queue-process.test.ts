import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  readLocal,
  keyFromLocalUrl,
  extractText,
  finalizeExtraction,
  updateIndexingStatus,
  createVectorStore,
} = vi.hoisted(() => ({
  readLocal: vi.fn(),
  keyFromLocalUrl: vi.fn((u: string) => u.replace('/api/storage/materials/', '')),
  extractText: vi.fn(),
  finalizeExtraction: vi.fn(),
  updateIndexingStatus: vi.fn(),
  createVectorStore: vi.fn(() => ({ tag: 'vs' })),
}));

vi.mock('@/lib/storage/local-storage', () => ({ readLocal, keyFromLocalUrl }));
vi.mock('@/lib/courses/extract-text', () => ({ extractText }));
vi.mock('@/lib/capture/finalize-extraction', () => ({ finalizeExtraction }));
vi.mock('@/lib/capture/vector-store', () => ({ createVectorStore, tenantForCourse: (c: string) => c }));
vi.mock('@/lib/db/course-materials-queries', () => ({ updateIndexingStatus }));
vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode: vi.fn().mockResolvedValue({ learningObjectives: [] }) }));
vi.mock('@/lib/rate-limit/daily-cap', () => ({ checkDailyCap: vi.fn().mockResolvedValue({ ok: true }), recordSpend: vi.fn() }));

import { processMaterial } from '@/lib/capture/ingest-queue';

const baseRow = {
  id: 'm1', courseCode: 'GC 2400', fileName: 'f.pdf',
  blobUrl: '/api/storage/materials/gc-2400/f.pdf', mimeType: 'application/pdf',
  extractedText: null, extractionStatus: 'pending',
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  readLocal.mockResolvedValue(Buffer.from('%PDF-1.7'));
  extractText.mockResolvedValue({ status: 'ok', method: 'text', text: 'body', pageCount: 3 });
  finalizeExtraction.mockResolvedValue(undefined);
});

describe('processMaterial', () => {
  it('file-backed row: reads blob, extracts, then finalizes with the extracted text', async () => {
    await processMaterial(baseRow);
    expect(readLocal).toHaveBeenCalledWith('gc-2400/f.pdf');
    expect(extractText).toHaveBeenCalledOnce();
    expect(finalizeExtraction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm1', extractedText: 'body', extractionStatus: 'ok' }),
    );
  });

  it('text-backed row: skips extraction and finalizes directly', async () => {
    await processMaterial({ ...(baseRow as object), extractedText: 'already here', extractionStatus: 'ok' } as never);
    expect(extractText).not.toHaveBeenCalled();
    expect(finalizeExtraction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm1', extractedText: 'already here' }),
    );
  });

  it('marks failed when the blob is missing', async () => {
    readLocal.mockResolvedValue(null);
    await processMaterial(baseRow);
    expect(extractText).not.toHaveBeenCalled();
    expect(finalizeExtraction).not.toHaveBeenCalled();
    expect(updateIndexingStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1', status: 'failed' }));
  });

  it('marks skipped when a file-backed extraction returns low_text', async () => {
    extractText.mockResolvedValue({ status: 'low_text', method: 'text', text: 'tiny', pageCount: 1 });
    await processMaterial(baseRow);
    expect(updateIndexingStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1', status: 'skipped' }));
  });

  it('marks failed when a file-backed extraction returns failed', async () => {
    extractText.mockResolvedValue({ status: 'failed', method: 'text', text: '', pageCount: 0 });
    await processMaterial(baseRow);
    expect(updateIndexingStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1', status: 'failed' }));
  });
});
