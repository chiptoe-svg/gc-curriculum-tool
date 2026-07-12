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

import { extractText } from '@/lib/courses/extract-text';
import { transcribeWithGranite } from '@/lib/courses/material-extractor';

const fakeVision = { transcribeDocument: vi.fn(async () => ({ text: 'OPENAI FALLBACK TEXT that is long enough', costUsdCents: 5 })) };
const args = { fileBytes: Buffer.from('%PDF'), mimeType: 'application/pdf' as const, fileName: 's.pdf' };

beforeEach(() => { process.env.GRANITE_DOCLING_ENABLED = '1'; vi.clearAllMocks(); });
afterEach(() => { delete process.env.GRANITE_DOCLING_ENABLED; });

it('clean Granite output → method granite, cost 0, OpenAI not called', async () => {
  (transcribeWithGranite as any).mockResolvedValue({ text: '## R\n\npara a\n\npara b\n\npara c', pageCount: 1 });
  const r = await extractText(args, { visionProvider: fakeVision as any });
  expect(r.method).toBe('granite'); expect(r.visionCostUsdCents).toBe(0);
  expect(fakeVision.transcribeDocument).not.toHaveBeenCalled();
});
it('junk (repetitive) Granite output → falls back to OpenAI (method vision)', async () => {
  (transcribeWithGranite as any).mockResolvedValue({ text: ['·','·','·','·','·','·'].join('\n'), pageCount: 1 });
  const r = await extractText(args, { visionProvider: fakeVision as any });
  expect(r.method).toBe('vision'); expect(fakeVision.transcribeDocument).toHaveBeenCalledOnce();
});
it('Granite throws → falls back to OpenAI', async () => {
  (transcribeWithGranite as any).mockRejectedValue(new Error('docling-serve down'));
  const r = await extractText(args, { visionProvider: fakeVision as any });
  expect(r.method).toBe('vision'); expect(fakeVision.transcribeDocument).toHaveBeenCalledOnce();
});
it('flag OFF → Granite never called, straight to OpenAI', async () => {
  delete process.env.GRANITE_DOCLING_ENABLED;
  const r = await extractText(args, { visionProvider: fakeVision as any });
  expect(r.method).toBe('vision'); expect(transcribeWithGranite).not.toHaveBeenCalled();
});
