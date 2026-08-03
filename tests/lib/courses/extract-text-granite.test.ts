import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the extractor factory so the first pass yields image-based (low) text.
vi.mock('@/lib/courses/material-extractor', async (orig) => {
  const actual = await orig<typeof import('@/lib/courses/material-extractor')>();
  return {
    ...actual,
    getExtractorFor: () => ({ name: 'docling', supports: () => true, extract: async () => ({ text: '', pageCount: 1 }) }),
    transcribeWithGranite: vi.fn(),
  };
});

// The vision fallback now renders + runs the adaptive describeSlides pass (no
// injected provider, no OpenAI transcribe). Mock the render + describe; keep the
// real notesToExtractedText so the extracted_text derivation is exercised.
vi.mock('@/lib/capture/render-pages', () => ({
  renderToImages: vi.fn(async () => [Buffer.from('img1')]),
}));
vi.mock('@/lib/capture/slide-vision', async (orig) => ({
  ...(await orig<typeof import('@/lib/capture/slide-vision')>()),
  describeSlides: vi.fn(async () => [
    { topic: 'Fallback', teaches: 'x', keyVisual: '', text: 'ADAPTIVE VISION TEXT that is long enough', contentLevel: 'substantive' as const },
  ]),
}));

import { extractText } from '@/lib/courses/extract-text';
import { transcribeWithGranite } from '@/lib/courses/material-extractor';
import { describeSlides } from '@/lib/capture/slide-vision';

const args = { fileBytes: Buffer.from('%PDF'), mimeType: 'application/pdf' as const, fileName: 's.pdf' };

beforeEach(() => { process.env.GRANITE_DOCLING_ENABLED = '1'; vi.clearAllMocks(); });
afterEach(() => { delete process.env.GRANITE_DOCLING_ENABLED; });

it('clean Granite output → method granite, cost 0, adaptive pass not called', async () => {
  (transcribeWithGranite as any).mockResolvedValue({ text: '## R\n\npara a\n\npara b\n\npara c', pageCount: 1 });
  const r = await extractText(args);
  expect(r.method).toBe('granite'); expect(r.visionCostUsdCents).toBe(0);
  expect(describeSlides).not.toHaveBeenCalled();
});
it('junk (repetitive) Granite output → falls back to the adaptive pass (method vision)', async () => {
  (transcribeWithGranite as any).mockResolvedValue({ text: ['·','·','·','·','·','·'].join('\n'), pageCount: 1 });
  const r = await extractText(args);
  expect(r.method).toBe('vision');
  expect(r.text).toContain('ADAPTIVE VISION TEXT');
  expect(describeSlides).toHaveBeenCalledOnce();
});
it('Granite throws → falls back to the adaptive pass', async () => {
  (transcribeWithGranite as any).mockRejectedValue(new Error('docling-serve down'));
  const r = await extractText(args);
  expect(r.method).toBe('vision'); expect(describeSlides).toHaveBeenCalledOnce();
});
it('flag OFF → Granite never called, straight to the adaptive pass', async () => {
  delete process.env.GRANITE_DOCLING_ENABLED;
  const r = await extractText(args);
  expect(r.method).toBe('vision'); expect(transcribeWithGranite).not.toHaveBeenCalled();
  expect(describeSlides).toHaveBeenCalledOnce();
});
