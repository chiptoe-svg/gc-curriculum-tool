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
import { compactSpreadsheetMarkdown } from '@/lib/capture/spreadsheet-compact';
import { visionModel } from '@/lib/ai/vision-models';

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

  /**
   * Size threshold above which Docling has historically timed out or
   * silently failed on PDFs (notably 13 MB image-heavy lab manuals).
   * For PDFs over this size, we split into pages via poppler's
   * `pdfseparate`, extract each page individually, and concatenate —
   * Docling's working set stays small, a single bad page no longer
   * poisons the whole document, and every page gets a `--- page N ---`
   * citation marker. 2 MB threshold captures most multi-page lab
   * manuals + assignment briefs while letting short syllabus PDFs
   * (typically <1 MB) take the faster single-call path.
   */
  private static readonly LARGE_PDF_THRESHOLD_BYTES = 2 * 1024 * 1024;

  async extract({ fileBytes, mimeType, fileName }: { fileBytes: Buffer; mimeType: string; fileName: string }): Promise<MaterialExtractorResult> {
    // Large-PDF path: split into pages first, extract each, concatenate.
    // Page-citable output: each page's text is prefaced with `--- page N ---`
    // so downstream chunking + the agent's citation tooling can reference
    // specific pages. Per-page failures are isolated rather than fatal.
    if (mimeType === 'application/pdf' && fileBytes.length > DoclingExtractor.LARGE_PDF_THRESHOLD_BYTES) {
      return this.extractByPageSplit(fileBytes, fileName);
    }
    return this.extractWhole({ fileBytes, mimeType, fileName });
  }

  private async extractWhole({ fileBytes, mimeType, fileName }: { fileBytes: Buffer; mimeType: string; fileName: string }): Promise<MaterialExtractorResult> {
    // docling-serve auto-detects from_format based on the upload's
    // content-type + filename, so we don't pass from_formats explicitly.
    // We do ask for markdown specifically — Docling's main quality
    // win is rendering tables as proper markdown tables.
    const form = new FormData();
    const blob = new Blob([new Uint8Array(fileBytes)], { type: mimeType });
    form.append('files', blob, fileName);
    form.append('to_formats', 'md');

    // XLSX images (embedded charts, logos, screenshots) are almost never
    // audit-relevant — the agent cares about cell content, not the
    // graphics. Skip image extraction entirely so Docling doesn't drop
    // base64 data URIs into the markdown. Defaults to include_images=true
    // upstream, so for PDFs/DOCX/PPTX we still pull them.
    const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (mimeType === XLSX_MIME) {
      form.append('include_images', 'false');
    }

    // Optional VLM picture-description pass. Enabled when DOCLING_VLM_ENABLED
    // is truthy AND docling-serve was started with
    // DOCLING_SERVE_ALLOW_CUSTOM_PICTURE_DESCRIPTION_CONFIG=true and
    // DOCLING_SERVE_ENABLE_REMOTE_SERVICES=true. The VLM is an OpenAI-compatible
    // backend pointed at by DOCLING_VLM_URL (defaults to local omlx).
    // image_export_mode=placeholder keeps the markdown lean — we want the
    // VLM's description, not the base64 image bytes.
    if (process.env.DOCLING_VLM_ENABLED && process.env.DOCLING_VLM_ENABLED !== 'false') {
      form.append('do_picture_description', 'true');
      form.append('image_export_mode', 'placeholder');
      const vlmConfig = {
        model_spec: {
          name: visionModel('docPicture').model,
          // Informational only on the engine_type:'api' path (Docling calls the
          // remote URL, it doesn't load the model) — kept aligned with the gemma
          // captioner for clarity; the actual model is `name` / params.model.
          default_repo_id: 'mlx-community/gemma-4-12B-it-qat-4bit',
          prompt: process.env.DOCLING_VLM_PROMPT
            ?? 'Describe this image in 1-2 sentences. Focus on content and concepts (chart type, axes, key values, diagram structure, etc.). Reply with only the description — no preamble.',
          response_format: 'plaintext',
          max_new_tokens: 200,
        },
        engine_options: {
          engine_type: 'api',
          url: process.env.DOCLING_VLM_URL ?? 'http://localhost:8000/v1/chat/completions',
          headers: process.env.DOCLING_VLM_API_KEY
            ? { Authorization: `Bearer ${process.env.DOCLING_VLM_API_KEY}` }
            : {},
          params: { model: visionModel('docPicture').model },
          timeout: 120,
        },
      };
      form.append('picture_description_custom_config', JSON.stringify(vlmConfig));
    }

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
    const rawText = (doc.md_content ?? doc.text_content ?? '').trim();
    // XLSX → markdown output is dominated by sparse-cell syntax noise
    // (Docling preserves every cell of every sheet). Compact it before
    // returning so the digest + indexing pipeline sees content-shaped
    // markdown rather than 100× syntax overhead.
    const text = mimeType === XLSX_MIME ? compactSpreadsheetMarkdown(rawText) : rawText;
    // Best-effort page/slide/sheet count from --- separators in the markdown.
    // Docling's ExportDocumentResponse doesn't surface a count field when
    // only md is requested.
    const pageCount = text ? Math.max(1, (text.match(/^---$/gm) ?? []).length + 1) : 0;
    return { text, pageCount };
  }

  /**
   * Large-PDF path. Splits the PDF into per-page files via poppler's
   * `pdfseparate`, extracts each page through Docling, and concatenates
   * the results with `--- page N ---` separator headers so the downstream
   * chunker + agent citation surface can reference specific pages.
   *
   * Per-page failures are recorded as "extraction failed" placeholders
   * but do not abort the whole document — a single bad scan page no
   * longer takes down a 10-page lab manual.
   *
   * Requires poppler-utils (`pdfseparate`) on PATH. Local Mac has it via
   * `brew install poppler`; the Vercel deploy doesn't use this extractor
   * because PDF_PARSER=unpdf there.
   */
  private async extractByPageSplit(fileBytes: Buffer, fileName: string): Promise<MaterialExtractorResult> {
    const fsp = await import('node:fs/promises');
    const os = await import('node:os');
    const pathMod = await import('node:path');
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    // Promisified execFile (NOT exec — no shell involved; args pass through
    // as a literal array, so paths with spaces / shell-meta-chars are safe).
    const execFileAsync = promisify(execFile);

    const tmpDir = await fsp.mkdtemp(pathMod.join(os.tmpdir(), 'pdf-split-'));
    try {
      const srcPath = pathMod.join(tmpDir, 'src.pdf');
      await fsp.writeFile(srcPath, fileBytes);

      // pdfseparate writes one file per page using %d substitution.
      const pagePattern = pathMod.join(tmpDir, 'page-%d.pdf');
      await execFileAsync('pdfseparate', [srcPath, pagePattern]);

      const entries = await fsp.readdir(tmpDir);
      const pageFiles = entries
        .filter(f => /^page-\d+\.pdf$/.test(f))
        .sort((a, b) => {
          const na = parseInt(a.match(/page-(\d+)\.pdf/)?.[1] ?? '0', 10);
          const nb = parseInt(b.match(/page-(\d+)\.pdf/)?.[1] ?? '0', 10);
          return na - nb;
        });

      if (pageFiles.length === 0) {
        throw new Error('pdfseparate produced zero pages — input may be malformed');
      }

      const sections: string[] = [];
      let successful = 0;
      for (const f of pageFiles) {
        const pageNum = parseInt(f.match(/page-(\d+)\.pdf/)?.[1] ?? '0', 10);
        const pageBytes = await fsp.readFile(pathMod.join(tmpDir, f));
        try {
          const r = await this.extractWhole({
            fileBytes: pageBytes,
            mimeType: 'application/pdf',
            fileName: `${fileName}#page-${pageNum}`,
          });
          if (r.text && r.text.trim().length > 0) {
            sections.push(`--- page ${pageNum} ---\n\n${r.text}`);
            successful++;
          } else {
            sections.push(`--- page ${pageNum} (no text extracted) ---`);
          }
        } catch (err) {
          console.error(`pdf-split: page ${pageNum} extraction failed`,
            err instanceof Error ? err.message : err);
          sections.push(`--- page ${pageNum} (extraction failed) ---`);
        }
      }

      if (successful === 0) {
        // Whole document yielded zero usable text — propagate as a failure
        // so the caller marks extractionStatus=failed rather than persisting
        // a document of separator placeholders.
        throw new Error(`pdf-split: all ${pageFiles.length} pages failed to extract`);
      }

      return {
        text: sections.join('\n\n'),
        pageCount: pageFiles.length,
      };
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => { /* ignore */ });
    }
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

