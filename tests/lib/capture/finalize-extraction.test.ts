import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateExtractionResult = vi.fn();
const updateMaterialDigest = vi.fn();
const summarizeMaterial = vi.fn();

vi.mock('@/lib/db/course-materials-queries', () => ({
  updateExtractionResult: (...args: unknown[]) => updateExtractionResult(...args),
  updateMaterialDigest: (...args: unknown[]) => updateMaterialDigest(...args),
}));
vi.mock('@/lib/ai/analyze/material-summary', () => ({
  summarizeMaterial: (...args: unknown[]) => summarizeMaterial(...args),
}));

import { finalizeExtraction } from '@/lib/capture/finalize-extraction';

const LONG = 'x'.repeat(60_001); // > 15k tokens

describe('finalizeExtraction', () => {
  beforeEach(() => {
    updateExtractionResult.mockReset().mockResolvedValue(undefined);
    updateMaterialDigest.mockReset().mockResolvedValue(undefined);
    summarizeMaterial.mockReset();
  });

  it('writes extraction result and skips summarization when not a candidate (short)', async () => {
    await finalizeExtraction({
      id: 'm1',
      courseCode: 'GC 4800',
      fileName: 'Drive PDF: short.pdf',
      extractionStatus: 'ok',
      extractedText: 'short',
    });
    expect(updateExtractionResult).toHaveBeenCalledOnce();
    expect(summarizeMaterial).not.toHaveBeenCalled();
    expect(updateMaterialDigest).not.toHaveBeenCalled();
  });

  it('writes extraction result and skips summarization when not a candidate (dense kind)', async () => {
    await finalizeExtraction({
      id: 'm1',
      courseCode: 'GC 4800',
      fileName: 'Canvas: Pages',
      extractionStatus: 'ok',
      extractedText: LONG,
    });
    expect(summarizeMaterial).not.toHaveBeenCalled();
  });

  it('writes extraction result and skips summarization when status is not ok', async () => {
    await finalizeExtraction({
      id: 'm1',
      courseCode: 'GC 4800',
      fileName: 'Drive PDF: long.pdf',
      extractionStatus: 'low_text',
      extractedText: LONG,
    });
    expect(summarizeMaterial).not.toHaveBeenCalled();
  });

  it('summarizes when candidate and status ok', async () => {
    summarizeMaterial.mockResolvedValue({ digest: 'DIGEST', model: 'gpt-5.4-mini' });
    await finalizeExtraction({
      id: 'm1',
      courseCode: 'GC 4800',
      fileName: 'Drive PDF: chapter-3.pdf',
      extractionStatus: 'ok',
      extractedText: LONG,
    });
    expect(summarizeMaterial).toHaveBeenCalledOnce();
    expect(summarizeMaterial.mock.calls[0]![0]).toEqual({
      fileName: 'Drive PDF: chapter-3.pdf',
      extractedText: LONG,
    });
    expect(updateMaterialDigest).toHaveBeenCalledWith({
      id: 'm1',
      digest: 'DIGEST',
      digestModel: 'gpt-5.4-mini',
    });
  });

  it('does not throw when the summarizer fails — extraction succeeds anyway', async () => {
    summarizeMaterial.mockRejectedValue(new Error('OpenAI 500'));
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
