import mammoth from 'mammoth';
// PDF extraction is pluggable via the PDF_PARSER env var — unpdf
// (default, in-process) on Vercel, Docling (HTTP to a local
// docling-serve) on the local Mac deployment. See lib/courses/pdf-extractor.ts.
import { getPdfExtractor } from '@/lib/courses/pdf-extractor';
import { getProvider } from '@/lib/ai/provider';

export type ExtractedMimeType =
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface ExtractTextArgs {
  fileBytes: Buffer;
  mimeType: ExtractedMimeType;
  fileName: string;
}

export interface ExtractTextResult {
  method?: 'text' | 'vision';
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

export async function extractText(args: ExtractTextArgs): Promise<ExtractTextResult> {
  const { fileBytes, mimeType, fileName: _fileName } = args;

  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return extractDocx(fileBytes);
  }
  if (mimeType === 'application/pdf') {
    return extractPdf(fileBytes, mimeType);
  }
  // Should never reach here given MIME allowlist on the route.
  return { status: 'failed' };
}

async function extractDocx(fileBytes: Buffer): Promise<ExtractTextResult> {
  try {
    const result = await mammoth.extractRawText({ buffer: fileBytes });
    const text = result.value.trim();
    if (text.length < MIN_MEANINGFUL_CHARS) {
      return { method: 'text', status: 'low_text', text };
    }
    return { method: 'text', status: 'ok', text };
  } catch {
    return { status: 'failed' };
  }
}

async function extractPdf(
  fileBytes: Buffer,
  mimeType: 'application/pdf',
): Promise<ExtractTextResult> {
  let pageCount: number | undefined;
  let pdfText = '';

  try {
    const parsed = await getPdfExtractor().extract(fileBytes);
    pdfText = parsed.text;
    pageCount = parsed.pageCount;
  } catch {
    return { status: 'failed' };
  }

  const charsPerPage = pageCount && pageCount > 0 ? pdfText.length / pageCount : pdfText.length;
  const isImageBased = charsPerPage < MIN_CHARS_PER_PAGE;

  if (!isImageBased) {
    if (pdfText.length < MIN_MEANINGFUL_CHARS) {
      return { method: 'text', status: 'low_text', text: pdfText, pageCount };
    }
    return { method: 'text', status: 'ok', text: pdfText, pageCount };
  }

  // Image-based PDF — use vision transcription.
  try {
    const provider = getProvider();
    const transcribed = await provider.transcribeDocument({
      fileBytes,
      mimeType,
      maxPages: VISION_PAGE_CAP,
    });
    const text = transcribed.text.trim();
    const status = text.length < MIN_MEANINGFUL_CHARS ? 'low_text' : 'ok';
    return {
      method: 'vision',
      status,
      text,
      pageCount,
      visionCostUsdCents: transcribed.costUsdCents,
    };
  } catch {
    return { method: 'vision', status: 'failed', pageCount };
  }
}
