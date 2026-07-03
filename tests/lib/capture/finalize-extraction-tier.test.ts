/**
 * Tests for tier-based routing in finalizeExtraction (v2 pipeline).
 *
 * background tier → digest-only: exactly ONE chunk upserted (text === digestText,
 *   contextBlurb === ''), chunkMaterial/contextualizeChunk NOT used, status → ready.
 * high / null tier → existing multi-chunk path unchanged.
 * middle tier (slide-vision path):
 *   - fileBytes + renderToImages → images → describeSlide per image → 2 substantive kept →
 *     exactly 2 chunks upserted, no surfaced field contains "slide N", status → ready.
 *   - renderToImages → [] → falls through to full chunk pipeline.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { finalizeExtraction } from '@/lib/capture/finalize-extraction';
import type { VectorStore, ChunkVectorRecord, SectionRecord } from '@/lib/capture/vector-store';
import type { ChunkResult } from '@/lib/capture/chunker';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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
  shouldDigestByDefault: () => true,
}));

const FIXED_DIGEST = 'digest: two chapters of sample text';

const generateMaterialDigestMock = vi.fn(async () => ({
  digest: FIXED_DIGEST,
  model: 'test-model',
}));

vi.mock('@/lib/ai/analyze/material-digest', () => ({
  generateMaterialDigest: (...a: unknown[]) => generateMaterialDigestMock(...(a as [])),
}));

const contextualizeChunk = vi.fn(async (input: { chunkText: string }) => ({
  blurb: `blurb for ${input.chunkText.slice(0, 10)}`,
  model: 'test-model',
}));

vi.mock('@/lib/ai/analyze/chunk-contextualize', () => ({
  contextualizeChunk: (a: Parameters<typeof contextualizeChunk>[0]) => contextualizeChunk(a),
}));

vi.mock('@/lib/ai/embeddings', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/embeddings')>('@/lib/ai/embeddings');
  return {
    ...actual,
    embedBatch: vi.fn(async (texts: string[]) => texts.map((_, i) => [i + 1, 0, 0])),
  };
});

// ---------------------------------------------------------------------------
// Mock for chunker — controlled per-test; default returns 2 sections + 2 details
// so the existing full-pipeline tests (high/null) still see contextualizeChunk called.
// ---------------------------------------------------------------------------

const DEFAULT_CHUNK_RESULT: ChunkResult = {
  sections: [
    { id: 'sec-0', title: 'Chapter 1', index: 0, text: 'Body of chapter one with plenty of content here.' },
    { id: 'sec-1', title: 'Chapter 2', index: 1, text: 'Body of chapter two with plenty of content here.' },
  ],
  details: [
    { id: 'det-0', parentSectionId: 'sec-0', sectionTitle: 'Chapter 1', sectionIndex: 0, index: 0, text: 'Body of chapter one with plenty of content here.' },
    { id: 'det-1', parentSectionId: 'sec-1', sectionTitle: 'Chapter 2', sectionIndex: 1, index: 0, text: 'Body of chapter two with plenty of content here.' },
  ],
};

const chunkMaterialMock = vi.fn<() => ChunkResult>();

vi.mock('@/lib/capture/chunker', () => ({
  chunkMaterial: (...a: unknown[]) => chunkMaterialMock(...(a as [])),
}));

// ---------------------------------------------------------------------------
// Mocks for middle-tier slide-vision utils
// ---------------------------------------------------------------------------

const renderToImages = vi.fn<() => Promise<Buffer[]>>();
const describeSlide = vi.fn<(png: Buffer) => Promise<import('@/lib/capture/slide-vision').SlideNote>>();

vi.mock('@/lib/capture/render-pages', () => ({
  renderToImages: (...a: unknown[]) => renderToImages(...(a as Parameters<typeof renderToImages>)),
}));

// finalize-extraction now calls the batch describeSlides() (2026-07-02 offload
// refactor); back it with the per-image describeSlide spy so the existing
// mockResolvedValueOnce(...) sequence still drives one call per image, in order.
vi.mock('@/lib/capture/slide-vision', () => ({
  describeSlides: (pngs: Buffer[]) => Promise.all(pngs.map((p) => describeSlide(p))),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Multi-section text that chunkMaterial would normally split into ≥2 chunks. */
