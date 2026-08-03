import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mocks so they're available before imports are resolved.
const { mammoth, extractPdfText, getProvider } = vi.hoisted(() => ({
  mammoth: { extractRawText: vi.fn() },
  extractPdfText: vi.fn(),
  getProvider: vi.fn(),
}));

vi.mock('mammoth', () => ({ default: mammoth }));
vi.mock('unpdf', () => ({ extractText: extractPdfText }));
vi.mock('@/lib/ai/provider', () => ({ getProvider }));

// The image-PDF vision fallback now renders + runs the adaptive describeSlides pass
// (was getProvider().transcribeDocument — removed 2026-08-02). Keep real
// notesToExtractedText so the extracted_text derivation is exercised.
import type { SlideNote } from '@/lib/capture/slide-vision';
const renderToImages = vi.fn(async () => [Buffer.from('p1')]);
const describeSlides = vi.fn<(pngs: Buffer[]) => Promise<SlideNote[]>>();
vi.mock('@/lib/capture/render-pages', () => ({ renderToImages: (...a: unknown[]) => renderToImages(...(a as [])) }));
vi.mock('@/lib/capture/slide-vision', async (orig) => ({
  ...(await orig<typeof import('@/lib/capture/slide-vision')>()),
  describeSlides: (pngs: Buffer[]) => describeSlides(pngs),
}));

import { extractText } from '@/lib/courses/extract-text';

const fakeTranscribe = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  // extractText routes through getExtractorFor (material-extractor), which is
  // NOT mocked here — only mammoth/unpdf are. When .env.local is sourced it
  // sets PDF_PARSER=docling + DOCLING_URL, so DOCX/PDF would hit the real
  // DoclingExtractor (HTTP to :5001) and bypass these mocks entirely (8 tests
  // time out at 5s each). Force the default `unpdf` path so the mocks apply.
  delete process.env.PDF_PARSER;
  delete process.env.DOCLING_URL;
  getProvider.mockReturnValue({
    name: 'fake',
    model: 'fake-model',
    transcribeDocument: fakeTranscribe,
    complete: vi.fn(),
  });
  renderToImages.mockResolvedValue([Buffer.from('p1')]); // one rendered page by default
});

describe('extractText — DOCX', () => {
  it('returns method=text, status=ok for a DOCX with good text', async () => {
    mammoth.extractRawText.mockResolvedValue({ value: 'This is a rubric with lots of text to read.' });
    const result = await extractText({
      fileBytes: Buffer.from('fake'),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileName: 'rubric.docx',
    });
    expect(result.method).toBe('text');
    expect(result.status).toBe('ok');
    expect(result.text).toContain('rubric');
    expect(result.pageCount).toBeUndefined();
  });

  it('returns status=low_text when DOCX yields very little text', async () => {
    mammoth.extractRawText.mockResolvedValue({ value: 'hi' });
    const result = await extractText({
      fileBytes: Buffer.from('fake'),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileName: 'blank.docx',
    });
    expect(result.status).toBe('low_text');
    expect(result.method).toBe('text');
  });

  it('returns status=failed when mammoth throws', async () => {
    mammoth.extractRawText.mockRejectedValue(new Error('corrupt file'));
    const result = await extractText({
      fileBytes: Buffer.from('fake'),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileName: 'bad.docx',
    });
    expect(result.status).toBe('failed');
    expect(result.method).toBeUndefined();
  });
});

describe('extractText — digital PDF', () => {
  it('returns method=text, status=ok for a PDF with good text density', async () => {
    extractPdfText.mockResolvedValue({ text: 'A'.repeat(500), totalPages: 2 });
    const result = await extractText({
      fileBytes: Buffer.from('fake'),
      mimeType: 'application/pdf',
      fileName: 'syllabus.pdf',
    });
    expect(result.method).toBe('text');
    expect(result.status).toBe('ok');
    expect(result.pageCount).toBe(2);
  });

  it('routes to vision when text density is below threshold (< 100 chars/page)', async () => {
    // 1 page, only 50 chars — well below the 100 chars/page heuristic.
    extractPdfText.mockResolvedValue({ text: 'B'.repeat(50), totalPages: 1 });
    describeSlides.mockResolvedValue([
      { topic: 't', teaches: 'x', keyVisual: '', text: 'Transcribed text from vision.', contentLevel: 'substantive' },
    ]);
    const result = await extractText({
      fileBytes: Buffer.from('fake'),
      mimeType: 'application/pdf',
      fileName: 'scan.pdf',
    });
    expect(result.method).toBe('vision');
    expect(result.status).toBe('ok');
    expect(result.text).toContain('Transcribed text from vision.');
    expect(describeSlides).toHaveBeenCalledOnce();
  });

  it('returns status=low_text when the vision pass finds nothing on any page', async () => {
    extractPdfText.mockResolvedValue({ text: '', totalPages: 3 });
    // All-empty notes (no text, no imagery) → notesToExtractedText yields '' → low_text
    // (retriable), never a narration of the emptiness.
    describeSlides.mockResolvedValue([
      { topic: '', teaches: '', keyVisual: '', text: '', contentLevel: 'low' },
    ]);
    const result = await extractText({
      fileBytes: Buffer.from('fake'),
      mimeType: 'application/pdf',
      fileName: 'unreadable.pdf',
    });
    expect(result.method).toBe('vision');
    expect(result.status).toBe('low_text');
  });

  it('returns status=failed when the PDF parser throws', async () => {
    extractPdfText.mockRejectedValue(new Error('bad pdf'));
    const result = await extractText({
      fileBytes: Buffer.from('fake'),
      mimeType: 'application/pdf',
      fileName: 'corrupt.pdf',
    });
    expect(result.status).toBe('failed');
    expect(result.method).toBeUndefined();
  });

  it('a large deck still extracts ok via the vision pass (page cap lives inside renderToImages)', async () => {
    // The old 40-page maxPages cap moved into renderToImages (caps at 60); pageCount
    // now reflects the pages actually rendered/described, not the source total.
    extractPdfText.mockResolvedValue({ text: '', totalPages: 60 });
    renderToImages.mockResolvedValue([Buffer.from('p1'), Buffer.from('p2')]);
    describeSlides.mockResolvedValue([
      { topic: 'a', teaches: 'x', keyVisual: '', text: 'Partial transcription.', contentLevel: 'substantive' },
      { topic: 'b', teaches: 'y', keyVisual: '', text: 'More slide text.', contentLevel: 'substantive' },
    ]);
    const result = await extractText({
      fileBytes: Buffer.from('fake'),
      mimeType: 'application/pdf',
      fileName: 'huge.pdf',
    });
    expect(result.method).toBe('vision');
    expect(result.status).toBe('ok');
    expect(result.text).toContain('Partial transcription.');
    expect(result.pageCount).toBe(2); // rendered pages, not the 60-page source total
  });
});
