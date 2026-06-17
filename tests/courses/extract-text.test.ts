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
    fakeTranscribe.mockResolvedValue({ text: 'Transcribed text from vision.', costUsdCents: 20, truncated: false });
    const result = await extractText({
      fileBytes: Buffer.from('fake'),
      mimeType: 'application/pdf',
      fileName: 'scan.pdf',
    });
    expect(result.method).toBe('vision');
    expect(result.status).toBe('ok');
    expect(result.text).toBe('Transcribed text from vision.');
    expect(fakeTranscribe).toHaveBeenCalledOnce();
  });

  it('returns status=low_text when vision also returns very little text', async () => {
    extractPdfText.mockResolvedValue({ text: '', totalPages: 3 });
    fakeTranscribe.mockResolvedValue({ text: 'hi', costUsdCents: 10, truncated: false });
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

  it('caps vision at 40 pages and sets status=ok with truncated text', async () => {
    extractPdfText.mockResolvedValue({ text: '', totalPages: 60 });
    fakeTranscribe.mockResolvedValue({ text: 'Partial transcription.', costUsdCents: 30, truncated: true });
    const result = await extractText({
      fileBytes: Buffer.from('fake'),
      mimeType: 'application/pdf',
      fileName: 'huge.pdf',
    });
    expect(result.method).toBe('vision');
    // Truncated file still yields text — status is ok (not failed).
    expect(result.status).toBe('ok');
    expect(fakeTranscribe).toHaveBeenCalledWith(
      expect.objectContaining({ maxPages: 40 }),
    );
  });
});
