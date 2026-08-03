import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SlideNote } from '@/lib/capture/slide-vision';

// getExtractorFor MUST NOT be called for image-heavy decks (that's the Docling crash path).
const { getExtractorFor } = vi.hoisted(() => ({
  getExtractorFor: vi.fn(() => {
    throw new Error('Docling getExtractorFor must NOT be called for image decks');
  }),
}));

vi.mock('@/lib/courses/material-extractor', async (orig) => {
  const actual = await orig<typeof import('@/lib/courses/material-extractor')>();
  return { ...actual, getExtractorFor, transcribeWithGranite: vi.fn() };
});
vi.mock('@/lib/courses/pdf-classify', () => ({
  isImageHeavyPdf: vi.fn(async () => true),
  pdfPageInfo: vi.fn(async () => ({ pageCount: 12, widthPt: 960, heightPt: 540 })),
}));

// The geometry route now renders + runs ONE adaptive describeSlides pass (was:
// buildLocalProvider().transcribeDocument with forceOffload — removed 2026-08-02).
const renderToImages = vi.fn(async () => [Buffer.from('p1'), Buffer.from('p2')]);
const describeSlides = vi.fn<(pngs: Buffer[]) => Promise<SlideNote[]>>();
vi.mock('@/lib/capture/render-pages', () => ({ renderToImages: (...a: unknown[]) => renderToImages(...(a as [])) }));
vi.mock('@/lib/capture/slide-vision', async (orig) => ({
  ...(await orig<typeof import('@/lib/capture/slide-vision')>()), // keep real notesToExtractedText
  describeSlides: (pngs: Buffer[]) => describeSlides(pngs),
}));

import { extractText } from '@/lib/courses/extract-text';

beforeEach(() => {
  vi.clearAllMocks();
  renderToImages.mockResolvedValue([Buffer.from('p1'), Buffer.from('p2')]);
  describeSlides.mockResolvedValue([
    { topic: 'Slide one', teaches: 'x', keyVisual: '', text: 'Slide one text', contentLevel: 'substantive' },
    { topic: 'Slide two', teaches: 'y', keyVisual: '', text: 'Slide two text', contentLevel: 'substantive' },
  ]);
});

describe('extractText — image-heavy PDF routing', () => {
  it('routes image-heavy decks to the adaptive vision pass and never calls Docling', async () => {
    const r = await extractText({ fileBytes: Buffer.from('%PDF'), mimeType: 'application/pdf', fileName: 'deck.pdf' });
    expect(r.status).toBe('ok');
    expect(r.method).toBe('vision');
    expect(r.text).toContain('Slide one text');
    expect(r.pageCount).toBe(2); // number of rendered/described pages
    expect(r.slideNotes).toHaveLength(2); // threaded to finalize for single-pass reuse
    expect(getExtractorFor).not.toHaveBeenCalled(); // Docling (crash path) never constructed
    expect(describeSlides).toHaveBeenCalledOnce();
  });
});
