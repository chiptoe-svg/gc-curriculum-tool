import {
  updateExtractionResult,
  updateMaterialDigest,
  type ExtractionStatus,
  type ExtractionMethod,
} from '@/lib/db/course-materials-queries';
import { isCompressionCandidate } from '@/lib/capture/material-compression';
import { summarizeMaterial } from '@/lib/ai/analyze/material-summary';

export interface FinalizeExtractionInput {
  id: string;
  fileName: string;
  extractionStatus: ExtractionStatus;
  extractionMethod?: ExtractionMethod;
  extractedText?: string;
  pageCount?: number;
}

/**
 * Persist the result of an extraction attempt and, when the material is a
 * reference-style compression candidate, generate and persist a structured
 * summary in the same call. The summary call is best-effort: failures are
 * logged and swallowed so an OpenAI hiccup never fails an upload.
 *
 * Replaces direct `updateExtractionResult` calls in every extraction-completion
 * site (uploads, canvas import, scan-linked-docs, canvas re-extract).
 */
export async function finalizeExtraction(input: FinalizeExtractionInput): Promise<void> {
  await updateExtractionResult({
    id: input.id,
    extractionStatus: input.extractionStatus,
    ...(input.extractionMethod !== undefined && { extractionMethod: input.extractionMethod }),
    ...(input.extractedText !== undefined && { extractedText: input.extractedText }),
    ...(input.pageCount !== undefined && { pageCount: input.pageCount }),
  });

  if (input.extractionStatus !== 'ok') return;
  if (!input.extractedText) return;

  const candidate = isCompressionCandidate({
    fileName: input.fileName,
    extractedText: input.extractedText,
    digest: null,
    useDigest: false,
  });
  if (!candidate) return;

  try {
    const { digest, model } = await summarizeMaterial({
      fileName: input.fileName,
      extractedText: input.extractedText,
    });
    await updateMaterialDigest({ id: input.id, digest, digestModel: model });
  } catch (err) {
    console.error(`finalizeExtraction: summarizer failed for ${input.id} (${input.fileName})`, err);
    // Intentionally swallowed — extraction itself succeeded. The backfill
    // endpoint can re-attempt later.
  }
}