const MULTI_SECTION_TEXT =
  '# Chapter 1\n\nBody of chapter one with plenty of content here.\n\n' +
  '# Chapter 2\n\nBody of chapter two with plenty of content here.';

/** Spy-based fake VectorStore that records upsert calls for inspection. */
function makeFakeStore(): VectorStore & {
  upsertedChunks: ChunkVectorRecord[][];
  upsertedSections: SectionRecord[][];
} {
  const upsertedChunks: ChunkVectorRecord[][] = [];
  const upsertedSections: SectionRecord[][] = [];
  return {
    upsertedChunks,
    upsertedSections,
    async upsert(_tenant, records) { upsertedChunks.push(records); },
    async upsertSections(_tenant, sections) { upsertedSections.push(sections); },
    async deleteByMaterial() {},
    async hybridSearch() { return []; },
    async fetchChunkById() { return null; },
    async deleteByCourse() {},
    async listChunksByCourse() { return []; },
  };
}

const BASE = {
  courseCode: 'GC 3800',
  fileName: 'Canvas File: reading.pdf',
  extractionStatus: 'ok' as const,
  extractedText: MULTI_SECTION_TEXT,
  courseHasLearningObjectives: false,
};

describe('finalizeExtraction — tier routing (v2 pipeline)', () => {
  beforeEach(() => {
    process.env.COURSECAPTURE_V2_INGESTION = '1';
    updateExtractionResult.mockReset().mockResolvedValue(undefined);
    updateMaterialDigest.mockReset().mockResolvedValue(undefined);
    updateIndexingStatus.mockReset().mockResolvedValue(undefined);
    updateFerpaRisk.mockReset().mockResolvedValue(undefined);
    updateAutoSetAside.mockReset().mockResolvedValue(undefined);
    contextualizeChunk.mockClear();
    renderToImages.mockReset();
    describeSlide.mockReset();
    chunkMaterialMock.mockReset().mockReturnValue(DEFAULT_CHUNK_RESULT);
    generateMaterialDigestMock.mockReset().mockResolvedValue({ digest: FIXED_DIGEST, model: 'test-model' });
  });

  // -------------------------------------------------------------------------
  // background tier — digest-only path
  // -------------------------------------------------------------------------

  it('background tier: upserts exactly ONE chunk whose text === digest and contextBlurb === ""', async () => {
    const store = makeFakeStore();
    await finalizeExtraction({
      id: 'mat-bg',
      ...BASE,
      vectorStore: store,
      tier: 'background',
    });

    // All batch calls flattened
    const allChunks = store.upsertedChunks.flat();
    expect(allChunks).toHaveLength(1);

    const chunk = allChunks[0]!;
    expect(chunk.text).toBe(FIXED_DIGEST);
    expect(chunk.contextBlurb).toBe('');
  });

  it('background tier: does NOT call contextualizeChunk', async () => {
    const store = makeFakeStore();
    await finalizeExtraction({
      id: 'mat-bg-2',
      ...BASE,
      vectorStore: store,
      tier: 'background',
    });

    expect(contextualizeChunk).not.toHaveBeenCalled();
  });

  it('background tier: ends with indexing_status ready', async () => {
    const store = makeFakeStore();
    await finalizeExtraction({
      id: 'mat-bg-3',
      ...BASE,
      vectorStore: store,
      tier: 'background',
    });

    const lastStatus = updateIndexingStatus.mock.calls.at(-1)?.[0] as { status: string };
    expect(lastStatus?.status).toBe('ready');
  });

  it('background tier: upserts exactly ONE section record', async () => {
    const store = makeFakeStore();
    await finalizeExtraction({
      id: 'mat-bg-4',
      ...BASE,
      vectorStore: store,
      tier: 'background',
    });

    const allSections = store.upsertedSections.flat();
    expect(allSections).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // high tier — existing full pipeline unchanged
  // -------------------------------------------------------------------------

  it('high tier: calls contextualizeChunk (full pipeline unchanged)', async () => {
    const store = makeFakeStore();
    await finalizeExtraction({
      id: 'mat-high',
      courseCode: 'GC 3800',
      fileName: 'Canvas File: textbook.pdf',
      extractionStatus: 'ok',
      extractedText: MULTI_SECTION_TEXT,
      vectorStore: store,
      courseHasLearningObjectives: false,
      tier: 'high',
    });

    expect(contextualizeChunk).toHaveBeenCalled();
  });

  it('high tier: upserts ≥1 chunk (multi-chunk path)', async () => {
    const store = makeFakeStore();
    await finalizeExtraction({
      id: 'mat-high-2',
      courseCode: 'GC 3800',
      fileName: 'Canvas File: textbook.pdf',
      extractionStatus: 'ok',
      extractedText: MULTI_SECTION_TEXT,
      vectorStore: store,
      courseHasLearningObjectives: false,
      tier: 'high',
    });

    const allChunks = store.upsertedChunks.flat();
    expect(allChunks.length).toBeGreaterThanOrEqual(1);
  });

  it('high tier: ends with indexing_status ready', async () => {
    const store = makeFakeStore();
    await finalizeExtraction({
      id: 'mat-high-3',
      courseCode: 'GC 3800',
      fileName: 'Canvas File: textbook.pdf',
      extractionStatus: 'ok',
      extractedText: MULTI_SECTION_TEXT,
      vectorStore: store,
      courseHasLearningObjectives: false,
      tier: 'high',
    });

    const lastStatus = updateIndexingStatus.mock.calls.at(-1)?.[0] as { status: string };
    expect(lastStatus?.status).toBe('ready');
  });

  // -------------------------------------------------------------------------
  // null tier — falls through to full pipeline (same as high)
  // -------------------------------------------------------------------------

  it('null tier: calls contextualizeChunk (treated as high, full pipeline)', async () => {
    const store = makeFakeStore();
    await finalizeExtraction({
      id: 'mat-null',
      courseCode: 'GC 3800',
      fileName: 'Canvas File: textbook.pdf',
      extractionStatus: 'ok',
      extractedText: MULTI_SECTION_TEXT,
      vectorStore: store,
      courseHasLearningObjectives: false,
      tier: null,
    });

    expect(contextualizeChunk).toHaveBeenCalled();
  });

  it('null tier: upserts ≥1 chunk (multi-chunk path)', async () => {
    const store = makeFakeStore();
    await finalizeExtraction({
      id: 'mat-null-2',
      courseCode: 'GC 3800',
      fileName: 'Canvas File: textbook.pdf',
      extractionStatus: 'ok',
      extractedText: MULTI_SECTION_TEXT,
      vectorStore: store,
      courseHasLearningObjectives: false,
      tier: null,
    });

    const allChunks = store.upsertedChunks.flat();
    expect(allChunks.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// middle tier — slide-vision path
// ---------------------------------------------------------------------------

const SLIDE_FILE_NAME = 'lecture-01.pptx';
const FAKE_BYTES = Buffer.from('fake-pptx-bytes');
const FAKE_IMAGES = [Buffer.from('png1'), Buffer.from('png2'), Buffer.from('png3')];

describe('finalizeExtraction — middle tier (slide-vision)', () => {
  beforeEach(() => {
    process.env.COURSECAPTURE_V2_INGESTION = '1';
    updateExtractionResult.mockReset().mockResolvedValue(undefined);
    updateMaterialDigest.mockReset().mockResolvedValue(undefined);
    updateIndexingStatus.mockReset().mockResolvedValue(undefined);
    updateFerpaRisk.mockReset().mockResolvedValue(undefined);
    updateAutoSetAside.mockReset().mockResolvedValue(undefined);
    contextualizeChunk.mockClear();
    renderToImages.mockReset();
    describeSlide.mockReset();
    chunkMaterialMock.mockReset().mockReturnValue(DEFAULT_CHUNK_RESULT);
  });

  it('middle + 3 images (2 substantive, 1 low): upserts exactly 2 chunks', async () => {
    renderToImages.mockResolvedValue(FAKE_IMAGES);
    describeSlide
      .mockResolvedValueOnce({ topic: 'Color theory', teaches: 'Hue relationships', keyVisual: 'color wheel', contentLevel: 'substantive' })
      .mockResolvedValueOnce({ topic: 'Typography', teaches: 'Serif vs sans', keyVisual: 'type specimen', contentLevel: 'substantive' })
      .mockResolvedValueOnce({ topic: '', teaches: '', keyVisual: '', contentLevel: 'low' });

    const store = makeFakeStore();
    await finalizeExtraction({
      id: 'mat-slide-1',
      courseCode: 'GC 3800',
      fileName: SLIDE_FILE_NAME,
      extractionStatus: 'ok',
      extractedText: MULTI_SECTION_TEXT,
      fileBytes: FAKE_BYTES,
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      vectorStore: store,
      courseHasLearningObjectives: false,
      tier: 'middle',
    });

    const allChunks = store.upsertedChunks.flat();
    expect(allChunks).toHaveLength(2);
  });

  it('middle + 3 images (2 substantive): no surfaced field contains a slide number', async () => {
    renderToImages.mockResolvedValue(FAKE_IMAGES);
    describeSlide
      .mockResolvedValueOnce({ topic: 'Color theory', teaches: 'Hue relationships', keyVisual: 'color wheel', contentLevel: 'substantive' })
      .mockResolvedValueOnce({ topic: 'Typography', teaches: 'Serif vs sans', keyVisual: 'type specimen', contentLevel: 'substantive' })
      .mockResolvedValueOnce({ topic: '', teaches: '', keyVisual: '', contentLevel: 'low' });

    const store = makeFakeStore();
    await finalizeExtraction({
      id: 'mat-slide-2',
      courseCode: 'GC 3800',
      fileName: SLIDE_FILE_NAME,
      extractionStatus: 'ok',
      extractedText: MULTI_SECTION_TEXT,
      fileBytes: FAKE_BYTES,
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      vectorStore: store,
      courseHasLearningObjectives: false,
      tier: 'middle',
    });

    const allChunks = store.upsertedChunks.flat();
    const slideNumRe = /slide\s*\d/i;
    for (const chunk of allChunks) {
      expect(chunk.sectionTitle).toBe(SLIDE_FILE_NAME);
      expect(slideNumRe.test(chunk.sectionTitle)).toBe(false);
      expect(slideNumRe.test(chunk.text)).toBe(false);
      expect(slideNumRe.test(chunk.contextBlurb)).toBe(false);
    }
  });

  it('middle + 3 images (2 substantive): status ends ready', async () => {
    renderToImages.mockResolvedValue(FAKE_IMAGES);
    describeSlide
      .mockResolvedValueOnce({ topic: 'Color theory', teaches: 'Hue relationships', keyVisual: 'color wheel', contentLevel: 'substantive' })
      .mockResolvedValueOnce({ topic: 'Typography', teaches: 'Serif vs sans', keyVisual: 'type specimen', contentLevel: 'substantive' })
      .mockResolvedValueOnce({ topic: '', teaches: '', keyVisual: '', contentLevel: 'low' });

    const store = makeFakeStore();
    await finalizeExtraction({
      id: 'mat-slide-3',
      courseCode: 'GC 3800',
      fileName: SLIDE_FILE_NAME,
      extractionStatus: 'ok',
      extractedText: MULTI_SECTION_TEXT,
      fileBytes: FAKE_BYTES,
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      vectorStore: store,
      courseHasLearningObjectives: false,
      tier: 'middle',
    });

    const lastStatus = updateIndexingStatus.mock.calls.at(-1)?.[0] as { status: string };
    expect(lastStatus?.status).toBe('ready');
  });

  it('middle + renderToImages returns []: falls through to full chunk pipeline (contextualizeChunk called)', async () => {
    renderToImages.mockResolvedValue([]);

    const store = makeFakeStore();
    await finalizeExtraction({
      id: 'mat-slide-fallthrough',
      courseCode: 'GC 3800',
      fileName: SLIDE_FILE_NAME,
      extractionStatus: 'ok',
      extractedText: MULTI_SECTION_TEXT,
      fileBytes: FAKE_BYTES,
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      vectorStore: store,
      courseHasLearningObjectives: false,
      tier: 'middle',
    });

    // The full pipeline runs contextualizeChunk — this is the distinguishing signal
    expect(contextualizeChunk).toHaveBeenCalled();
  });

  it('middle + 2 images (both low): falls through to full chunk pipeline (contextualizeChunk called)', async () => {
    renderToImages.mockResolvedValue([Buffer.from('png1'), Buffer.from('png2')]);
    describeSlide
      .mockResolvedValueOnce({ topic: '', teaches: '', keyVisual: '', contentLevel: 'low' })
      .mockResolvedValueOnce({ topic: '', teaches: '', keyVisual: '', contentLevel: 'low' });

    const store = makeFakeStore();
    await finalizeExtraction({
      id: 'mat-slide-alllow',
      courseCode: 'GC 3800',
      fileName: SLIDE_FILE_NAME,
      extractionStatus: 'ok',
      extractedText: MULTI_SECTION_TEXT,
      fileBytes: FAKE_BYTES,
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      vectorStore: store,
      courseHasLearningObjectives: false,
      tier: 'middle',
    });

    // All slides scored low — no slide chunks upserted, full pipeline runs instead.
    expect(contextualizeChunk).toHaveBeenCalled();
  });

  it('high tier: renderToImages is NOT called (slide path skipped entirely)', async () => {
    renderToImages.mockResolvedValue(FAKE_IMAGES);

    const store = makeFakeStore();
    await finalizeExtraction({
      id: 'mat-high-norend',
      courseCode: 'GC 3800',
      fileName: SLIDE_FILE_NAME,
      extractionStatus: 'ok',
      extractedText: MULTI_SECTION_TEXT,
      fileBytes: FAKE_BYTES,
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      vectorStore: store,
      courseHasLearningObjectives: false,
      tier: 'high',
    });

    expect(renderToImages).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// middle tier — prose-section path (3c)
// ---------------------------------------------------------------------------

const PROSE_FILE_NAME = 'Canvas File: lecture-notes.pdf';

/**
 * Build a section text long enough to pass MIN_SECTION_CHARS (200).
 */
function longSectionText(label: string): string {
  return `${label} — `.padEnd(210, 'x');
}

describe('finalizeExtraction — middle tier (prose-section)', () => {
  beforeEach(() => {
    process.env.COURSECAPTURE_V2_INGESTION = '1';
    updateExtractionResult.mockReset().mockResolvedValue(undefined);
    updateMaterialDigest.mockReset().mockResolvedValue(undefined);
    updateIndexingStatus.mockReset().mockResolvedValue(undefined);
    updateFerpaRisk.mockReset().mockResolvedValue(undefined);
    updateAutoSetAside.mockReset().mockResolvedValue(undefined);
    contextualizeChunk.mockClear();
    renderToImages.mockReset().mockResolvedValue([]); // slide path → not handled
    describeSlide.mockReset();
    chunkMaterialMock.mockReset().mockReturnValue(DEFAULT_CHUNK_RESULT);
    generateMaterialDigestMock.mockReset().mockResolvedValue({ digest: FIXED_DIGEST, model: 'test-model' });
  });

  // Case A: 3 qualifying sections → prose path runs → 3 chunks, doc-level citation
  it('Case A: middle + renderToImages→[], 3 qualifying sections → upserts exactly 3 chunks', async () => {
    const sections = [
      { id: 'sec-0', title: 'Introduction', index: 0, text: longSectionText('Introduction') },
      { id: 'sec-1', title: 'Body',         index: 1, text: longSectionText('Body') },
      { id: 'sec-2', title: 'Conclusion',   index: 2, text: longSectionText('Conclusion') },
    ];
    chunkMaterialMock.mockReturnValue({ sections, details: [] });
    generateMaterialDigestMock
      .mockResolvedValueOnce({ digest: FIXED_DIGEST, model: 'test-model' }) // per-material digest (step 3)
      .mockResolvedValueOnce({ digest: 'summary of introduction', model: 'test-model' })
      .mockResolvedValueOnce({ digest: 'summary of body', model: 'test-model' })
      .mockResolvedValueOnce({ digest: 'summary of conclusion', model: 'test-model' });

    const store = makeFakeStore();
    await finalizeExtraction({
      id: 'mat-prose-a',
      courseCode: 'GC 3800',
      fileName: PROSE_FILE_NAME,
      extractionStatus: 'ok',
      extractedText: MULTI_SECTION_TEXT,
      vectorStore: store,
      courseHasLearningObjectives: false,
      tier: 'middle',
    });

    const allChunks = store.upsertedChunks.flat();
    expect(allChunks).toHaveLength(3);
  });

  it('Case A: every chunk.sectionTitle === fileName', async () => {
    const sections = [
      { id: 'sec-0', title: 'Introduction', index: 0, text: longSectionText('Introduction') },
      { id: 'sec-1', title: 'Body',         index: 1, text: longSectionText('Body') },
      { id: 'sec-2', title: 'Conclusion',   index: 2, text: longSectionText('Conclusion') },
    ];
    chunkMaterialMock.mockReturnValue({ sections, details: [] });
    generateMaterialDigestMock
      .mockResolvedValueOnce({ digest: FIXED_DIGEST, model: 'test-model' })
      .mockResolvedValueOnce({ digest: 'summary of introduction', model: 'test-model' })
      .mockResolvedValueOnce({ digest: 'summary of body', model: 'test-model' })
      .mockResolvedValueOnce({ digest: 'summary of conclusion', model: 'test-model' });

    const store = makeFakeStore();
    await finalizeExtraction({
      id: 'mat-prose-a2',
      courseCode: 'GC 3800',
      fileName: PROSE_FILE_NAME,
      extractionStatus: 'ok',
      extractedText: MULTI_SECTION_TEXT,
      vectorStore: store,
      courseHasLearningObjectives: false,
      tier: 'middle',
    });

    const allChunks = store.upsertedChunks.flat();
    for (const chunk of allChunks) {
      expect(chunk.sectionTitle).toBe(PROSE_FILE_NAME);
    }
  });

  it('Case A: no surfaced field (sectionTitle/text/contextBlurb) matches /section\\s*\\d/i or equals a section title', async () => {
    const sections = [
      { id: 'sec-0', title: 'Introduction', index: 0, text: longSectionText('Introduction') },
      { id: 'sec-1', title: 'Body',         index: 1, text: longSectionText('Body') },
      { id: 'sec-2', title: 'Conclusion',   index: 2, text: longSectionText('Conclusion') },
    ];
    const sectionTitles = sections.map(s => s.title);
    chunkMaterialMock.mockReturnValue({ sections, details: [] });
    generateMaterialDigestMock
      .mockResolvedValueOnce({ digest: FIXED_DIGEST, model: 'test-model' })
      .mockResolvedValueOnce({ digest: 'summary of introduction content', model: 'test-model' })
      .mockResolvedValueOnce({ digest: 'summary of body content', model: 'test-model' })
      .mockResolvedValueOnce({ digest: 'summary of conclusion content', model: 'test-model' });

    const store = makeFakeStore();
    await finalizeExtraction({
      id: 'mat-prose-a3',
      courseCode: 'GC 3800',
      fileName: PROSE_FILE_NAME,
      extractionStatus: 'ok',
      extractedText: MULTI_SECTION_TEXT,
      vectorStore: store,
      courseHasLearningObjectives: false,
      tier: 'middle',
    });

    const allChunks = store.upsertedChunks.flat();
    const sectionIndexRe = /section\s*\d/i;
    for (const chunk of allChunks) {
      // No surfaced field may carry a section index
      expect(sectionIndexRe.test(chunk.sectionTitle)).toBe(false);
      expect(sectionIndexRe.test(chunk.contextBlurb)).toBe(false);
      // sectionTitle must never be one of the section's own titles
      expect(sectionTitles).not.toContain(chunk.sectionTitle);
    }
  });

  it('Case A: status ends ready', async () => {
    const sections = [
      { id: 'sec-0', title: 'Introduction', index: 0, text: longSectionText('Introduction') },
      { id: 'sec-1', title: 'Body',         index: 1, text: longSectionText('Body') },
      { id: 'sec-2', title: 'Conclusion',   index: 2, text: longSectionText('Conclusion') },
    ];
    chunkMaterialMock.mockReturnValue({ sections, details: [] });
    generateMaterialDigestMock
      .mockResolvedValueOnce({ digest: FIXED_DIGEST, model: 'test-model' })
      .mockResolvedValueOnce({ digest: 'summary of introduction', model: 'test-model' })
      .mockResolvedValueOnce({ digest: 'summary of body', model: 'test-model' })
      .mockResolvedValueOnce({ digest: 'summary of conclusion', model: 'test-model' });

    const store = makeFakeStore();
    await finalizeExtraction({
      id: 'mat-prose-a4',
      courseCode: 'GC 3800',
      fileName: PROSE_FILE_NAME,
      extractionStatus: 'ok',
      extractedText: MULTI_SECTION_TEXT,
      vectorStore: store,
      courseHasLearningObjectives: false,
      tier: 'middle',
    });

    const lastStatus = updateIndexingStatus.mock.calls.at(-1)?.[0] as { status: string };
    expect(lastStatus?.status).toBe('ready');
  });

  // Case B: only 1 qualifying section → falls through to full chunk pipeline
  it('Case B: middle + only 1 qualifying section → falls through to full pipeline (contextualizeChunk called)', async () => {
    // 1 long section + 2 short ones (below 200 chars)
    chunkMaterialMock.mockReturnValue({
      sections: [
        { id: 'sec-0', title: 'Long',    index: 0, text: longSectionText('Long') },
        { id: 'sec-1', title: 'Short1',  index: 1, text: 'Too short.' },
        { id: 'sec-2', title: 'Short2',  index: 2, text: 'Also too short.' },
      ],
      details: [
        { id: 'det-0', parentSectionId: 'sec-0', sectionTitle: 'Long', sectionIndex: 0, index: 0, text: longSectionText('Long') },
      ],
    });

    const store = makeFakeStore();
    await finalizeExtraction({
      id: 'mat-prose-b',
      courseCode: 'GC 3800',
      fileName: PROSE_FILE_NAME,
      extractionStatus: 'ok',
      extractedText: MULTI_SECTION_TEXT,
      vectorStore: store,
      courseHasLearningObjectives: false,
      tier: 'middle',
    });

    // Full pipeline must run — contextualizeChunk is the distinguishing signal
    expect(contextualizeChunk).toHaveBeenCalled();
  });

  // Case C: high tier → full pipeline unchanged (existing test coverage, just confirming invariant)
  it('Case C: high tier still uses full pipeline regardless of chunkMaterial output', async () => {
    // Give 3 qualifying sections — but high tier skips prose path entirely
    const sections = [
      { id: 'sec-0', title: 'Introduction', index: 0, text: longSectionText('Introduction') },
      { id: 'sec-1', title: 'Body',         index: 1, text: longSectionText('Body') },
      { id: 'sec-2', title: 'Conclusion',   index: 2, text: longSectionText('Conclusion') },
    ];
    chunkMaterialMock.mockReturnValue({
      sections,
      details: [
        { id: 'det-0', parentSectionId: 'sec-0', sectionTitle: 'Introduction', sectionIndex: 0, index: 0, text: longSectionText('Introduction') },
      ],
    });

    const store = makeFakeStore();
    await finalizeExtraction({
      id: 'mat-prose-c',
      courseCode: 'GC 3800',
      fileName: PROSE_FILE_NAME,
      extractionStatus: 'ok',
      extractedText: MULTI_SECTION_TEXT,
      vectorStore: store,
      courseHasLearningObjectives: false,
      tier: 'high',
    });

    // Full pipeline (contextualizeChunk) must have run
    expect(contextualizeChunk).toHaveBeenCalled();
    // renderToImages must NOT have been called for high tier
    expect(renderToImages).not.toHaveBeenCalled();
  });
});
