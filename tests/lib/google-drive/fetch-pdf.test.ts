import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// extractText is mocked so the test exercises only fetch-pdf's fetch +
// type-detection logic, not the real Docling/pdf pipeline.
vi.mock('@/lib/courses/extract-text', () => ({
  extractText: vi.fn(async () => ({ status: 'ok', text: 'Extracted PDF body text.', method: 'text' })),
}));

import { fetchDrivePdf } from '@/lib/google-drive/fetch-pdf';

const FILE_ID = 'aBcD1234EfGh5678';

function mockResponse(opts: {
  ok?: boolean;
  status?: number;
  contentType?: string;
  contentLength?: number;
  body: Uint8Array;
}): Response {
  const headers = new Map<string, string>();
  if (opts.contentType !== undefined) headers.set('content-type', opts.contentType);
  if (opts.contentLength !== undefined) headers.set('content-length', String(opts.contentLength));
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    arrayBuffer: async () => opts.body.buffer.slice(opts.body.byteOffset, opts.body.byteOffset + opts.body.byteLength),
  } as unknown as Response;
}

const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n...binary...');
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic
const HTML_BYTES = new TextEncoder().encode('<!DOCTYPE html><html><head><title>Sign in</title></head>');

describe('fetchDrivePdf — type detection by magic bytes', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('accepts a PDF served as application/pdf', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ contentType: 'application/pdf', body: PDF_BYTES }),
    );
    const r = await fetchDrivePdf(FILE_ID);
    expect(r.status).toBe('ok');
    expect(r.text).toContain('Extracted PDF');
  });

  it('accepts a PDF served as application/octet-stream (the GC 2400 case)', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ contentType: 'application/octet-stream', body: PDF_BYTES }),
    );
    const r = await fetchDrivePdf(FILE_ID);
    expect(r.status).toBe('ok');
  });

  it('accepts a PDF served with no Content-Type header at all', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ body: PDF_BYTES }),
    );
    const r = await fetchDrivePdf(FILE_ID);
    expect(r.status).toBe('ok');
  });

  it('reports a genuine non-PDF (PNG bytes) as unsupported', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ contentType: 'application/octet-stream', body: PNG_BYTES }),
    );
    const r = await fetchDrivePdf(FILE_ID);
    expect(r.status).toBe('unsupported');
  });

  it('reports an HTML sign-in page as inaccessible, even via Content-Type header', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ contentType: 'text/html; charset=utf-8', body: HTML_BYTES }),
    );
    const r = await fetchDrivePdf(FILE_ID);
    expect(r.status).toBe('inaccessible');
  });

  it('reports an HTML body with a misleading non-HTML Content-Type as inaccessible (magic fallback)', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ contentType: 'application/octet-stream', body: HTML_BYTES }),
    );
    const r = await fetchDrivePdf(FILE_ID);
    expect(r.status).toBe('inaccessible');
  });

  it('rejects an invalid file id without fetching', async () => {
    const r = await fetchDrivePdf('short');
    expect(r.status).toBe('inaccessible');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports too_large from the content-length header before downloading', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ contentType: 'application/pdf', contentLength: 50 * 1024 * 1024, body: PDF_BYTES }),
    );
    const r = await fetchDrivePdf(FILE_ID);
    expect(r.status).toBe('too_large');
  });
});
