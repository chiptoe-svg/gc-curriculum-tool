import { describe, it, expect, vi, beforeEach } from 'vitest';
import { finalizeExtraction } from '@/lib/capture/finalize-extraction';
import { createInMemoryVectorStore } from '@/lib/capture/vector-store';

const updateExtractionResult = vi.fn();
const updateMaterialDigest = vi.fn();
const updateIndexingStatus = vi.fn();
const updateFerpaRisk = vi.fn();
const updateAutoSetAside = vi.fn();

vi.mock('@/lib/db/course-materials-queries', () => ({
  updateExtractionResult: (...a: unknown[]) => updateExtractionResult(...a),
  updateMaterialDigest: (...a: unknown[]) => updateMaterialDigest(...a),
  updateIndexingStatus: (...a: unknown[]) => updateIndexingStatus(...a),
  updateFerpaRisk: (...a: unknown[]) => updateFerpaRisk(...a),
  updateAutoSetAside: (...a: unknown[]) => updateAutoSetAside(...a),
  // shouldDigestByDefault is a pure helper, not a DB query — but it's
  // exported from the same module so the mock must include it.
  // Forcing true so the digest branch always runs in tests.
  shouldDigestByDefault: () => true,
}));

vi.mock('@/lib/ai/analyze/material-digest', () => ({
  generateMaterialDigest: vi.fn(async (input: { fileName: string }) => ({
    digest: `digest of ${input.fileName}`,
    model: 'test-model',
  })),
}));

vi.mock('@/lib/ai/analyze/chunk-contextualize', () => ({
  contextualizeChunk: vi.fn(async (input: { chunkText: string }) => ({
    blurb: `blurb for ${input.chunkText.slice(0, 10)}`,
    model: 'test-model',
  })),
}));

vi.mock('@/lib/ai/embeddings', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/embeddings')>('@/lib/ai/embeddings');
  return {
    ...actual,
    embedBatch: vi.fn(async (texts: string[]) => texts.map((_, i) => [i, 0, 0])),
  };
});

describe('finalizeExtraction (v2 pipeline)', () => {
  beforeEach(() => {
    updateExtractionResult.mockReset();
    updateMaterialDigest.mockReset();
    updateIndexingStatus.mockReset();
    updateFerpaRisk.mockReset();
    updateAutoSetAside.mockReset();
    delete process.env.COURSECAPTURE_V2_INGESTION;
  });

  it('skips the v2 pipeline when the flag is off (legacy path runs)', async () => {
    const store = createInMemoryVectorStore();
    await finalizeExtraction({
      id: 'm1',
      courseCode: 'GC 4800',
      fileName: 'Canvas File: long.pdf',
      extractionStatus: 'ok',
      extractedText: 'x'.repeat(70_000),
      vectorStore: store,
      courseHasLearningObjectives: false,
    });
    expect(updateIndexingStatus).not.toHaveBeenCalled();
    expect(updateFerpaRisk).not.toHaveBeenCalled();
  });

  it('runs the v2 pipeline when the flag is on: digest + chunks + ferpa + policy', async () => {
    process.env.COURSECAPTURE_V2_INGESTION = '1';
    const store = createInMemoryVectorStore();
    await finalizeExtraction({
      id: 'm1',
      courseCode: 'GC 4800',
      fileName: 'Canvas File: textbook.pdf',
      extractionStatus: 'ok',
      extractedText: '# Chapter 1\nbody.\n\n# Chapter 2\nbody two.',
      vectorStore: store,
      courseHasLearningObjectives: false,
    });
    expect(updateMaterialDigest).toHaveBeenCalledOnce();
    expect(updateFerpaRisk).toHaveBeenCalledOnce();
    expect(updateIndexingStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready' }));
  });

  it('respects materials policy — sets aside high-FERPA materials', async () => {
    process.env.COURSECAPTURE_V2_INGESTION = '1';
    const store = createInMemoryVectorStore();
    await finalizeExtraction({
      id: 'm2',
      courseCode: 'GC 4800',
      fileName: 'Canvas: Discussions',
      extractionStatus: 'ok',
      extractedText: 'Some discussion content here.',
      vectorStore: store,
      courseHasLearningObjectives: false,
    });
    expect(updateAutoSetAside).toHaveBeenCalledWith(expect.objectContaining({
      autoSetAside: true,
      ignored: true,
    }));
    expect(updateIndexingStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped' }));
  });

  it('marks indexing_status: failed when chunk embedding fails', async () => {
    process.env.COURSECAPTURE_V2_INGESTION = '1';
    const { embedBatch } = await import('@/lib/ai/embeddings');
    vi.mocked(embedBatch).mockRejectedValueOnce(new Error('embedding service unavailable'));
    const store = createInMemoryVectorStore();
    await finalizeExtraction({
      id: 'm3',
      courseCode: 'GC 4800',
      fileName: 'Canvas File: textbook.pdf',
      extractionStatus: 'ok',
      extractedText: '# Chapter 1\nbody one.\n\n# Chapter 2\nbody two.',
      vectorStore: store,
      courseHasLearningObjectives: false,
    });
    expect(updateIndexingStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });

  it('skips indexing when no vectorStore is provided (digest still runs)', async () => {
    process.env.COURSECAPTURE_V2_INGESTION = '1';
    await finalizeExtraction({
      id: 'm4',
      courseCode: 'GC 4800',
      fileName: 'Canvas File: textbook.pdf',
      extractionStatus: 'ok',
      extractedText: '# Chapter 1\nbody paragraph with sufficient real content to pass the policy malformed-csv check.',
      courseHasLearningObjectives: false,
    });
    expect(updateMaterialDigest).toHaveBeenCalledOnce();
    expect(updateIndexingStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready' }));
  });
});
