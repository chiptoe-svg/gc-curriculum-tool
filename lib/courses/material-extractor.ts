/**
 * Material text extractor abstraction.
 *
 * Replaces the earlier PDF-only `pdf-extractor.ts` (renamed 2026-05-25
 * during Phase 2 format expansion). Three backends, picked per upload
 * by MIME type and the PDF_PARSER env var:
 *
 *   - **DoclingExtractor** — HTTP call to a local docling-serve. Handles
 *     PDF, DOCX, PPTX, XLSX, CSV, HTML, and images (with OCR). The
 *     only backend for the non-PDF/non-DOCX formats. Requires
 *     PDF_PARSER=docling and DOCLING_URL set + a docling-serve
 *     process reachable.
 *   - **UnpdfExtractor** — in-process pdfjs-dist-based fallback for
 *     PDF when Docling isn't configured (i.e., the Vercel deploy).
 *   - **MammothExtractor** — in-process DOCX fallback for the same
 *     Vercel-deploy reason.
 *
 * Legacy Office formats (.doc / .ppt / .xls) are intentionally
 * unsupported — Docling can't parse them, and the few legacy-format
 * uploaders should re-save as .docx / .pptx / .xlsx.
 *
 * Vision fallback for image-based PDFs (charsPerPage < threshold →
 * route to a vision model) lives in extract-text.ts, not here. This
 * abstraction is purely "give me text from these bytes."
 */

import { extractText as unpdfExtractText } from 'unpdf';
import mammoth from 'mammoth';

// Source-format MIME types the system can handle. Anything outside this
// list is rejected at the upload-route allowlist level — by the time a
// MaterialExtractor is invoked, we expect a known type.
export const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',  // .docx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',        // .xlsx
  'text/csv',
  'text/html',
  'image/png',
  'image/jpeg',
] as const;
export type SupportedMimeType = (typeof SUPPORTED_MIME_TYPES)[number];

// Legacy Office formats — recognized so we can give a helpful error
// instead of a generic "unsupported MIME type" rejection.
export const LEGACY_OFFICE_MIME_TYPES = new Set([
  'application/msword',                       // .doc
  'application/vnd.ms-powerpoint',            // .ppt
  'application/vnd.ms-excel',                 // .xls
]);

export function isSupportedMimeType(mime: string): mime is SupportedMimeType {
  return (SUPPORTED_MIME_TYPES as readonly string[]).includes(mime);
}

export interface MaterialExtractorResult {
  text: string;
  /**
   * Pages for PDFs, slides for PPTX, sheets for XLSX, etc. Null when
   * the concept doesn't apply (CSV, HTML, single-image input).
   */
  pageCount: number | null;
}

export interface MaterialExtractor {
  readonly name: 'unpdf' | 'docling' | 'mammoth';
  supports(mimeType: string): boolean;
  extract(args: { fileBytes: Buffer; mimeType: string; fileName: string }): Promise<MaterialExtractorResult>;
}

// ─── Backends ──────────────────────────────────────────────────────────────

class UnpdfExtractor implements MaterialExtractor {
  readonly name = 'unpdf' as const;
  supports(mimeType: string): boolean { return mimeType === 'application/pdf'; }
  async extract(args: { fileBytes: Buffer; mimeType: string; fileName: string }): Promise<MaterialExtractorResult> {
    const parsed = await unpdfExtractText(new Uint8Array(args.fileBytes), { mergePages: true });
    return { text: (parsed.text ?? '').trim(), pageCount: parsed.totalPages };
  }
}

class MammothExtractor implements MaterialExtractor {
  readonly name = 'mammoth' as const;
  supports(mimeType: string): boolean {
    return mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  async extract(args: { fileBytes: Buffer; mimeType: string; fileName: string }): Promise<MaterialExtractorResult> {
    const result = await mammoth.extractRawText({ buffer: args.fileBytes });
    return { text: (result.value ?? '').trim(), pageCount: null };
  }
}

class DoclingExtractor implements MaterialExtractor {
  readonly name = 'docling' as const;
  // Docling's supported `from_formats` (per its OpenAPI spec) covers
  // every modern type in our allowlist plus a handful (md, latex, audio)
  // we don't accept at the upload layer yet.
  private static readonly SUPPORTED = new Set<string>([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'text/html',
    'image/png',
    'image/jpeg',
  ]);
  constructor(private readonly baseUrl: string) {}
  supports(mimeType: string): boolean { return DoclingExtractor.SUPPORTED.has(mimeType); }

  async extract({ fileBytes, mimeType, fileName }: { fileBytes: Buffer; mimeType: string; fileName: string }): Promise<MaterialExtractorResult> {
    // docling-serve auto-detects from_format based on the upload's
    // content-type + filename, so we don't pass from_formats explicitly.
    // We do ask for markdown specifically — Docling's main quality
    // win is rendering tables as proper markdown tables.
    const form = new FormData();
    const blob = new Blob([new Uint8Array(fileBytes)], { type: mimeType });
    form.append('files', blob, fileName);
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
    // Best-effort page/slide/sheet count from --- separators in the markdown.
    // Docling's ExportDocumentResponse doesn't surface a count field when
    // only md is requested.
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

// ─── Factory ───────────────────────────────────────────────────────────────

/**
 * Returns a MaterialExtractor that supports the given MIME type, picked
 * according to PDF_PARSER and the type's available backends.
 *
 * Resolution rules:
 *   1. PDF_PARSER=docling AND Docling supports the type → DoclingExtractor.
 *      Most-capable path; required for PPTX/XLSX/CSV/HTML/image.
 *   2. UnpdfExtractor handles PDF; MammothExtractor handles DOCX. These
 *      cover the Vercel-deploy fallback when Docling isn't configured.
 *   3. No backend supports the type → throw a clear error. Callers should
 *      handle by surfacing the message to the user.
 *
 * Legacy Office types (.doc/.ppt/.xls) throw a specific message about
 * re-saving as modern format.
 */
export function getExtractorFor(mimeType: string): MaterialExtractor {
  if (LEGACY_OFFICE_MIME_TYPES.has(mimeType)) {
    throw new Error(
      `Legacy Office format (${mimeType}) is not supported. ` +
      `Please re-save the file as .docx / .pptx / .xlsx and upload again.`,
    );
  }

  const parser = process.env.PDF_PARSER?.trim() || 'unpdf';
  if (parser === 'docling') {
    const baseUrl = process.env.DOCLING_URL?.trim() || 'http://localhost:5001';
    const docling = new DoclingExtractor(baseUrl);
    if (docling.supports(mimeType)) return docling;
    // PDF_PARSER=docling is set but Docling itself doesn't support this type
    // — fall through to local fallbacks (unpdf/mammoth). Unlikely in practice
    // since Docling covers every supported type, but defensive.
  } else if (parser !== 'unpdf') {
    throw new Error(`Unknown PDF_PARSER: ${parser}. Expected 'unpdf' or 'docling'.`);
  }

  const unpdf = new UnpdfExtractor();
  if (unpdf.supports(mimeType)) return unpdf;
  const mammothEx = new MammothExtractor();
  if (mammothEx.supports(mimeType)) return mammothEx;

  // Type isn't supported by any backend in the current configuration.
  throw new Error(
    `Cannot extract from MIME type '${mimeType}' in the current configuration. ` +
    `PPTX, XLSX, CSV, HTML, and image uploads require PDF_PARSER=docling ` +
    `with a running docling-serve.`,
  );
}

// Exported for tests.
export const __testing = { UnpdfExtractor, MammothExtractor, DoclingExtractor };
