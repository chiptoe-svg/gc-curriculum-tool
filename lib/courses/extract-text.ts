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
import { isImageHeavyPdf, pdfPageInfo } from '@/lib/courses/pdf-classify';
import { isLegacyOfficeMime, convertLegacyToModern } from '@/lib/courses/legacy-converter';
import { repetitionRatio } from '@/lib/courses/repetition-ratio';
import { renderToImages } from '@/lib/capture/render-pages';
import { describeSlides, notesToExtractedText, type SlideNote } from '@/lib/capture/slide-vision';

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
  /**
   * Per-slide notes from the adaptive vision pass (method='vision' only). Threaded
   * to finalizeExtraction so the middle-tier chunk build REUSES them instead of
   * re-rendering + re-describing (removes the double vision pass). Absent for
   * text/granite methods.
   */
  slideNotes?: SlideNote[];
}

/**
 * Heuristic: if the PDF yields fewer than this many characters per page on
 * average, it is treated as image-based and sent to vision transcription.
 */
const MIN_CHARS_PER_PAGE = 100;

/** Minimum chars for text to be considered meaningful (not low_text). */
const MIN_MEANINGFUL_CHARS = 10;

/** Granite output with repetition ratio at or above this threshold is considered degenerate. */
const GRANITE_REPETITION_THRESHOLD = 0.3;

/**
 * The image-PDF vision cascade: granite clean-scan OCR (if enabled) → ONE adaptive
 * `describeSlides` pass. Reachable two ways: (1) a PDF whose textual extraction came
 * back near-empty (`isImageBased`); (2) the upfront geometry route for image-heavy
 * decks. Both are image-based PDFs (the corpus is decks — no handwriting), so both
 * take the same adaptive pass.
 *
 * `describeSlides` replaced the old `transcribeDocument` verbatim lanes: that
 * verbatim-only prompt made the model NARRATE empty/near-blank slides ("the image is
 * completely blank…"), which was persisted as document text (Flavour-B
 * contamination). The adaptive prompt transcribes text AND describes imagery and
 * emits nothing for a genuinely empty page, so the failure mode is structural gone.
 * `describeSlides` handles the DGX-offload → local-omlx fallback + retry internally,
 * so there is no separate provider/forceLocalOffload plumbing here anymore.
 * `notesToExtractedText` derives `extracted_text`; the notes are returned so
 * finalizeExtraction can reuse them for chunks (single vision pass, no re-describe).
 */
async function runVisionFallback(
  args: ExtractTextArgs,
  pageCount: number | undefined,
): Promise<ExtractTextResult> {
  const { fileBytes, fileName } = args;
  // runVisionFallback is only invoked for PDFs (both call sites gate on it); narrow the
  // mimeType so the granite transcribe args (pdf | docx) typecheck.
  const mimeType = args.mimeType as Extract<ExtractedMimeType, 'application/pdf'>;

  // Lane 1 — granite clean-scan OCR (unchanged). Declines (empty/short/repetitive) or
  // errors → fall through to the adaptive pass. Design decks make granite decline; it
  // wins only for genuinely clean text scans.
  if (process.env.GRANITE_DOCLING_ENABLED && process.env.GRANITE_DOCLING_ENABLED !== 'false') {
    try {
      const g = await transcribeWithGranite({ fileBytes, mimeType, fileName });
      const gText = g.text.trim();
      if (gText.length >= MIN_MEANINGFUL_CHARS && repetitionRatio(gText) < GRANITE_REPETITION_THRESHOLD) {
        return { method: 'granite', status: 'ok', text: gText, pageCount: g.pageCount || pageCount, visionCostUsdCents: 0 };
      }
    } catch {
      // Granite error → fall through to the adaptive pass (Granite can only decline, never fail)
    }
  }

  // Lane 2 — one adaptive vision pass. Render (capped at 60 pages inside renderToImages),
  // describe each page (verbatim text + imagery), derive extracted_text from the notes.
  // Both DGX+local vision down (e.g. a full outage) → describeSlides returns 'unknown'
  // notes → empty text → low_text (retriable), never a silent narration.
  try {
    const images = await renderToImages(fileBytes, mimeType, fileName);
    if (images.length === 0) return { method: 'vision', status: 'failed', pageCount };
    const notes = await describeSlides(images);
    const text = notesToExtractedText(notes);
    return {
      method: 'vision',
      status: text.length < MIN_MEANINGFUL_CHARS ? 'low_text' : 'ok',
      text,
      pageCount: images.length,
      slideNotes: notes,
      visionCostUsdCents: 0, // DGX/omlx vision is off-meter (no OpenAI call)
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

  // Image-heavy PDFs (design slide decks) crash the standard Docling GPU pipeline on
  // the Spark GB10 (issue #4): the whole-deck raster hits a CUDA op before any
  // model-side resize. Detect them cheaply (geometry-first) and route straight to the
  // qwen per-page vision cascade — Docling is never invoked. Any probe doubt → qwen.
  if (mimeType === 'application/pdf' && (await isImageHeavyPdf(fileBytes))) {
    const info = await pdfPageInfo(fileBytes).catch(() => ({ pageCount: undefined as number | undefined }));
    return runVisionFallback(args, info.pageCount);
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
      return runVisionFallback(args, pageCount);
    }
  }

  if (text.length < MIN_MEANINGFUL_CHARS) {
    return { method: 'text', status: 'low_text', text, pageCount };
  }
  return { method: 'text', status: 'ok', text, pageCount };
}
