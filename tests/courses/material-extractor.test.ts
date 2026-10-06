import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the upstream libs at the module boundary so backend selection +
// dispatch is observable without doing any real PDF/DOCX parsing.
const { unpdfExtractText, mammothExtractRawText, detectScan, execFileMock, fsp } = vi.hoisted(() => ({
  unpdfExtractText: vi.fn(),
  mammothExtractRawText: vi.fn(),
  detectScan: vi.fn(),
  execFileMock: vi.fn(),
  fsp: {
    mkdtemp: vi.fn(),
    writeFile: vi.fn(),
    readdir: vi.fn(),
    readFile: vi.fn(),
    rm: vi.fn(),
  },
}));
vi.mock('unpdf', () => ({ extractText: unpdfExtractText }));
vi.mock('mammoth', () => ({ default: { extractRawText: mammothExtractRawText } }));
vi.mock('@/lib/courses/scan-detect', () => ({ detectScan }));
// extractByPageSplit's dynamic `import('node:child_process')` / `import('node:fs/promises')`
// — mocked so the large-PDF split tests below don't need a real `pdfseparate` on PATH or
// touch the real filesystem.
vi.mock('node:child_process', () => ({
  execFile: (file: string, args: string[], callback: (err: unknown, stdout: string, stderr: string) => void) => {
    execFileMock(file, args);
    callback(null, '', '');
  },
}));
vi.mock('node:fs/promises', () => fsp);

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
  // Default: not scanned, so existing PDF tests keep exercising the sync path.
  detectScan.mockResolvedValue({ kind: 'digital', reason: 'test default' });
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
    // OCR is disabled — born-digital text comes from the text layer; scanned PDFs
    // fall to the vision lanes via the isImageBased gate (~4-6x faster extraction).
    const form = (init as { body: FormData }).body;
    // OCR stays ON (Docling default) — it extracts chart/table data from images.
    expect(form.get('do_ocr')).toBeNull();
  });
  it('skipPictureDescription gates captioning but always keeps image_export_mode=placeholder', async () => {
    process.env.DOCLING_VLM_ENABLED = 'true';
    try {
      const run = async (skip?: boolean) => {
        (global.fetch as ReturnType<typeof vi.fn>).mockClear();
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
          ok: true, json: async () => ({ status: 'success', document: { md_content: 'x' } }),
        });
        await new DoclingExtractor('http://localhost:5001').extract({
          fileBytes: Buffer.from('x'), mimeType: PPTX, fileName: 'l.pptx', skipPictureDescription: skip,
        });
        const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
        return (init as { body: FormData }).body;
      };
      // default (deck tier flag not set): picture-description ON, base64 stripped
      let form = await run(undefined);
      expect(form.get('do_picture_description')).toBe('true');
      expect(form.get('image_export_mode')).toBe('placeholder');
      // middle-tier deck (skip): captioning OFF, but base64 still stripped (decoupled)
      form = await run(true);
      expect(form.get('do_picture_description')).toBeNull();
      expect(form.get('image_export_mode')).toBe('placeholder');
    } finally {
      delete process.env.DOCLING_VLM_ENABLED;
    }
  });
  it('falls back to DOCLING_FALLBACK_URL when the primary docling-serve fails', async () => {
    process.env.DOCLING_FALLBACK_URL = 'http://127.0.0.1:5001';
    try {
      let call = 0;
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (u: string) => {
        call += 1;
        if (call === 1) throw new TypeError('fetch failed'); // primary unreachable
        return { ok: true, json: async () => ({ status: 'success', document: { md_content: '## ok' } }) };
      });
      const r = await new DoclingExtractor('http://130.127.162.68:5001').extract({
        fileBytes: Buffer.from('x'), mimeType: PPTX, fileName: 'a.pptx',
      });
      expect(r.text).toContain('## ok');
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(String(calls[0]![0])).toContain('130.127.162.68'); // primary tried first
      expect(String(calls[1]![0])).toContain('127.0.0.1');       // then the fallback
    } finally {
      delete process.env.DOCLING_FALLBACK_URL;
    }
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

  describe('scan detection + force_ocr + async path', () => {
    it('does not call detectScan for non-PDF types', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true, json: async () => ({ status: 'success', document: { md_content: 'x' } }),
      });
      await new DoclingExtractor('http://localhost:5001').extract({
        fileBytes: Buffer.from('x'), mimeType: PPTX, fileName: 'x.pptx',
      });
      expect(detectScan).not.toHaveBeenCalled();
    });

    it('passes fileBytes to detectScan for PDFs and omits force_ocr when digital', async () => {
      detectScan.mockResolvedValue({ kind: 'digital', reason: 'full-page images on 0/5 sampled pages' });
      const bytes = Buffer.from('pdf-bytes');
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true, json: async () => ({ status: 'success', document: { md_content: 'x' } }),
      });
      await new DoclingExtractor('http://localhost:5001').extract({
        fileBytes: bytes, mimeType: PDF, fileName: 'x.pdf',
      });
      expect(detectScan).toHaveBeenCalledWith(bytes);
      const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
      expect(url).toBe('http://localhost:5001/v1/convert/file'); // sync path, unchanged
      const form = (init as { body: FormData }).body;
      expect(form.get('force_ocr')).toBeNull();
    });

    it('unknown verdict also stays on the sync path without force_ocr', async () => {
      detectScan.mockResolvedValue({ kind: 'unknown', reason: 'unreadable: Error' });
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true, json: async () => ({ status: 'success', document: { md_content: 'x' } }),
      });
      await new DoclingExtractor('http://localhost:5001').extract({
        fileBytes: Buffer.from('x'), mimeType: PDF, fileName: 'x.pdf',
      });
      const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
      expect(url).toBe('http://localhost:5001/v1/convert/file');
      const form = (init as { body: FormData }).body;
      expect(form.get('force_ocr')).toBeNull();
    });

    it('scanned verdict sets force_ocr=true and routes through the async submit/poll/result API', async () => {
      detectScan.mockResolvedValue({ kind: 'scanned', reason: "producer word 'Scan'" });
      const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.endsWith('/v1/convert/file/async')) {
          return { ok: true, json: async () => ({ task_id: 'task-123', task_status: 'pending' }) };
        }
        if (url.includes('/v1/status/poll/task-123')) {
          return { ok: true, json: async () => ({ task_id: 'task-123', task_status: 'success' }) };
        }
        if (url.endsWith('/v1/result/task-123')) {
          return { ok: true, json: async () => ({ status: 'success', document: { md_content: 'ocr text' } }) };
        }
        throw new Error(`unexpected fetch: ${url}`);
      });
      const r = await new DoclingExtractor('http://localhost:5001').extract({
        fileBytes: Buffer.from('x'), mimeType: PDF, fileName: 'scan.pdf',
      });
      expect(r.text).toBe('ocr text');
      // Never hit the sync endpoint.
      expect(calls.some(c => c.url === 'http://localhost:5001/v1/convert/file')).toBe(false);
      const submitCall = calls.find(c => c.url.endsWith('/v1/convert/file/async'));
      expect(submitCall).toBeDefined();
      const submitForm = (submitCall!.init as { body: FormData }).body;
      expect(submitForm.get('force_ocr')).toBe('true');
      expect(calls.some(c => c.url.includes('/v1/status/poll/task-123'))).toBe(true);
      expect(calls.some(c => c.url.endsWith('/v1/result/task-123'))).toBe(true);
    });

    it('throws when the async task reaches a failure status', async () => {
      detectScan.mockResolvedValue({ kind: 'scanned', reason: "producer word 'Scan'" });
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
        if (url.endsWith('/v1/convert/file/async')) {
          return { ok: true, json: async () => ({ task_id: 'task-err', task_status: 'pending' }) };
        }
        if (url.includes('/v1/status/poll/task-err')) {
          return { ok: true, json: async () => ({ task_id: 'task-err', task_status: 'failure', error_message: 'boom' }) };
        }
        throw new Error(`unexpected fetch: ${url}`);
      });
      await expect(new DoclingExtractor('http://localhost:5001').extract({
        fileBytes: Buffer.from('x'), mimeType: PDF, fileName: 'scan.pdf',
      })).rejects.toThrow(/task-err.*boom/);
    });

    it('throws on non-2xx HTTP when submitting the async task', async () => {
      detectScan.mockResolvedValue({ kind: 'scanned', reason: "producer word 'Scan'" });
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false, status: 500, text: async () => 'async submit failed',
      });
      await expect(new DoclingExtractor('http://localhost:5001').extract({
        fileBytes: Buffer.from('x'), mimeType: PDF, fileName: 'scan.pdf',
      })).rejects.toThrow(/docling-serve 500.*async submit failed/);
    });

    describe('polling loop (review finding #5 — fake timers, no real sleeps)', () => {
      afterEach(() => {
        vi.useRealTimers();
      });

      it('polls through several non-terminal statuses (pending -> started -> started -> success) before fetching the result', async () => {
        vi.useFakeTimers();
        detectScan.mockResolvedValue({ kind: 'scanned', reason: "x" });
        const statuses = ['pending', 'started', 'started', 'success'];
        let pollCalls = 0;
        (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
          if (url.endsWith('/v1/convert/file/async')) {
            return { ok: true, json: async () => ({ task_id: 'multi', task_status: 'pending' }) };
          }
          if (url.includes('/v1/status/poll/multi')) {
            const status = statuses[pollCalls] ?? 'success';
            pollCalls++;
            return { ok: true, json: async () => ({ task_id: 'multi', task_status: status }) };
          }
          if (url.endsWith('/v1/result/multi')) {
            return { ok: true, json: async () => ({ status: 'success', document: { md_content: 'multi-poll result' } }) };
          }
          throw new Error(`unexpected fetch: ${url}`);
        });

        const promise = new DoclingExtractor('http://localhost:5001').extract({
          fileBytes: Buffer.from('x'), mimeType: PDF, fileName: 'scan.pdf',
        });
        await vi.runAllTimersAsync();
        const r = await promise;

        expect(r.text).toBe('multi-poll result');
        expect(pollCalls).toBe(statuses.length); // one poll per status, no extra/missing iterations
      });

      it('throws after exhausting max poll attempts on a task that never reaches a terminal status', async () => {
        vi.useFakeTimers();
        detectScan.mockResolvedValue({ kind: 'scanned', reason: "x" });
        let pollCalls = 0;
        (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
          if (url.endsWith('/v1/convert/file/async')) {
            return { ok: true, json: async () => ({ task_id: 'stuck', task_status: 'pending' }) };
          }
          if (url.includes('/v1/status/poll/stuck')) {
            pollCalls++;
            return { ok: true, json: async () => ({ task_id: 'stuck', task_status: 'started' }) }; // never terminal
          }
          throw new Error(`unexpected fetch: ${url}`); // /v1/result must never be called
        });

        const promise = new DoclingExtractor('http://localhost:5001').extract({
          fileBytes: Buffer.from('x'), mimeType: PDF, fileName: 'scan.pdf',
        }).catch((err: unknown) => err as Error);
        await vi.runAllTimersAsync();
        const err = await promise;

        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toMatch(/timed out polling/);
        expect(pollCalls).toBe(100); // ASYNC_MAX_POLL_ATTEMPTS — confirms the loop actually caps, not just "eventually throws"
      });

      it('treats partial_success as terminal and proceeds to fetch the result', async () => {
        vi.useFakeTimers();
        detectScan.mockResolvedValue({ kind: 'scanned', reason: "x" });
        (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
          if (url.endsWith('/v1/convert/file/async')) {
            return { ok: true, json: async () => ({ task_id: 'partial', task_status: 'pending' }) };
          }
          if (url.includes('/v1/status/poll/partial')) {
            return { ok: true, json: async () => ({ task_id: 'partial', task_status: 'partial_success' }) };
          }
          if (url.endsWith('/v1/result/partial')) {
            return { ok: true, json: async () => ({ status: 'partial_success', document: { md_content: 'best effort' } }) };
          }
          throw new Error(`unexpected fetch: ${url}`);
        });

        const promise = new DoclingExtractor('http://localhost:5001').extract({
          fileBytes: Buffer.from('x'), mimeType: PDF, fileName: 'scan.pdf',
        });
        await vi.runAllTimersAsync();
        const r = await promise;

        expect(r.text).toBe('best effort');
      });

      it('treats skipped as terminal and throws (ambiguous outcome, not silently treated as success)', async () => {
        vi.useFakeTimers();
        detectScan.mockResolvedValue({ kind: 'scanned', reason: "x" });
        (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
          if (url.endsWith('/v1/convert/file/async')) {
            return { ok: true, json: async () => ({ task_id: 'skip', task_status: 'pending' }) };
          }
          if (url.includes('/v1/status/poll/skip')) {
            return { ok: true, json: async () => ({ task_id: 'skip', task_status: 'skipped' }) };
          }
          throw new Error(`unexpected fetch: ${url}`); // /v1/result must never be called for 'skipped'
        });

        const promise = new DoclingExtractor('http://localhost:5001').extract({
          fileBytes: Buffer.from('x'), mimeType: PDF, fileName: 'scan.pdf',
        }).catch((err: unknown) => err as Error);
        await vi.runAllTimersAsync();
        const err = await promise;

        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toMatch(/task skip skipped/);
      });
    });
  });

  describe('large-PDF routing: scanned skips the split, digital keeps it (review finding #2)', () => {
    const LARGE_BYTES = Buffer.alloc(2 * 1024 * 1024 + 10, 0x41); // > LARGE_PDF_THRESHOLD_BYTES

    it('a large SCANNED PDF skips pdfseparate entirely and sends ONE async force_ocr job on the whole document', async () => {
      detectScan.mockResolvedValue({ kind: 'scanned', reason: "producer word 'Scan'" });
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
        if (url.endsWith('/v1/convert/file/async')) {
          return { ok: true, json: async () => ({ task_id: 'big-scan', task_status: 'pending' }) };
        }
        if (url.includes('/v1/status/poll/big-scan')) {
          return { ok: true, json: async () => ({ task_id: 'big-scan', task_status: 'success' }) };
        }
        if (url.endsWith('/v1/result/big-scan')) {
          return { ok: true, json: async () => ({ status: 'success', document: { md_content: 'whole-document ocr text' } }) };
        }
        throw new Error(`unexpected fetch: ${url}`);
      });

      const r = await new DoclingExtractor('http://localhost:5001').extract({
        fileBytes: LARGE_BYTES, mimeType: PDF, fileName: 'big-scan.pdf',
      });

      expect(detectScan).toHaveBeenCalledTimes(1);
      expect(detectScan).toHaveBeenCalledWith(LARGE_BYTES);
      expect(execFileMock).not.toHaveBeenCalled(); // pdfseparate never runs
      expect(fsp.mkdtemp).not.toHaveBeenCalled(); // split path never entered
      expect(r.text).toBe('whole-document ocr text');
      expect(r.text).not.toContain('--- page'); // not page-split output
      // Sync endpoint never touched; exactly one whole-document async submission.
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const submitCalls = calls.filter(([url]) => String(url).endsWith('/v1/convert/file/async'));
      expect(submitCalls).toHaveLength(1);
      const submittedForm = (submitCalls[0]![1] as { body: FormData }).body;
      const submittedFile = submittedForm.get('files') as File;
      expect(submittedFile.size).toBe(LARGE_BYTES.length); // whole document, not a single split page
    });

    it('a large DIGITAL PDF still uses the existing pdfseparate page-split path, unchanged', async () => {
      detectScan.mockResolvedValue({ kind: 'digital', reason: 'full-page images on 0/5 sampled pages' });
      fsp.mkdtemp.mockResolvedValue('/tmp/pdf-split-test');
      fsp.writeFile.mockResolvedValue(undefined);
      fsp.readdir.mockResolvedValue(['page-1.pdf', 'page-2.pdf']);
      fsp.readFile.mockImplementation(async (p: string) =>
        Buffer.from(p.includes('page-1') ? 'page-1-bytes' : 'page-2-bytes'));
      fsp.rm.mockResolvedValue(undefined);
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
        ok: true, json: async () => ({ status: 'success', document: { md_content: 'page text' } }),
      }));

      const r = await new DoclingExtractor('http://localhost:5001').extract({
        fileBytes: LARGE_BYTES, mimeType: PDF, fileName: 'big-digital.pdf',
      });

      // Decided once for the whole document, not re-run per split page.
      expect(detectScan).toHaveBeenCalledTimes(1);
      expect(execFileMock).toHaveBeenCalledWith('pdfseparate', expect.anything());
      expect(r.text).toContain('--- page 1 ---');
      expect(r.text).toContain('--- page 2 ---');
      expect(r.pageCount).toBe(2);
      // Both per-page conversions went through the sync endpoint (force_ocr off).
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls).toHaveLength(2);
      for (const [url, init] of calls) {
        expect(String(url)).toBe('http://localhost:5001/v1/convert/file');
        const form = (init as { body: FormData }).body;
        expect(form.get('force_ocr')).toBeNull();
      }
    });
  });
});
