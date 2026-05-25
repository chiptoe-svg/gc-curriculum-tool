/**
 * PDF text extractor abstraction.
 *
 * Two backends today:
 *
 *   - `unpdf` (default, runs in-process) — text-only, used on Vercel
 *     where we cannot run a separate parsing service. Adequate for
 *     text-heavy PDFs; mangles tables, ignores figures.
 *   - `docling` (calls a local docling-serve HTTP endpoint) — used on
 *     the local Mac deployment (see Phase 2 hybrid-deploy plan).
 *     Reconstructs tables, optionally describes figures via a VLM
 *     configured server-side in docling-serve itself.
 *
 * Both produce the same shape: text + page count. The vision-fallback
 * heuristic in `extract-text.ts` still operates on the resulting text
 * density and is independent of which backend produced it.
 *
 * Selection is by `PDF_PARSER` env var, defaulting to `unpdf`. Failures
 * propagate as thrown errors; the caller maps them to extraction
 * status `failed`.
 */

import { extractText as unpdfExtractText } from 'unpdf';

export interface PdfExtractorResult {
  text: string;
  pageCount: number;
}

export interface PdfExtractor {
  readonly name: 'unpdf' | 'docling';
  extract(fileBytes: Buffer): Promise<PdfExtractorResult>;
}

class UnpdfExtractor implements PdfExtractor {
  readonly name = 'unpdf' as const;
  async extract(fileBytes: Buffer): Promise<PdfExtractorResult> {
    // unpdf wants a Uint8Array view, not the raw Buffer, to avoid
    // pdfjs-dist misinterpreting the underlying ArrayBuffer when
    // offsets differ.
    const parsed = await unpdfExtractText(new Uint8Array(fileBytes), { mergePages: true });
    return {
      text: (parsed.text ?? '').trim(),
      pageCount: parsed.totalPages,
    };
  }
}

class DoclingExtractor implements PdfExtractor {
  readonly name = 'docling' as const;
  constructor(private readonly baseUrl: string) {}

  async extract(fileBytes: Buffer): Promise<PdfExtractorResult> {
    // docling-serve v1 API: multipart upload, returns markdown by
    // default. We ask for markdown explicitly so the table reconstruction
    // (docling's main draw over text-stream extractors) lands in the
    // output as proper markdown tables.
    //
    // The response also reports status='failure' with errors[] inside a
    // 200 envelope (e.g., MPS device errors on Apple Silicon when
    // DOCLING_DEVICE=cpu isn't set), so we must check status alongside
    // res.ok.
    const form = new FormData();
    const blob = new Blob([new Uint8Array(fileBytes)], { type: 'application/pdf' });
    form.append('files', blob, 'document.pdf');
    form.append('to_formats', 'md');

    const url = `${this.baseUrl.replace(/\/$/, '')}/v1/convert/file`;
    const res = await fetch(url, { method: 'POST', body: form });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`docling-serve ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as DoclingResponse;
    if (data.status && data.status !== 'success') {
      const reason = data.errors?.[0]?.error_message ?? 'unknown failure';
      throw new Error(`docling-serve conversion failed: ${reason}`);
    }
    const doc = data.document ?? {};
    const text = (doc.md_content ?? doc.text_content ?? '').trim();
    // docling-serve's ExportDocumentResponse doesn't surface page count
    // directly when only markdown is requested. Best-effort count from
    // common page-break separators ('---' on its own line); falls back
    // to 1 for non-empty text, 0 for empty.
    const pageCount = text ? Math.max(1, (text.match(/^---$/gm) ?? []).length + 1) : 0;
    return { text, pageCount };
  }
}

interface DoclingResponse {
  status?: 'success' | 'failure' | string;
  errors?: Array<{ error_message?: string; module_name?: string }>;
  document?: {
    md_content?: string | null;
    text_content?: string | null;
  };
}

export function getPdfExtractor(): PdfExtractor {
  const which = process.env.PDF_PARSER?.trim() || 'unpdf';
  if (which === 'unpdf') return new UnpdfExtractor();
  if (which === 'docling') {
    const baseUrl = process.env.DOCLING_URL?.trim() || 'http://localhost:5001';
    return new DoclingExtractor(baseUrl);
  }
  throw new Error(`Unknown PDF_PARSER: ${which}. Expected 'unpdf' or 'docling'.`);
}

// Exported for tests; do not use directly from app code.
export const __testing = { UnpdfExtractor, DoclingExtractor };
