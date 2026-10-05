import { describe, it, expect, vi, beforeEach } from 'vitest';
import { finalizeExtraction } from '@/lib/capture/finalize-extraction';
import { createInMemoryVectorStore } from '@/lib/capture/vector-store';

const updateExtractionResult = vi.fn();
const updateMaterialDigest = vi.fn();
const updateIndexingStatus = vi.fn();
const updateFerpaRisk = vi.fn();
const updateAutoSetAside = vi.fn();

/** updateExtractionResult stand-in: stores the text it was given (no scrub in these unit tests). */
const storeAsGiven = async (i: { extractedText?: string }) => ({ outcome: 'stored' as const, extractedText: i.extractedText });

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
    updateExtractionResult.mockReset().mockImplementation(storeAsGiven);
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

  it('includes Canvas: Discussions: discussions are privacy-scrubbed, not set aside (spec 2026-10-05)', async () => {
    process.env.COURSECAPTURE_V2_INGESTION = '1';
    const { generateMaterialDigest } = await import('@/lib/ai/analyze/material-digest');
    vi.mocked(generateMaterialDigest).mockClear();
    await finalizeExtraction({
      id: 'm2',
      courseCode: 'GC 4800',
      fileName: 'Canvas: Discussions',
      extractionStatus: 'ok',
      extractedText: 'Some discussion content here about kerning and leading in body type.',
      vectorStore: createInMemoryVectorStore(),
      courseHasLearningObjectives: false,
    });
    expect(updateAutoSetAside).not.toHaveBeenCalledWith(expect.objectContaining({ autoSetAside: true }));
    expect(updateAutoSetAside).toHaveBeenCalledWith(expect.objectContaining({ autoSetAside: false, ignored: false }));
    expect(generateMaterialDigest).toHaveBeenCalled();
  });

  it('no longer holds FERPA-flagged content back: records ferpa_risk and indexes the stored text', async () => {
    process.env.COURSECAPTURE_V2_INGESTION = '1';
    const { generateMaterialDigest } = await import('@/lib/ai/analyze/material-digest');
    vi.mocked(generateMaterialDigest).mockClear();
    await finalizeExtraction({
      id: 'm-ferpa',
      courseCode: 'GC 4800',
      fileName: 'Canvas File: final-projects.pdf',
      extractionStatus: 'ok',
      // storeAsGiven does not scrub, so the detector still sees the CUID here.
      extractedText: 'Final project rubric.\nStudent C12345678 submitted on time.',
      vectorStore: createInMemoryVectorStore(),
      courseHasLearningObjectives: false,
    });
    expect(updateFerpaRisk).toHaveBeenCalledWith(expect.objectContaining({ risk: 'high' }));
    expect(updateAutoSetAside).not.toHaveBeenCalledWith(expect.objectContaining({ autoSetAside: true }));
    expect(updateIndexingStatus).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped' }));
    expect(generateMaterialDigest).toHaveBeenCalled();
  });

  it('indexes the text exactly as stored (privacy-scrubbed), never the text passed in', async () => {
    process.env.COURSECAPTURE_V2_INGESTION = '1';
    const { generateMaterialDigest } = await import('@/lib/ai/analyze/material-digest');
    const { embedBatch } = await import('@/lib/ai/embeddings');
    vi.mocked(generateMaterialDigest).mockClear();
    vi.mocked(embedBatch).mockClear();
    const stored = '# Feedback\nSubmitted by [student]. Strong grid work and clear hierarchy.';
    updateExtractionResult.mockResolvedValueOnce({ outcome: 'stored', extractedText: stored });
    await finalizeExtraction({
      id: 'm5',
      courseCode: 'GC 4800',
      fileName: 'Canvas File: critiques.pdf',
      extractionStatus: 'ok',
      extractedText: '# Feedback\nSubmitted by Jane Doe. Strong grid work and clear hierarchy.',
      vectorStore: createInMemoryVectorStore(),
      courseHasLearningObjectives: false,
    });
    expect(generateMaterialDigest).toHaveBeenCalledWith(
      expect.objectContaining({ extractedText: stored }),
      expect.anything(),
    );
    const downstream = JSON.stringify([
      vi.mocked(generateMaterialDigest).mock.calls,
      vi.mocked(embedBatch).mock.calls,
    ]);
    expect(downstream).not.toContain('Jane Doe');
  });

  it('stops and marks indexing failed when the privacy scrub failed (nothing stored)', async () => {
    process.env.COURSECAPTURE_V2_INGESTION = '1';
    const { generateMaterialDigest } = await import('@/lib/ai/analyze/material-digest');
    const { embedBatch } = await import('@/lib/ai/embeddings');
    vi.mocked(generateMaterialDigest).mockClear();
    vi.mocked(embedBatch).mockClear();
    updateExtractionResult.mockResolvedValueOnce({ outcome: 'scrub_failed', extractedText: undefined, reason: 'privacy-scrub guard rejected chunk 1/1' });
    await finalizeExtraction({
      id: 'm6',
      courseCode: 'GC 4800',
      fileName: 'Canvas: Discussions',
      extractionStatus: 'ok',
      extractedText: 'Posted by Jane Doe on May 2: thoughts on grids.',
      vectorStore: createInMemoryVectorStore(),
      courseHasLearningObjectives: false,
    });
    expect(updateIndexingStatus).toHaveBeenCalledWith({ id: 'm6', status: 'failed' });
    expect(updateFerpaRisk).not.toHaveBeenCalled();
    expect(generateMaterialDigest).not.toHaveBeenCalled();
    expect(embedBatch).not.toHaveBeenCalled();
  });

  it('never sets a syllabus aside for FERPA: syllabi are public documents (owner, 2026-10-05)', async () => {
    process.env.COURSECAPTURE_V2_INGESTION = '1';
    vi.mocked(updateAutoSetAside).mockClear();
    vi.mocked(updateFerpaRisk).mockClear();
    await finalizeExtraction({
      id: 'm-syllabus',
      courseCode: 'MKT 4320',
      fileName: 'MKT 4320 001 Qualitative Consumer Insights - Simple Syllabus.pdf',
      extractionStatus: 'ok',
      // Instructor + TA contact block: the shape that trips the email rule.
      extractedText: 'Syllabus. Instructor: jdoe@clemson.edu. TA: asmith@clemson.edu, bjones@clemson.edu. Learning objectives: ...',
      vectorStore: createInMemoryVectorStore(),
      courseHasLearningObjectives: true,
    });
    expect(updateAutoSetAside).not.toHaveBeenCalledWith(expect.objectContaining({ autoSetAside: true }));
    expect(updateFerpaRisk).toHaveBeenCalledWith(expect.objectContaining({ risk: 'low' }));
  });

  it('exempts a material flagged isSyllabus from the FERPA hold even with a non-syllabus filename', async () => {
    process.env.COURSECAPTURE_V2_INGESTION = '1';
    vi.mocked(updateAutoSetAside).mockClear();
    vi.mocked(updateFerpaRisk).mockClear();
    await finalizeExtraction({
      id: 'm-syllabus-2',
      courseCode: 'MKT 4320',
      // Filename gives no hint it's a syllabus — only the isSyllabus flag does.
      fileName: 'Canvas File: course-info.pdf',
      isSyllabus: true,
      extractionStatus: 'ok',
      // Instructor + TA contact block: the shape that trips the email rule / would be high FERPA risk.
      extractedText: 'Syllabus. Instructor: jdoe@clemson.edu. TA: asmith@clemson.edu, bjones@clemson.edu. Learning objectives: ...',
      vectorStore: createInMemoryVectorStore(),
      courseHasLearningObjectives: true,
    });
    expect(updateAutoSetAside).not.toHaveBeenCalledWith(expect.objectContaining({ autoSetAside: true }));
    expect(updateFerpaRisk).toHaveBeenCalledWith(expect.objectContaining({ risk: 'low' }));
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
