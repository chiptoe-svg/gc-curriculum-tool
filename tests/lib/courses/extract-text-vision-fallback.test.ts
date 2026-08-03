import { it, expect, vi, beforeEach } from 'vitest';
import type { SlideNote } from '@/lib/capture/slide-vision';

// Extractor yields image-based (near-empty) text for a PDF → the vision fallback.
vi.mock('@/lib/courses/material-extractor', async (orig) => {
  const actual = await orig<typeof import('@/lib/courses/material-extractor')>();
  return {
    ...actual,
    getExtractorFor: () => ({ name: 'docling', supports: () => true, extract: async () => ({ text: '', pageCount: 2 }) }),
    transcribeWithGranite: vi.fn(),
  };
});

// The vision fallback renders the PDF and runs ONE adaptive describeSlides pass.
// (Was: LOCAL_HARDSCAN_OCR / buildLocalProvider.transcribeDocument / OpenAI fallback /
// injected visionProvider — all removed 2026-08-02. The verbatim transcribeDocument
// prompt narrated empty slides, which was persisted as document text (Flavour B).)
const renderToImages = vi.fn(async () => [Buffer.from('img1'), Buffer.from('img2')]);
const describeSlides = vi.fn<(pngs: Buffer[]) => Promise<SlideNote[]>>();
vi.mock('@/lib/capture/render-pages', () => ({ renderToImages: (...a: unknown[]) => renderToImages(...(a as [])) }));
vi.mock('@/lib/capture/slide-vision', async (orig) => ({
  ...(await orig<typeof import('@/lib/capture/slide-vision')>()), // keep real notesToExtractedText
  describeSlides: (pngs: Buffer[]) => describeSlides(pngs),
}));

import { extractText } from '@/lib/courses/extract-text';

const args = { fileBytes: Buffer.from('%PDF'), mimeType: 'application/pdf' as const, fileName: 'scan.pdf' };

beforeEach(() => {
  vi.clearAllMocks();
  renderToImages.mockResolvedValue([Buffer.from('img1'), Buffer.from('img2')]);
});

it('image-PDF → one adaptive describeSlides pass; extracted_text + slideNotes returned', async () => {
  const notes: SlideNote[] = [
    { topic: 'Vectors', teaches: 'scaling', keyVisual: 'a chart', text: 'Vectors scale without loss.', contentLevel: 'substantive' },
    { topic: '', teaches: '', keyVisual: '', text: '', contentLevel: 'low' }, // genuinely empty → contributes nothing
  ];
  describeSlides.mockResolvedValue(notes);
  const r = await extractText(args);
  expect(r).toMatchObject({ method: 'vision', status: 'ok' });
  expect(r.text).toContain('Vectors scale without loss.');
  expect(r.text).not.toMatch(/blank|nothing to transcribe/i); // no failure narration, ever
  expect(r.slideNotes).toEqual(notes); // threaded to finalize for single-pass chunk reuse
  expect(describeSlides).toHaveBeenCalledOnce();
});

it('all-empty notes (nothing on any page) → low_text (retriable), not a narration', async () => {
  describeSlides.mockResolvedValue([
    { topic: '', teaches: '', keyVisual: '', text: '', contentLevel: 'low' },
    { topic: '', teaches: '', keyVisual: '', text: '', contentLevel: 'low' },
  ]);
  const r = await extractText(args);
  expect(r.method).toBe('vision');
  expect(r.status).toBe('low_text');
});

it('render produces no pages → failed (no crash)', async () => {
  renderToImages.mockResolvedValue([]);
  const r = await extractText(args);
  expect(r).toMatchObject({ method: 'vision', status: 'failed' });
  expect(describeSlides).not.toHaveBeenCalled();
});
