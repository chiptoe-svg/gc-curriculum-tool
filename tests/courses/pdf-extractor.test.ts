import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock unpdf at the module boundary so UnpdfExtractor's call is observable
// without doing any real PDF parsing.
const { unpdfExtractText } = vi.hoisted(() => ({ unpdfExtractText: vi.fn() }));
vi.mock('unpdf', () => ({ extractText: unpdfExtractText }));

import { getPdfExtractor, __testing } from '@/lib/courses/pdf-extractor';

const { DoclingExtractor } = __testing;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.PDF_PARSER;
  delete process.env.DOCLING_URL;
});

describe('getPdfExtractor — factory dispatch', () => {
  it('returns the unpdf extractor by default', () => {
    expect(getPdfExtractor().name).toBe('unpdf');
  });

  it('returns the unpdf extractor when PDF_PARSER=unpdf', () => {
    process.env.PDF_PARSER = 'unpdf';
    expect(getPdfExtractor().name).toBe('unpdf');
  });

  it('returns the docling extractor when PDF_PARSER=docling', () => {
    process.env.PDF_PARSER = 'docling';
    expect(getPdfExtractor().name).toBe('docling');
  });

  it('throws on an unrecognized PDF_PARSER value', () => {
    process.env.PDF_PARSER = 'magic';
    expect(() => getPdfExtractor()).toThrow(/Unknown PDF_PARSER/);
  });

  it('trims surrounding whitespace from PDF_PARSER (env-var hygiene)', () => {
    process.env.PDF_PARSER = '  docling  ';
    expect(getPdfExtractor().name).toBe('docling');
  });
});

describe('UnpdfExtractor', () => {
  it('returns text and pageCount mapped from unpdf result', async () => {
    unpdfExtractText.mockResolvedValue({ text: '   hello world  ', totalPages: 7 });
    const result = await getPdfExtractor().extract(Buffer.from('fake'));
    expect(result.text).toBe('hello world');
    expect(result.pageCount).toBe(7);
  });

  it('returns empty text when unpdf yields nothing', async () => {
    unpdfExtractText.mockResolvedValue({ text: '', totalPages: 0 });
    const result = await getPdfExtractor().extract(Buffer.from('fake'));
    expect(result.text).toBe('');
    expect(result.pageCount).toBe(0);
  });

  it('propagates unpdf errors (caller maps to status=failed)', async () => {
    unpdfExtractText.mockRejectedValue(new Error('corrupt pdf'));
    await expect(getPdfExtractor().extract(Buffer.from('fake'))).rejects.toThrow('corrupt pdf');
  });
});

describe('DoclingExtractor', () => {
  // We mock global fetch since DoclingExtractor calls fetch() directly.
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('POSTs to /v1alpha/convert/file and returns md_content + num_pages', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ document: { md_content: '  # Title\n\nBody', num_pages: 3 } }),
    });
    const ext = new DoclingExtractor('http://localhost:5001');
    const result = await ext.extract(Buffer.from('%PDF-1.4 fake'));
    expect(result.text).toBe('# Title\n\nBody');
    expect(result.pageCount).toBe(3);
    const callArg = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(callArg).toBe('http://localhost:5001/v1alpha/convert/file');
  });

  it('strips a trailing slash on baseUrl so we never double-slash', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ document: { md_content: 'x', num_pages: 1 } }),
    });
    const ext = new DoclingExtractor('http://localhost:5001/');
    await ext.extract(Buffer.from('fake'));
    const callArg = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(callArg).toBe('http://localhost:5001/v1alpha/convert/file');
  });

  it('falls back to text_content when md_content is absent', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ document: { text_content: 'plain text only', num_pages: 2 } }),
    });
    const result = await new DoclingExtractor('http://localhost:5001').extract(Buffer.from('fake'));
    expect(result.text).toBe('plain text only');
    expect(result.pageCount).toBe(2);
  });

  it('throws on non-2xx response with a truncated error body', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'internal explosion',
    });
    await expect(
      new DoclingExtractor('http://localhost:5001').extract(Buffer.from('fake')),
    ).rejects.toThrow(/docling-serve 500.*internal explosion/);
  });

  it('throws when fetch itself rejects (server down)', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      new DoclingExtractor('http://localhost:5001').extract(Buffer.from('fake')),
    ).rejects.toThrow('ECONNREFUSED');
  });

  it('counts pages from --- separators when num_pages is absent', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        document: { md_content: 'page 1 text\n\n---\n\npage 2 text\n\n---\n\npage 3 text' },
      }),
    });
    const result = await new DoclingExtractor('http://localhost:5001').extract(Buffer.from('fake'));
    expect(result.pageCount).toBe(3);
  });

  it('returns pageCount=0 when the document is empty', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ document: { md_content: '' } }),
    });
    const result = await new DoclingExtractor('http://localhost:5001').extract(Buffer.from('fake'));
    expect(result.text).toBe('');
    expect(result.pageCount).toBe(0);
  });
});
