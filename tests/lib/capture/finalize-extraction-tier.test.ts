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

vi.mock('@/lib/ai/analyze/material-digest', () => ({
  generateMaterialDigest: vi.fn(async () => ({
    digest: FIXED_DIGEST,
    model: 'test-model',
  })),
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
// Mocks for middle-tier slide-vision utils
// ---------------------------------------------------------------------------

const renderToImages = vi.fn<() => Promise<Buffer[]>>();
const describeSlide = vi.fn<(png: Buffer) => Promise<import('@/lib/capture/slide-vision').SlideNote>>();

vi.mock('@/lib/capture/render-pages', () => ({
  renderToImages: (...a: unknown[]) => renderToImages(...(a as Parameters<typeof renderToImages>)),
}));

vi.mock('@/lib/capture/slide-vision', () => ({
  describeSlide: (...a: unknown[]) => describeSlide(...(a as Parameters<typeof describeSlide>)),
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
