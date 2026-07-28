import { describe, it, expect, vi, beforeEach } from 'vitest';

// getExtractorFor MUST NOT be called for image-heavy decks (that's the crash path).
const { getExtractorFor, transcribeDocument, buildLocalProvider, getProvider } = vi.hoisted(() => ({
  getExtractorFor: vi.fn(() => {
    throw new Error('Docling getExtractorFor must NOT be called for image decks');
  }),
  transcribeDocument: vi.fn(async () => ({ text: 'Slide one text\n\nSlide two text', costUsdCents: 0, truncated: false })),
  buildLocalProvider: vi.fn(),
  getProvider: vi.fn(),
}));

vi.mock('@/lib/courses/material-extractor', async (orig) => {
  const actual = await orig<typeof import('@/lib/courses/material-extractor')>();
  return { ...actual, getExtractorFor, transcribeWithGranite: vi.fn() };
});
vi.mock('@/lib/courses/pdf-classify', () => ({
  isImageHeavyPdf: vi.fn(async () => true),
  pdfPageInfo: vi.fn(async () => ({ pageCount: 12, widthPt: 960, heightPt: 540 })),
}));
vi.mock('@/lib/ai/provider', () => ({ getProvider, buildLocalProvider }));

import { extractText } from '@/lib/courses/extract-text';

beforeEach(() => {
  vi.clearAllMocks();
  buildLocalProvider.mockReturnValue({ transcribeDocument });
});

describe('extractText — image-heavy PDF routing', () => {
  it('routes image-heavy PDFs to qwen (buildLocalProvider + forceOffload) and never calls Docling', async () => {
    const r = await extractText({ fileBytes: Buffer.from('%PDF'), mimeType: 'application/pdf', fileName: 'deck.pdf' });
    expect(r.status).toBe('ok');
    expect(r.method).toBe('vision');
    expect(r.text).toContain('Slide one text');
    expect(r.pageCount).toBe(12); // from pdfPageInfo
    expect(getExtractorFor).not.toHaveBeenCalled(); // Docling never constructed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((transcribeDocument.mock.calls[0] as any)[0]).toMatchObject({ forceOffload: true });
  });
});
