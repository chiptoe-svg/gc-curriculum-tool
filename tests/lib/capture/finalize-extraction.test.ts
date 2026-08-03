import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateExtractionResult = vi.fn();
const updateMaterialDigest = vi.fn();
const generateMaterialDigest = vi.fn();

vi.mock('@/lib/db/course-materials-queries', () => ({
  updateExtractionResult: (...args: unknown[]) => updateExtractionResult(...args),
  updateMaterialDigest: (...args: unknown[]) => updateMaterialDigest(...args),
}));
vi.mock('@/lib/ai/analyze/material-digest', () => ({
  generateMaterialDigest: (...args: unknown[]) => generateMaterialDigest(...args),
}));

import { finalizeExtraction } from '@/lib/capture/finalize-extraction';

// Realistic long text > 15k tokens. (Was 'x'.repeat(60_001) — 60k identical chars
// is degenerate repetition that the extracted_text scrub correctly strips, so the
// fixture must be real prose. Sentence-joined, single spaces, no leading/trailing
// whitespace → the scrub is a no-op on it, matching production behavior on clean text.)
const LONG = Array(2000)
  .fill('Lorem ipsum dolor sit amet consectetur adipiscing elit.')
  .join(' ');

describe('finalizeExtraction', () => {
  beforeEach(() => {
    updateExtractionResult.mockReset().mockResolvedValue(undefined);
    updateMaterialDigest.mockReset().mockResolvedValue(undefined);
    generateMaterialDigest.mockReset();
    delete process.env.COURSECAPTURE_V2_INGESTION;
  });

  it('writes extraction result and skips digest when not a candidate (short)', async () => {
    await finalizeExtraction({
      id: 'm1',
      courseCode: 'GC 4800',
      fileName: 'Drive PDF: short.pdf',
      extractionStatus: 'ok',
      extractedText: 'short',
    });
    expect(updateExtractionResult).toHaveBeenCalledOnce();
    expect(generateMaterialDigest).not.toHaveBeenCalled();
    expect(updateMaterialDigest).not.toHaveBeenCalled();
  });

  it('scrubs contamination out of extracted_text before persisting', async () => {
    await finalizeExtraction({
      id: 'm1',
      courseCode: 'GC 3620',
      fileName: 'wk4.pdf',
      extractionStatus: 'ok',
      extractionMethod: 'vision',
      extractedText:
        'Real slide content. The provided image is completely blank and contains no visible content to transcribe. More real content.',
    });
    const persisted = updateExtractionResult.mock.calls[0]![0] as { extractedText: string };
    expect(persisted.extractedText).toContain('Real slide content.');
    expect(persisted.extractedText).toContain('More real content.');
    expect(persisted.extractedText).not.toMatch(/completely blank/i);
    expect(persisted.extractedText).not.toMatch(/no visible content to transcribe/i);
  });

  it('writes extraction result and skips digest when not a candidate (dense kind)', async () => {
    await finalizeExtraction({
      id: 'm1',
      courseCode: 'GC 4800',
      fileName: 'Canvas: Pages',
      extractionStatus: 'ok',
      extractedText: LONG,
    });
    expect(generateMaterialDigest).not.toHaveBeenCalled();
  });

  it('writes extraction result and skips digest when status is not ok', async () => {
    await finalizeExtraction({
      id: 'm1',
      courseCode: 'GC 4800',
      fileName: 'Drive PDF: long.pdf',
      extractionStatus: 'low_text',
      extractedText: LONG,
    });
    expect(generateMaterialDigest).not.toHaveBeenCalled();
  });

  it('generates digest when candidate and status ok', async () => {
    generateMaterialDigest.mockResolvedValue({ digest: 'DIGEST', model: 'gpt-5.4-mini' });
    await finalizeExtraction({
      id: 'm1',
      courseCode: 'GC 4800',
      fileName: 'Drive PDF: chapter-3.pdf',
      extractionStatus: 'ok',
      extractedText: LONG,
    });
    expect(generateMaterialDigest).toHaveBeenCalledOnce();
    expect(generateMaterialDigest.mock.calls[0]![0]).toEqual({
      fileName: 'Drive PDF: chapter-3.pdf',
      extractedText: LONG,
    });
    expect(updateMaterialDigest).toHaveBeenCalledWith({
      id: 'm1',
      digest: 'DIGEST',
      digestModel: 'gpt-5.4-mini',
    });
  });

  it('does not throw when the digest fails — extraction succeeds anyway', async () => {
    generateMaterialDigest.mockRejectedValue(new Error('OpenAI 500'));
    await expect(finalizeExtraction({
      id: 'm1',
      courseCode: 'GC 4800',
      fileName: 'Drive PDF: long.pdf',
      extractionStatus: 'ok',
      extractedText: LONG,
    })).resolves.toBeUndefined();
    expect(updateExtractionResult).toHaveBeenCalledOnce();
    expect(updateMaterialDigest).not.toHaveBeenCalled();
  });

  it('passes through extractionMethod and pageCount', async () => {
    await finalizeExtraction({
      id: 'm1',
      courseCode: 'GC 4800',
      fileName: 'foo.pdf',
      extractionStatus: 'ok',
      extractionMethod: 'vision',
      pageCount: 42,
      extractedText: 'short',
    });
    expect(updateExtractionResult).toHaveBeenCalledWith({
      id: 'm1',
      extractionStatus: 'ok',
      extractionMethod: 'vision',
      pageCount: 42,
      extractedText: 'short',
    });
  });
});