/**
 * Transcribe an image-based document via docling-serve's Granite-Docling VLM
 * pipeline (pipeline=vlm + vlm_pipeline_model=granite_docling). Structured,
 * local, free. Throws on any docling-serve error so the caller (extractText)
 * can fall back to the OpenAI vision path. Base URL = DOCLING_URL (:5001).
 */
export async function transcribeWithGranite(
  { fileBytes, mimeType, fileName }: { fileBytes: Buffer; mimeType: string; fileName: string },
): Promise<{ text: string; pageCount: number }> {
  const baseUrl = (process.env.DOCLING_URL?.trim() || 'http://localhost:5001').replace(/\/$/, '');
  const form = new FormData();
  form.append('files', new Blob([new Uint8Array(fileBytes)], { type: mimeType }), fileName);
  form.append('to_formats', 'md');
  form.append('pipeline', 'vlm');
  form.append('vlm_pipeline_model', 'granite_docling');

  const res = await fetch(`${baseUrl}/v1/convert/file`, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`granite docling-serve ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as DoclingResponse;
  if (data.status && data.status !== 'success') {
    throw new Error(`granite conversion failed: ${data.errors?.[0]?.error_message ?? 'unknown'}`);
  }
  const doc = data.document ?? {};
  const text = (doc.md_content ?? doc.text_content ?? '').trim();
  const pageCount = text ? Math.max(1, (text.match(/^---$/gm) ?? []).length + 1) : 0;
  return { text, pageCount };
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
