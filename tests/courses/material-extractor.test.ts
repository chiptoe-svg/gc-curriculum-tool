import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the upstream libs at the module boundary so backend selection +
// dispatch is observable without doing any real PDF/DOCX parsing.
const { unpdfExtractText, mammothExtractRawText } = vi.hoisted(() => ({
  unpdfExtractText: vi.fn(),
  mammothExtractRawText: vi.fn(),
}));
vi.mock('unpdf', () => ({ extractText: unpdfExtractText }));
vi.mock('mammoth', () => ({ default: { extractRawText: mammothExtractRawText } }));

import {
  getExtractorFor,
  isSupportedMimeType,
  SUPPORTED_MIME_TYPES,
  LEGACY_OFFICE_MIME_TYPES,
  __testing,
} from '@/lib/courses/material-extractor';

const { UnpdfExtractor, MammothExtractor, DoclingExtractor } = __testing;

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.PDF_PARSER;
  delete process.env.DOCLING_URL;
});

describe('SUPPORTED_MIME_TYPES & isSupportedMimeType', () => {
  it('covers all formats we accept at upload', () => {
    expect(SUPPORTED_MIME_TYPES).toContain(PDF);
    expect(SUPPORTED_MIME_TYPES).toContain(DOCX);
    expect(SUPPORTED_MIME_TYPES).toContain(PPTX);
    expect(SUPPORTED_MIME_TYPES).toContain(XLSX);
    expect(SUPPORTED_MIME_TYPES).toContain('text/csv');
    expect(SUPPORTED_MIME_TYPES).toContain('text/html');
    expect(SUPPORTED_MIME_TYPES).toContain('image/png');
    expect(SUPPORTED_MIME_TYPES).toContain('image/jpeg');
  });
  it('isSupportedMimeType narrows correctly', () => {
    expect(isSupportedMimeType(PDF)).toBe(true);
    expect(isSupportedMimeType('application/wat')).toBe(false);
  });
});

describe('LEGACY_OFFICE_MIME_TYPES', () => {
  it('flags .doc/.ppt/.xls', () => {
    expect(LEGACY_OFFICE_MIME_TYPES.has('application/msword')).toBe(true);
    expect(LEGACY_OFFICE_MIME_TYPES.has('application/vnd.ms-powerpoint')).toBe(true);
    expect(LEGACY_OFFICE_MIME_TYPES.has('application/vnd.ms-excel')).toBe(true);
  });
  it('does not flag modern types', () => {
    expect(LEGACY_OFFICE_MIME_TYPES.has(PDF)).toBe(false);
    expect(LEGACY_OFFICE_MIME_TYPES.has(DOCX)).toBe(false);
  });
});

describe('getExtractorFor — factory dispatch', () => {
  it('returns UnpdfExtractor for PDF by default (no PDF_PARSER)', () => {
    expect(getExtractorFor(PDF).name).toBe('unpdf');
  });
  it('returns MammothExtractor for DOCX by default', () => {
    expect(getExtractorFor(DOCX).name).toBe('mammoth');
  });
  it('throws on PPTX/XLSX/CSV/HTML/image when Docling is not configured', () => {
    for (const mime of [PPTX, XLSX, 'text/csv', 'text/html', 'image/png', 'image/jpeg']) {
      expect(() => getExtractorFor(mime)).toThrow(/require PDF_PARSER=docling/);
    }
  });
  it('returns DoclingExtractor for all supported types when PDF_PARSER=docling', () => {
    process.env.PDF_PARSER = 'docling';
    for (const mime of SUPPORTED_MIME_TYPES) {
      expect(getExtractorFor(mime).name).toBe('docling');
    }
  });
  it('throws on legacy .doc/.ppt/.xls with a re-save hint', () => {
    expect(() => getExtractorFor('application/msword'))
      .toThrow(/Legacy Office format.*re-save.*\.docx/);
    expect(() => getExtractorFor('application/vnd.ms-powerpoint'))
      .toThrow(/Legacy Office format/);
    expect(() => getExtractorFor('application/vnd.ms-excel'))
      .toThrow(/Legacy Office format/);
  });
  it('throws on an unrecognized PDF_PARSER value', () => {
    process.env.PDF_PARSER = 'magic';
    expect(() => getExtractorFor(PDF)).toThrow(/Unknown PDF_PARSER/);
  });
  it('trims env-var whitespace', () => {
    process.env.PDF_PARSER = '  docling  ';
    expect(getExtractorFor(PDF).name).toBe('docling');
  });
});

