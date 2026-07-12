/**
 * Material text extraction orchestrator.
 *
 * Delegates the actual byte→text work to lib/courses/material-extractor.ts
 * (which picks unpdf/mammoth/Docling per PDF_PARSER + MIME type), then
 * applies the PDF-specific vision-fallback heuristic for image-based
 * PDFs that yield too little text from textual extraction alone.
 *
 * The vision fallback only fires for application/pdf. Other formats
 * either have meaningful text or don't — they return as `text` or
 * `low_text` directly, never as `vision`.
 */

import { getExtractorFor, transcribeWithGranite, SUPPORTED_MIME_TYPES } from '@/lib/courses/material-extractor';
import { isLegacyOfficeMime, convertLegacyToModern } from '@/lib/courses/legacy-converter';
import { getProvider } from '@/lib/ai/provider';
import { repetitionRatio } from '@/lib/courses/repetition-ratio';

// Re-export the supported-types list and type name so callers (upload
// route, schemas) read the same source of truth as the extractor itself.
export { SUPPORTED_MIME_TYPES } from '@/lib/courses/material-extractor';
export type ExtractedMimeType = (typeof SUPPORTED_MIME_TYPES)[number];

export interface ExtractTextArgs {
  fileBytes: Buffer;
  mimeType: ExtractedMimeType;
  fileName: string;
}

export interface ExtractTextOptions {
  /** When set, image-PDF vision transcription uses this provider instead of the
   *  global getProvider(). Used by the ingest worker's local-only mode. */
  visionProvider?: import('@/lib/ai/provider').AIProvider;
}

export interface ExtractTextResult {
  method?: 'text' | 'vision' | 'granite';
  status: 'ok' | 'low_text' | 'failed';
  text?: string;
  pageCount?: number;
  /** Cost in 1/100 of a cent, only present when vision transcription was used. */
  visionCostUsdCents?: number;
}

/**
 * Heuristic: if the PDF yields fewer than this many characters per page on
 * average, it is treated as image-based and sent to vision transcription.
 */
const MIN_CHARS_PER_PAGE = 100;

/** Minimum chars for text to be considered meaningful (not low_text). */
const MIN_MEANINGFUL_CHARS = 10;

/** Max pages to send to vision to bound cost + latency. */
const VISION_PAGE_CAP = 40;

/** Granite output with repetition ratio at or above this threshold is considered degenerate. */
const GRANITE_REPETITION_THRESHOLD = 0.3;

export async function extractText(args: ExtractTextArgs, opts?: ExtractTextOptions): Promise<ExtractTextResult> {
  let { fileBytes, mimeType, fileName } = args;

  // Legacy Office files (.doc / .ppt / .xls): convert to modern equivalent
  // via LibreOffice headless, then continue as if the upload had been
  // modern. Only works when soffice is on PATH (local Mac deploy).
  // Failure here returns status=failed; the upload row stays visible
  // with a 'failed' badge so faculty know to re-save manually.
  if (isLegacyOfficeMime(mimeType)) {
    try {
      const converted = await convertLegacyToModern(fileBytes, mimeType, fileName);
      fileBytes = converted.fileBytes;
      mimeType = converted.mimeType as ExtractedMimeType;
      fileName = converted.fileName;
    } catch {
      return { status: 'failed' };
    }
  }

  // Pick the backend up front. If the configuration doesn't support this
  // type (e.g., PPTX requested without PDF_PARSER=docling), the factory
  // throws — surface as status=failed so the upload row stays visible
  // but flagged.
  let extractor;
  try {
    extractor = getExtractorFor(mimeType);
  } catch {
    return { status: 'failed' };
  }

  let pageCount: number | undefined;
  let text = '';
  try {
    const r = await extractor.extract({ fileBytes, mimeType, fileName });
    text = r.text;
    pageCount = r.pageCount ?? undefined;
  } catch {
    return { status: 'failed' };
  }

  // Vision fallback applies only to PDFs — image-based PDFs (scanned
  // documents, all-image slides) yield near-zero text from any textual
  // extractor and need a vision pass to recover content. Other formats
  // don't have an analog (a near-empty PPTX is just near-empty).
  if (mimeType === 'application/pdf') {
    const charsPerPage = pageCount && pageCount > 0 ? text.length / pageCount : text.length;
    const isImageBased = charsPerPage < MIN_CHARS_PER_PAGE;
    if (isImageBased) {
      if (process.env.GRANITE_DOCLING_ENABLED && process.env.GRANITE_DOCLING_ENABLED !== 'false') {
        try {
          const g = await transcribeWithGranite({ fileBytes, mimeType, fileName });
          const gText = g.text.trim();
          if (gText.length >= MIN_MEANINGFUL_CHARS && repetitionRatio(gText) < GRANITE_REPETITION_THRESHOLD) {
            return { method: 'granite', status: 'ok', text: gText, pageCount: g.pageCount || pageCount, visionCostUsdCents: 0 };
          }
          // else: declined (empty / short / repetitive) → fall through to OpenAI below
        } catch {
          // Granite error → fall through to OpenAI below (Granite can only decline, never fail)
        }
      }
      try {
        const provider = opts?.visionProvider ?? getProvider();
        const transcribed = await provider.transcribeDocument({
          fileBytes,
          mimeType,
          maxPages: VISION_PAGE_CAP,
        });
        const vText = transcribed.text.trim();
        const status = vText.length < MIN_MEANINGFUL_CHARS ? 'low_text' : 'ok';
        return {
          method: 'vision',
          status,
          text: vText,
          pageCount,
          visionCostUsdCents: transcribed.costUsdCents,
        };
      } catch {
        return { method: 'vision', status: 'failed', pageCount };
      }
    }
  }

  if (text.length < MIN_MEANINGFUL_CHARS) {
    return { method: 'text', status: 'low_text', text, pageCount };
  }
  return { method: 'text', status: 'ok', text, pageCount };
}
