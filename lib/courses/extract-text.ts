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
import { getProvider, buildLocalProvider } from '@/lib/ai/provider';
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
  /** Skip Docling's picture-description pass (see ExtractArgs). Set by the ingest
   *  worker for middle-tier slide decks — describeSlides covers per-slide vision. */
  skipPictureDescription?: boolean;
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

/**
 * The image-PDF vision cascade: granite (if enabled) → local qwen (Spark) → OpenAI.
 * Reachable two ways: (1) a PDF whose textual extraction came back near-empty
 * (`isImageBased`, forceLocalOffload=false — preserves the historical OpenAI-default
 * behaviour unless LOCAL_HARDSCAN_OCR is set); (2) the upfront geometry route for
 * image-heavy decks (forceLocalOffload=true — always try qwen first, per issue #4,
 * since sending a design deck to OpenAI defeats the local-first provider decision).
 */
async function runVisionFallback(
  args: ExtractTextArgs,
  opts: ExtractTextOptions | undefined,
  pageCount: number | undefined,
  forceLocalOffload: boolean,
): Promise<ExtractTextResult> {
  const { fileBytes, fileName } = args;
  // runVisionFallback is only invoked for PDFs (both call sites gate on it); narrow the
  // mimeType so the transcribe args (pdf | docx) typecheck — the enclosing `if` used to
  // do this narrowing before the cascade was lifted into this helper.
  const mimeType = args.mimeType as Extract<ExtractedMimeType, 'application/pdf'>;
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
  // Lane 3 — flat OCR fallback for hard/handwritten scans + image decks. Transcribe on
  // Qwen-35B via the Spark (buildLocalProvider + forceOffload) when forced (image route)
  // or when LOCAL_HARDSCAN_OCR is on, AND we are not already in "use local" mode (which
  // injects opts.visionProvider). Fall through to OpenAI on any failure/empty so
  // ingestion never breaks.
  const hardscanLocal =
    !opts?.visionProvider &&
    (forceLocalOffload ||
      (!!process.env.LOCAL_HARDSCAN_OCR && process.env.LOCAL_HARDSCAN_OCR !== 'false'));
  if (hardscanLocal) {
    try {
      const local = buildLocalProvider();
      const t = await local.transcribeDocument({
        fileBytes,
        mimeType,
        maxPages: VISION_PAGE_CAP,
        forceOffload: true,
      });
      const localText = t.text.trim();
      if (localText.length >= MIN_MEANINGFUL_CHARS) {
        return {
          method: 'vision',
          status: 'ok',
          text: localText,
          pageCount,
          visionCostUsdCents: t.costUsdCents,
        };
      }
      // empty/short → fall through to the OpenAI fallback below
    } catch {
      // local/Spark error → fall through to the OpenAI fallback below
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
    const r = await extractor.extract({ fileBytes, mimeType, fileName, skipPictureDescription: opts?.skipPictureDescription });
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
      // Existing behaviour: OpenAI default unless LOCAL_HARDSCAN_OCR is set (forceLocalOffload=false).
      return runVisionFallback(args, opts, pageCount, false);
    }
  }

  if (text.length < MIN_MEANINGFUL_CHARS) {
    return { method: 'text', status: 'low_text', text, pageCount };
  }
  return { method: 'text', status: 'ok', text, pageCount };
}