describe('UnpdfExtractor', () => {
  it('only supports PDF', () => {
    const ex = new UnpdfExtractor();
    expect(ex.supports(PDF)).toBe(true);
    expect(ex.supports(DOCX)).toBe(false);
    expect(ex.supports(PPTX)).toBe(false);
  });
  it('returns trimmed text + pageCount from unpdf', async () => {
    unpdfExtractText.mockResolvedValue({ text: '   foo bar  ', totalPages: 3 });
    const r = await new UnpdfExtractor().extract({ fileBytes: Buffer.from('x'), mimeType: PDF, fileName: 'x.pdf' });
    expect(r).toEqual({ text: 'foo bar', pageCount: 3 });
  });
  it('propagates unpdf errors', async () => {
    unpdfExtractText.mockRejectedValue(new Error('corrupt'));
    await expect(new UnpdfExtractor().extract({ fileBytes: Buffer.from('x'), mimeType: PDF, fileName: 'x.pdf' }))
      .rejects.toThrow('corrupt');
  });
});

describe('MammothExtractor', () => {
  it('only supports DOCX', () => {
    const ex = new MammothExtractor();
    expect(ex.supports(DOCX)).toBe(true);
    expect(ex.supports(PDF)).toBe(false);
  });
  it('returns trimmed text and pageCount=null', async () => {
    mammothExtractRawText.mockResolvedValue({ value: '  hello docx  ' });
    const r = await new MammothExtractor().extract({ fileBytes: Buffer.from('x'), mimeType: DOCX, fileName: 'x.docx' });
    expect(r).toEqual({ text: 'hello docx', pageCount: null });
  });
});

describe('DoclingExtractor', () => {
  const originalFetch = global.fetch;
  beforeEach(() => { global.fetch = vi.fn() as unknown as typeof fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  it('supports every modern format we accept', () => {
    const ex = new DoclingExtractor('http://localhost:5001');
    for (const mime of SUPPORTED_MIME_TYPES) expect(ex.supports(mime)).toBe(true);
    expect(ex.supports('application/msword')).toBe(false);
  });
  it('POSTs to /v1/convert/file with the right content-type', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, json: async () => ({ status: 'success', document: { md_content: 'x' } }),
    });
    await new DoclingExtractor('http://localhost:5001').extract({
      fileBytes: Buffer.from('x'), mimeType: PPTX, fileName: 'lecture.pptx',
    });
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(url).toBe('http://localhost:5001/v1/convert/file');
    expect(init).toMatchObject({ method: 'POST' });
  });
  it('throws when docling returns status=failure inside a 200 envelope', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'failure', errors: [{ error_message: 'MPS thing' }] }),
    });
    await expect(new DoclingExtractor('http://localhost:5001').extract({
      fileBytes: Buffer.from('x'), mimeType: PDF, fileName: 'x.pdf',
    })).rejects.toThrow(/conversion failed.*MPS thing/);
  });
  it('throws on non-2xx HTTP', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false, status: 500, text: async () => 'oops',
    });
    await expect(new DoclingExtractor('http://localhost:5001').extract({
      fileBytes: Buffer.from('x'), mimeType: PDF, fileName: 'x.pdf',
    })).rejects.toThrow(/docling-serve 500.*oops/);
  });
  it('falls back to text_content when md_content is null', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, json: async () => ({ status: 'success', document: { md_content: null, text_content: 'plain' } }),
    });
    const r = await new DoclingExtractor('http://localhost:5001').extract({
      fileBytes: Buffer.from('x'), mimeType: PDF, fileName: 'x.pdf',
    });
    expect(r.text).toBe('plain');
  });
  it('counts pages from --- separators', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, json: async () => ({ status: 'success', document: { md_content: 'p1\n\n---\n\np2\n\n---\n\np3' } }),
    });
    const r = await new DoclingExtractor('http://localhost:5001').extract({
      fileBytes: Buffer.from('x'), mimeType: PDF, fileName: 'x.pdf',
    });
    expect(r.pageCount).toBe(3);
  });
  it('strips trailing slash on baseUrl', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, json: async () => ({ status: 'success', document: { md_content: 'x' } }),
    });
    await new DoclingExtractor('http://localhost:5001/').extract({
      fileBytes: Buffer.from('x'), mimeType: XLSX, fileName: 'data.xlsx',
    });
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(url).toBe('http://localhost:5001/v1/convert/file');
  });
});
